"""2FA (TOTP) 路由 - 多因素認證管理"""

import time
import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from jwt.exceptions import InvalidTokenError
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.auth_cookies import set_auth_cookies as _set_auth_cookies_impl
from api.core.database import get_db
from api.core.login_lockout import is_locked, record_failure, record_success
from api.core.security import (
    add_to_blacklist,
    decode_token,
    is_blacklisted,
)
from api.dependencies.auth import get_current_active_user, get_optional_user
from api.models.user import User
from api.routers.auth import _access_token_claims
from api.services import mfa as mfa_svc
from api.services import passkey as passkey_svc
from api.services import user_session as user_session_svc

router = APIRouter(prefix="/auth/mfa", tags=["多因素認證"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


class MFASetupOut(BaseModel):
    secret: str
    qr_uri: str
    backup_codes: list[str]


class MFAStatusOut(BaseModel):
    mfa_enabled: bool
    has_pending_setup: bool
    backup_code_count: int = 0
    passkey_count: int = 0


class MFAConfirmIn(BaseModel):
    code: str = Field(..., min_length=6, max_length=8, description="TOTP 驗證碼")


class MFAVerifyIn(BaseModel):
    code: str = Field(..., min_length=6, max_length=8, description="TOTP 驗證碼")


class MFALoginVerifyIn(BaseModel):
    challenge_token: str = Field(..., min_length=1)
    code: str = Field(..., min_length=6, max_length=16, description="TOTP 或備用碼")


class MFABackupCodesOut(BaseModel):
    backup_codes: list[str]


class PasskeyRegistrationOptionsOut(BaseModel):
    transaction_id: str
    options: dict[str, Any]


class PasskeyRegistrationVerifyIn(BaseModel):
    transaction_id: str = Field(..., min_length=1)
    credential: dict[str, Any]
    device_name: str | None = Field(default=None, max_length=100)


class PasskeyAuthenticationOptionsIn(BaseModel):
    challenge_token: str | None = None


class PasskeyAuthenticationOptionsOut(BaseModel):
    transaction_id: str
    options: dict[str, Any]


class PasskeyAuthenticationVerifyIn(BaseModel):
    transaction_id: str = Field(..., min_length=1)
    credential: dict[str, Any]


class PasskeyDeleteIn(BaseModel):
    code: str | None = Field(default=None, min_length=6, max_length=16)


class PasskeyOut(BaseModel):
    id: uuid.UUID
    credential_id: str
    device_name: str
    transports: list[str]
    backed_up: bool
    created_at: datetime
    last_used_at: datetime | None


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    _set_auth_cookies_impl(response, access_token, refresh_token)


@router.get("/status", response_model=MFAStatusOut, summary="查詢 2FA 狀態")
async def mfa_status(db: DbDep, user: CurrentUser) -> MFAStatusOut:
    passkeys = await passkey_svc.list_credentials(db, user)
    return MFAStatusOut(
        mfa_enabled=user.mfa_enabled,
        has_pending_setup=user.mfa_pending_secret is not None,
        backup_code_count=mfa_svc.backup_code_count(user),
        passkey_count=len(passkeys),
    )


@router.post("/setup", response_model=MFASetupOut, summary="初始化 2FA 設定")
async def setup_mfa(db: DbDep, user: CurrentUser) -> MFASetupOut:
    """生成 TOTP 秘鑰和 QR URI，等待用戶確認後正式啟用"""
    if user.mfa_enabled:
        raise HTTPException(status_code=400, detail="2FA 已啟用，請先停用再重新設定")
    result = await mfa_svc.setup_mfa(db, user)
    return MFASetupOut(**result)


@router.post("/confirm", summary="確認 2FA 啟用")
async def confirm_mfa(payload: MFAConfirmIn, db: DbDep, user: CurrentUser) -> dict[str, str]:
    """輸入 TOTP 驗證碼以正式啟用 2FA"""
    success = await mfa_svc.confirm_mfa(db, user, payload.code)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="驗證碼錯誤，2FA 啟用失敗"
        )
    return {"message": "2FA 已成功啟用"}


@router.post("/verify", summary="驗證 2FA 碼")
async def verify_mfa(
    payload: MFAVerifyIn, request: Request, db: DbDep, user: CurrentUser
) -> dict[str, bool]:
    """驗證 TOTP 碼（用於需要二次確認的敏感操作）。連續失敗會暫時鎖定。"""
    lockout_key = f"mfa:{user.id}"
    locked_seconds = await is_locked(lockout_key)
    if locked_seconds:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"嘗試次數過多，請於 {locked_seconds // 60 + 1} 分鐘後再試",
        )
    valid = user.mfa_enabled and await mfa_svc.verify_mfa(db, user, payload.code)
    if not valid:
        await record_failure(lockout_key)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="2FA 驗證碼錯誤")
    await record_success(lockout_key)
    request.session["mfa_reauth_until"] = time.time() + 300
    return {"verified": True}


