"""使用者 Google Tasks 整合 Router。"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Annotated

from authlib.integrations.base_client import OAuthError
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.models.user import User
from api.models.user_google_tasks import UserGoogleTasksConfig
from api.services import google_tasks_service as gtask_svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/user/google-tasks", tags=["Google Tasks 整合"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


class GoogleTasksStatusOut(BaseModel):
    is_connected: bool
    authorized_email: str | None
    sync_enabled: bool
    last_sync_at: datetime | None
    last_error: str | None
    authorized_at: datetime | None


@router.get("/status", response_model=GoogleTasksStatusOut, summary="查詢 Google Tasks 連結狀態")
async def get_status(session: DbDep, current_user: CurrentUser) -> GoogleTasksStatusOut:
    config = await session.scalar(
        select(UserGoogleTasksConfig).where(
            UserGoogleTasksConfig.user_id == current_user.id,
            UserGoogleTasksConfig.is_active.is_(True),
        )
    )
    if config is None:
        return GoogleTasksStatusOut(
            is_connected=False,
            authorized_email=None,
            sync_enabled=False,
            last_sync_at=None,
            last_error=None,
            authorized_at=None,
        )
    return GoogleTasksStatusOut(
        is_connected=config.is_connected,
        authorized_email=config.authorized_email,
        sync_enabled=config.sync_enabled,
        last_sync_at=config.last_sync_at,
        last_error=config.last_error,
        authorized_at=config.authorized_at,
    )


@router.get("/authorize", summary="發起 Google Tasks OAuth 授權")
async def authorize(
    request: Request,
    session: DbDep,
    current_user: CurrentUser,
) -> RedirectResponse:
    from api.core.config import settings
    from api.core.oauth import google_tasks as gtasks_client

    request.session["gtasks_user_id"] = str(current_user.id)
    redirect_uri = settings.GOOGLE_TASKS_REDIRECT_URI
    return await gtasks_client.authorize_redirect(request, redirect_uri)  # type: ignore[return-value]


@router.get("/callback", summary="Google Tasks OAuth 回呼", include_in_schema=False)
async def callback(request: Request, session: DbDep) -> RedirectResponse:
    from api.core.config import settings
    from api.core.field_crypto import FieldEncryptionNotConfigured
    from api.core.oauth import google_tasks as gtasks_client

    frontend_origin = settings.ALLOWED_ORIGINS[0] if settings.ALLOWED_ORIGINS else "http://localhost:3000"

    user_id_str = request.session.pop("gtasks_user_id", None)
    if not user_id_str:
        return RedirectResponse(url=f"{frontend_origin}/settings/integrations?error=session_expired")

    try:
        token_data = await gtasks_client.authorize_access_token(request)
    except OAuthError as exc:
        logger.warning("Google Tasks OAuth 失敗：%s", exc)
        return RedirectResponse(url=f"{frontend_origin}/settings/integrations?error=oauth_error")

    access_token: str = token_data.get("access_token", "")
    refresh_token: str | None = token_data.get("refresh_token")
    expires_at: float | None = token_data.get("expires_at")
    userinfo: dict = token_data.get("userinfo") or {}
    authorized_email: str | None = userinfo.get("email")

    token_expiry: datetime | None = None
    if expires_at:
        token_expiry = datetime.fromtimestamp(expires_at, tz=UTC)

    user_uuid = uuid.UUID(user_id_str)

    try:
        existing = await session.scalar(
            select(UserGoogleTasksConfig).where(
                UserGoogleTasksConfig.user_id == user_uuid,
            )
        )
        if existing is None:
            config = UserGoogleTasksConfig(user_id=user_uuid)
            session.add(config)
        else:
            config = existing
            config.is_active = True

        config.access_token = access_token
        if refresh_token:
            config.refresh_token = refresh_token
        config.token_expiry = token_expiry
        config.authorized_email = authorized_email
        config.authorized_at = datetime.now(UTC)
        config.sync_enabled = True
        config.google_tasklist_id = None
        config.last_error = None

        await session.commit()
    except FieldEncryptionNotConfigured:
        logger.error("Google Tasks callback：FIELD_ENCRYPTION_KEYS 未設定")
        return RedirectResponse(url=f"{frontend_origin}/settings/integrations?error=encryption_not_configured")
    except Exception:
        await session.rollback()
        logger.exception("Google Tasks callback：儲存 token 失敗")
        return RedirectResponse(url=f"{frontend_origin}/settings/integrations?error=save_failed")

    return RedirectResponse(url=f"{frontend_origin}/settings/integrations?connected=true")


@router.delete("/disconnect", status_code=status.HTTP_204_NO_CONTENT, summary="解除 Google Tasks 連結")
async def disconnect(session: DbDep, current_user: CurrentUser) -> None:
    config = await session.scalar(
        select(UserGoogleTasksConfig).where(
            UserGoogleTasksConfig.user_id == current_user.id,
            UserGoogleTasksConfig.is_active.is_(True),
        )
    )
    if config is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="尚未連結 Google Tasks")
    config.is_active = False
    config.sync_enabled = False
    config.google_tasklist_id = None
    await session.commit()


@router.post("/sync", summary="手動觸發 Google Tasks 雙向同步")
async def manual_sync(session: DbDep, current_user: CurrentUser) -> dict:
    config = await session.scalar(
        select(UserGoogleTasksConfig).where(
            UserGoogleTasksConfig.user_id == current_user.id,
            UserGoogleTasksConfig.is_active.is_(True),
            UserGoogleTasksConfig.sync_enabled.is_(True),
        )
    )
    if config is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="尚未連結 Google Tasks")

    try:
        from api.models.work_item import WorkItem, WorkItemStatus

        open_items = list(
            (
                await session.execute(
                    select(WorkItem).where(
                        WorkItem.is_active.is_(True),
                        WorkItem.assigned_to_id == current_user.id,
                        WorkItem.status == WorkItemStatus.OPEN,
                    )
                )
            )
            .scalars()
            .all()
        )

        push_count = 0
        for item in open_items:
            result = await gtask_svc.push_work_item(session, item, config)
            if result:
                push_count += 1

        stats = await gtask_svc.pull_from_google(session, config, current_user.id)
        await session.commit()

        return {
            "pushed": push_count,
            "pulled_created": stats["created"],
            "pulled_skipped": stats["skipped"],
            "errors": stats["errors"],
        }
    except gtask_svc.GoogleTasksAuthError as exc:
        await session.rollback()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    except gtask_svc.GoogleTasksApiError as exc:
        await session.rollback()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
