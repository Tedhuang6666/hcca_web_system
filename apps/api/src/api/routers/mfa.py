"""2FA (TOTP) 路由 - 多因素認證管理"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from jwt.exceptions import InvalidTokenError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.core.database import get_db
from api.core.security import create_access_token, create_refresh_token, decode_token
from api.dependencies.auth import get_current_active_user
from api.models.user import User
from api.services import mfa as mfa_svc

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


class MFAConfirmIn(BaseModel):
    code: str = Field(..., min_length=6, max_length=8, description="TOTP 驗證碼")


class MFAVerifyIn(BaseModel):
    code: str = Field(..., min_length=6, max_length=8, description="TOTP 驗證碼")


class MFALoginVerifyIn(BaseModel):
    challenge_token: str = Field(..., min_length=1)
    code: str = Field(..., min_length=6, max_length=8, description="TOTP 或備用碼")


class MFABackupCodesOut(BaseModel):
    backup_codes: list[str]


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    response.set_cookie(
        settings.ACCESS_TOKEN_COOKIE_NAME,
        access_token,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        path="/",
    )
    response.set_cookie(
        settings.REFRESH_TOKEN_COOKIE_NAME,
        refresh_token,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        path="/",
    )


@router.get("/status", response_model=MFAStatusOut, summary="查詢 2FA 狀態")
async def mfa_status(user: CurrentUser) -> MFAStatusOut:
    return MFAStatusOut(
        mfa_enabled=user.mfa_enabled,
        has_pending_setup=user.mfa_pending_secret is not None,
        backup_code_count=mfa_svc.backup_code_count(user),
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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="驗證碼錯誤，2FA 啟用失敗")
    return {"message": "2FA 已成功啟用"}


@router.post("/verify", summary="驗證 2FA 碼")
async def verify_mfa(payload: MFAVerifyIn, db: DbDep, user: CurrentUser) -> dict[str, bool]:
    """驗證 TOTP 碼（用於需要二次確認的敏感操作）"""
    valid = await mfa_svc.verify_mfa(db, user, payload.code)
    if not valid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="2FA 驗證碼錯誤")
    return {"verified": True}


@router.post("/login/verify", summary="完成登入 2FA 挑戰")
async def verify_mfa_login(
    payload: MFALoginVerifyIn,
    response: Response,
    db: DbDep,
) -> dict[str, str]:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="2FA 登入挑戰已失效，請重新登入",
    )
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

    valid = await mfa_svc.verify_mfa(db, user, payload.code)
    if not valid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="2FA 驗證碼錯誤")

    access_token = create_access_token(subject=str(user.id))
    refresh_token = create_refresh_token(subject=str(user.id))
    _set_auth_cookies(response, access_token, refresh_token)
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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="驗證碼錯誤，無法重產備用碼")
    return MFABackupCodesOut(backup_codes=backup_codes)


@router.delete("/disable", summary="停用 2FA")
async def disable_mfa(payload: MFAConfirmIn, db: DbDep, user: CurrentUser) -> dict[str, str]:
    """停用 2FA（需提供最後一次 TOTP 驗證碼）"""
    success = await mfa_svc.disable_mfa(db, user, payload.code)
    if not success:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="驗證碼錯誤，停用失敗")
    return {"message": "2FA 已停用"}