@router.get("/exchange-challenge", summary="從 session 取出 MFA challenge token（一次性）")
async def exchange_mfa_challenge(request: Request, db: DbDep) -> dict[str, str | bool]:
    """OAuth / One Tap 登入後，challenge token 存在 server session 而非 URL。
    前端 MFA 頁面呼叫此端點取得 token，取出後 session 中的值即清除（one-time use）。
    """
    challenge = request.session.pop("mfa_challenge", None)
    if not challenge:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="無待處理的 MFA 挑戰，請重新登入",
        )
    user = await passkey_svc.resolve_mfa_challenge_user(db, challenge)
    passkey_available = bool(user and await passkey_svc.list_credentials(db, user))
    return {"challenge": challenge, "passkey_available": passkey_available}


@router.post("/login/verify", summary="完成登入 2FA 挑戰")
async def verify_mfa_login(
    payload: MFALoginVerifyIn,
    request: Request,
    response: Response,
    db: DbDep,
) -> dict[str, str]:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="2FA 登入挑戰已失效，請重新登入",
    )
    if await is_blacklisted(payload.challenge_token):
        raise credentials_exception
    try:
        decoded = decode_token(payload.challenge_token)
    except InvalidTokenError as e:
        raise credentials_exception from e
    if decoded.get("type") != "mfa_challenge":
        raise credentials_exception
    user_id = decoded.get("sub")
    if not user_id:
        raise credentials_exception

    try:
        parsed_user_id = uuid.UUID(str(user_id))
    except ValueError as e:
        raise credentials_exception from e

    result = await db.execute(select(User).where(User.id == parsed_user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise credentials_exception

    lockout_key = f"mfa_login:{user.id}"
    locked_seconds = await is_locked(lockout_key)
    if locked_seconds:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"嘗試次數過多，請於 {locked_seconds // 60 + 1} 分鐘後再試",
        )

    valid = user.mfa_enabled and await mfa_svc.verify_mfa(db, user, payload.code)
    if not valid:
        await record_failure(lockout_key)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="2FA 驗證碼錯誤")

    await record_success(lockout_key)
    tokens = await user_session_svc.issue_session_tokens(
        db,
        user_id=user.id,
        extra_claims=await _access_token_claims(db, user),
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
        auth_method="totp",
    )
    await add_to_blacklist(payload.challenge_token)
    _set_auth_cookies(response, tokens.access_token, tokens.refresh_token)
    return {"message": "ok"}


@router.post(
    "/backup-codes/regenerate",
    response_model=MFABackupCodesOut,
    summary="重新產生 2FA 備用碼",
)
async def regenerate_backup_codes(
    payload: MFAConfirmIn,
    db: DbDep,
    user: CurrentUser,
) -> MFABackupCodesOut:
    backup_codes = await mfa_svc.regenerate_backup_codes(db, user, payload.code)
    if backup_codes is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="驗證碼錯誤，無法重產備用碼"
        )
    return MFABackupCodesOut(backup_codes=backup_codes)


@router.delete("/disable", summary="停用 2FA")
async def disable_mfa(payload: MFAConfirmIn, db: DbDep, user: CurrentUser) -> dict[str, str]:
    """停用 2FA（需提供最後一次 TOTP 驗證碼）"""
    success = await mfa_svc.disable_mfa(db, user, payload.code)
    if not success:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="驗證碼錯誤，停用失敗")
    return {"message": "2FA 已停用"}


