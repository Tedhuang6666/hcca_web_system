"""LINE Bot Webhook 路由"""

import logging
from datetime import datetime
from typing import Annotated
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from linebot.v3.exceptions import InvalidSignatureError
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.core.security import create_access_token, create_mfa_challenge_token, create_refresh_token
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.models.user import User
from api.services.line_bot import (
    consume_open_token,
    create_link_code,
    get_user_link,
    handle_webhook,
    is_configured,
    unlink_user,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/line", tags=["LINE Bot"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


class LineLinkCodeOut(BaseModel):
    code: str
    expires_at: datetime
    instructions: str


class LineBindingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    linked: bool
    line_display_name: str | None = None
    linked_at: datetime | None = None


@router.post("/webhook", summary="LINE Bot Webhook 接收端點")
async def line_webhook(
    request: Request,
    x_line_signature: str = Header(..., alias="X-Line-Signature"),
) -> dict[str, str]:
    """
    接收 LINE Platform 發送的事件。

    LINE 在每次請求加入 X-Line-Signature Header 供驗證，
    確保請求確實來自 LINE 而非第三方。
    """
    if not is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LINE Bot 尚未設定，請聯絡管理員",
        )

    body_bytes = await request.body()
    body_str = body_bytes.decode("utf-8")

    try:
        await handle_webhook(body_str, x_line_signature)
    except InvalidSignatureError as e:
        logger.warning("LINE Webhook 簽名驗證失敗: %s", e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="無效的 LINE 簽名",
        ) from e
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="LINE Webhook payload 格式錯誤",
        ) from e

    return {"status": "ok"}


@router.post("/link-code", response_model=LineLinkCodeOut, summary="產生 LINE 綁定碼")
async def create_line_link_code(current_user: CurrentUser) -> LineLinkCodeOut:
    """產生短效綁定碼，使用者在 LINE Bot 輸入「綁定 XXXXXX」完成連結。"""
    try:
        code, expires_at = await create_link_code(current_user.id)
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e),
        ) from e
    return LineLinkCodeOut(
        code=code,
        expires_at=expires_at,
        instructions=f"請在 LINE Bot 輸入：綁定 {code}",
    )


@router.get("/me", response_model=LineBindingOut, summary="取得我的 LINE 綁定狀態")
async def get_my_line_binding(db: DbDep, current_user: CurrentUser) -> LineBindingOut:
    link = await get_user_link(db, current_user.id)
    if link is None:
        return LineBindingOut(linked=False)
    return LineBindingOut(
        linked=True,
        line_display_name=link.line_display_name,
        linked_at=link.linked_at,
    )


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT, summary="解除我的 LINE 綁定")
async def delete_my_line_binding(db: DbDep, current_user: CurrentUser) -> None:
    await unlink_user(db, current_user.id)


@router.get("/open", summary="LINE 自動登入並導向指定頁面")
async def open_from_line(
    db: DbDep,
    request: Request,
    token: str = Query(...),
) -> RedirectResponse:
    frontend = settings.FRONTEND_BASE_URL.rstrip("/")
    consumed = await consume_open_token(token)
    if consumed is None:
        return RedirectResponse(url=f"{frontend}/login")

    user_id, path = consumed
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None or not user.is_active:
        return RedirectResponse(url=f"{frontend}/login")

    if user.mfa_enabled:
        challenge_token = create_mfa_challenge_token(subject=str(user_id))
        request.session["mfa_challenge"] = challenge_token
        qs = urlencode({"next": path})
        return RedirectResponse(url=f"{frontend}/auth/mfa?{qs}")

    response = RedirectResponse(url=f"{frontend}{path}")
    response.set_cookie(
        settings.ACCESS_TOKEN_COOKIE_NAME,
        create_access_token(subject=str(user_id), extra_claims={"source": "line"}),
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        path="/",
    )
    response.set_cookie(
        settings.REFRESH_TOKEN_COOKIE_NAME,
        create_refresh_token(subject=str(user_id)),
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        path="/",
    )
    return response


@router.get("/status", summary="LINE Bot 設定狀態")
async def line_status(
    _: object = Depends(require_permission(PermissionCode.ADMIN_ALL)),
) -> dict[str, object]:
    """回傳 LINE Bot 是否已完整設定（供管理員確認）"""
    return {
        "configured": is_configured(),
        "message": "LINE Bot 已設定完成"
        if is_configured()
        else "請設定 LINE_CHANNEL_SECRET 與 LINE_CHANNEL_ACCESS_TOKEN",
    }
