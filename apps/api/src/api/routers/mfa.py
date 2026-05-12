"""2FA (TOTP) 路由 - 多因素認證管理"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
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


class MFAConfirmIn(BaseModel):
    code: str = Field(..., min_length=6, max_length=8, description="TOTP 驗證碼")


class MFAVerifyIn(BaseModel):
    code: str = Field(..., min_length=6, max_length=8, description="TOTP 驗證碼")


@router.get("/status", response_model=MFAStatusOut, summary="查詢 2FA 狀態")
async def mfa_status(user: CurrentUser) -> MFAStatusOut:
    return MFAStatusOut(
        mfa_enabled=user.mfa_enabled,
        has_pending_setup=user.mfa_pending_secret is not None,
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
async def verify_mfa(payload: MFAVerifyIn, user: CurrentUser) -> dict[str, bool]:
    """驗證 TOTP 碼（用於需要二次確認的敏感操作）"""
    valid = await mfa_svc.verify_mfa(user, payload.code)
    if not valid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="2FA 驗證碼錯誤")
    return {"verified": True}


@router.delete("/disable", summary="停用 2FA")
async def disable_mfa(payload: MFAConfirmIn, db: DbDep, user: CurrentUser) -> dict[str, str]:
    """停用 2FA（需提供最後一次 TOTP 驗證碼）"""
    success = await mfa_svc.disable_mfa(db, user, payload.code)
    if not success:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="驗證碼錯誤，停用失敗")
    return {"message": "2FA 已停用"}