@router.post(
    "/passkeys/registration/options",
    response_model=PasskeyRegistrationOptionsOut,
    summary="產生 Passkey 註冊選項",
)
async def passkey_registration_options(
    db: DbDep, user: CurrentUser
) -> PasskeyRegistrationOptionsOut:
    return PasskeyRegistrationOptionsOut(**await passkey_svc.registration_options(db, user))


@router.post(
    "/passkeys/registration/verify",
    response_model=PasskeyOut,
    summary="驗證並儲存 Passkey",
)
async def passkey_registration_verify(
    payload: PasskeyRegistrationVerifyIn,
    db: DbDep,
    user: CurrentUser,
) -> PasskeyOut:
    passkey = await passkey_svc.verify_registration(
        db, user, payload.transaction_id, payload.credential, payload.device_name
    )
    if passkey is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passkey 註冊驗證失敗")
    return PasskeyOut(**passkey_svc.credential_out(passkey))


@router.get("/passkeys", response_model=list[PasskeyOut], summary="列出已註冊 Passkey")
async def list_passkeys(db: DbDep, user: CurrentUser) -> list[PasskeyOut]:
    return [
        PasskeyOut(**passkey_svc.credential_out(item))
        for item in await passkey_svc.list_credentials(db, user)
    ]


@router.delete("/passkeys/{credential_id}", summary="刪除 Passkey")
async def delete_passkey(
    credential_id: str,
    request: Request,
    db: DbDep,
    user: CurrentUser,
    payload: PasskeyDeleteIn | None = None,
) -> dict[str, str]:
    if user.mfa_enabled and (
        not payload or not payload.code or not await mfa_svc.verify_mfa(db, user, payload.code)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="請先通過 TOTP 重新驗證"
        )
    if not user.mfa_enabled and request.session.get("mfa_reauth_until", 0) < time.time():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="請先使用 Passkey 重新驗證"
        )
    if not await passkey_svc.delete_credential(db, user, credential_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到 Passkey")
    return {"message": "Passkey 已刪除"}


@router.post(
    "/passkeys/authentication/options",
    response_model=PasskeyAuthenticationOptionsOut,
    summary="產生 Passkey 驗證選項",
)
async def passkey_authentication_options(
    db: DbDep,
    payload: PasskeyAuthenticationOptionsIn | None = None,
    user: Annotated[User | None, Depends(get_optional_user)] = None,
) -> PasskeyAuthenticationOptionsOut:
    challenge_user = None
    challenge_token = payload.challenge_token if payload else None
    if challenge_token:
        challenge_user = await passkey_svc.resolve_mfa_challenge_user(db, challenge_token)
        if challenge_user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登入挑戰已失效")
        if user and user.id != challenge_user.id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="登入挑戰與帳號不符"
            )
        user = challenge_user
    mode = "verify" if user and not challenge_token else "login"
    result = await passkey_svc.authentication_options(
        db, user=user, mode=mode, challenge_token=challenge_token
    )
    return PasskeyAuthenticationOptionsOut(**result)


@router.post("/passkeys/authentication/verify", summary="完成 Passkey 驗證或登入")
async def passkey_authentication_verify(
    payload: PasskeyAuthenticationVerifyIn,
    request: Request,
    response: Response,
    db: DbDep,
    user: Annotated[User | None, Depends(get_optional_user)] = None,
) -> dict[str, Any]:
    result = await passkey_svc.verify_authentication(db, payload.transaction_id, payload.credential)
    if result is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Passkey 驗證失敗")
    verified_user, mode, challenge_token = result
    if mode == "verify":
        if user is None or user.id != verified_user.id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="需要有效的登入狀態"
            )
        request.session["mfa_reauth_until"] = time.time() + 300
        return {"verified": True}

    if challenge_token:
        await add_to_blacklist(challenge_token)
        request.session.pop("mfa_challenge", None)
    tokens = await user_session_svc.issue_session_tokens(
        db,
        user_id=verified_user.id,
        extra_claims=await _access_token_claims(db, verified_user),
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
        auth_method="passkey",
    )
    _set_auth_cookies(response, tokens.access_token, tokens.refresh_token)
    return {"message": "ok"}
