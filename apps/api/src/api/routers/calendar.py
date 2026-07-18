"""行事曆 Router - 事件 / 參與者 / 準備清單 / 關聯連結 / Google Calendar 同步。"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Annotated

from authlib.integrations.base_client import OAuthError
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_any
from api.models.calendar import (
    CalendarEvent,
    CalendarEventChecklistItem,
    CalendarEventLink,
    CalendarEventParticipant,
    CalendarEventType,
    CalendarVisibility,
)
from api.models.google_calendar import OrgGoogleCalendarConfig
from api.models.user import User
from api.routers._common import or_404
from api.schemas.calendar import (
    CalendarChecklistCreate,
    CalendarChecklistOut,
    CalendarChecklistUpdate,
    CalendarEventCreate,
    CalendarEventListItem,
    CalendarEventOut,
    CalendarEventUpdate,
    CalendarLinkCreate,
    CalendarLinkOut,
    CalendarParticipantCreate,
    CalendarParticipantOut,
    CalendarParticipantUpdate,
)
from api.services import audit as audit_svc
from api.services import calendar as calendar_svc
from api.services import coordination as coordination_svc
from api.services.permission import get_user_permission_codes

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/calendar", tags=["行事曆"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


async def _permission_codes(session: AsyncSession, user: User) -> frozenset[str]:
    if user.is_superuser:
        return frozenset(code.value for code in PermissionCode)
    return await get_user_permission_codes(session, user.id)


def _can_manage_event(user: User, codes: frozenset[str], event: CalendarEvent) -> bool:
    return bool(
        user.is_superuser
        or PermissionCode.CALENDAR_ADMIN in codes
        or PermissionCode.CALENDAR_MANAGE in codes
        or event.created_by == user.id
    )


def _assert_not_projection(event: CalendarEvent) -> None:
    if event.source_module and event.source_meeting_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="投影事件請回到來源模組更新",
        )


async def _event_or_404(
    session: AsyncSession,
    event_id: uuid.UUID,
    user: User,
    codes: frozenset[str],
) -> CalendarEvent:
    event = or_404(await calendar_svc.get_event(session, event_id), "找不到此行事曆事件")
    visible = await calendar_svc.list_events(
        session,
        user=user,
        permission_codes=codes,
        start=event.starts_at,
        end=event.ends_at or event.starts_at,
    )
    if event.id not in {item.id for item in visible}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權查看此事件")
    return event


async def _manageable_event_or_404(
    session: AsyncSession,
    event_id: uuid.UUID,
    user: User,
    codes: frozenset[str],
) -> CalendarEvent:
    event = await _event_or_404(session, event_id, user, codes)
    if not _can_manage_event(user, codes, event):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權管理此事件")
    return event


@router.get("/events", response_model=list[CalendarEventListItem], summary="列出行事曆事件")
async def list_events(
    session: DbDep,
    current_user: CurrentUser,
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    org_id: uuid.UUID | None = Query(None),
    event_type: CalendarEventType | None = Query(None, alias="type"),
    visibility: CalendarVisibility | None = Query(None),
    mine: bool = Query(False),
) -> list[CalendarEvent]:
    codes = await _permission_codes(session, current_user)
    await coordination_svc.sync_calendar_projections(session, start=start, end=end)
    return await calendar_svc.list_events(
        session,
        user=current_user,
        permission_codes=codes,
        start=start,
        end=end,
        org_id=org_id,
        event_type=event_type,
        visibility=visibility,
        mine=mine,
    )


@router.post(
    "/events",
    response_model=CalendarEventOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立行事曆事件（calendar:create）",
    dependencies=[
        Depends(
            require_any(
                PermissionCode.CALENDAR_CREATE,
                PermissionCode.CALENDAR_MANAGE,
                PermissionCode.CALENDAR_ADMIN,
            )
        )
    ],
)
async def create_event(
    payload: CalendarEventCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> CalendarEvent:
    try:
        event = await calendar_svc.create_event(session, data=payload, actor=current_user)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    await audit_svc.record(
        session,
        entity_type="calendar_event",
        entity_id=str(event.id),
        action="calendar.create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"org_id": str(event.org_id), "event_type": event.event_type},
        summary=f"建立行事曆事件「{event.title}」",
    )
    return event


@router.get("/events/{event_id}", response_model=CalendarEventOut, summary="取得行事曆事件")
async def get_event(
    event_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> CalendarEvent:
    codes = await _permission_codes(session, current_user)
    return await _event_or_404(session, event_id, current_user, codes)


@router.patch("/events/{event_id}", response_model=CalendarEventOut, summary="更新行事曆事件")
async def update_event(
    event_id: uuid.UUID,
    payload: CalendarEventUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> CalendarEvent:
    codes = await _permission_codes(session, current_user)
    event = await _manageable_event_or_404(session, event_id, current_user, codes)
    try:
        event = await calendar_svc.update_event(
            session,
            event,
            data=payload,
            actor=current_user,
            permission_codes=codes,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    await audit_svc.record(
        session,
        entity_type="calendar_event",
        entity_id=str(event.id),
        action="calendar.update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=payload.model_dump(exclude_unset=True, mode="json"),
        summary=f"更新行事曆事件「{event.title}」",
    )
    return event


@router.delete(
    "/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT, summary="刪除行事曆事件"
)
async def delete_event(event_id: uuid.UUID, session: DbDep, current_user: CurrentUser) -> None:
    codes = await _permission_codes(session, current_user)
    event = await _manageable_event_or_404(session, event_id, current_user, codes)
    try:
        await calendar_svc.delete_event(session, event)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post(
    "/events/{event_id}/participants",
    response_model=CalendarParticipantOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增或更新事件參與者",
)
async def upsert_participant(
    event_id: uuid.UUID,
    payload: CalendarParticipantCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> CalendarEventParticipant:
    codes = await _permission_codes(session, current_user)
    event = await _manageable_event_or_404(session, event_id, current_user, codes)
    _assert_not_projection(event)
    return await calendar_svc.upsert_participant(session, event, data=payload)


@router.patch(
    "/events/{event_id}/participants/{participant_id}",
    response_model=CalendarParticipantOut,
    summary="更新事件參與者",
)
async def update_participant(
    event_id: uuid.UUID,
    participant_id: uuid.UUID,
    payload: CalendarParticipantUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> CalendarEventParticipant:
    codes = await _permission_codes(session, current_user)
    event = await _manageable_event_or_404(session, event_id, current_user, codes)
    _assert_not_projection(event)
    participant = await session.get(CalendarEventParticipant, participant_id)
    if participant is None or participant.event_id != event_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此參與者")
    return await calendar_svc.update_participant(session, participant, data=payload)


@router.delete(
    "/events/{event_id}/participants/{participant_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="移除事件參與者",
)
async def delete_participant(
    event_id: uuid.UUID,
    participant_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> None:
    codes = await _permission_codes(session, current_user)
    event = await _manageable_event_or_404(session, event_id, current_user, codes)
    _assert_not_projection(event)
    participant = await session.get(CalendarEventParticipant, participant_id)
    if participant is None or participant.event_id != event_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此參與者")
    try:
        await calendar_svc.delete_participant(session, participant)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post(
    "/events/{event_id}/checklist",
    response_model=CalendarChecklistOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增準備事項",
)
async def create_checklist_item(
    event_id: uuid.UUID,
    payload: CalendarChecklistCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> CalendarEventChecklistItem:
    codes = await _permission_codes(session, current_user)
    event = await _manageable_event_or_404(session, event_id, current_user, codes)
    _assert_not_projection(event)
    return await calendar_svc.create_checklist_item(session, event, data=payload)


@router.patch(
    "/events/{event_id}/checklist/{item_id}",
    response_model=CalendarChecklistOut,
    summary="更新準備事項",
)
async def update_checklist_item(
    event_id: uuid.UUID,
    item_id: uuid.UUID,
    payload: CalendarChecklistUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> CalendarEventChecklistItem:
    codes = await _permission_codes(session, current_user)
    event = await _manageable_event_or_404(session, event_id, current_user, codes)
    _assert_not_projection(event)
    item = await session.get(CalendarEventChecklistItem, item_id)
    if item is None or item.event_id != event_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此準備事項")
    return await calendar_svc.update_checklist_item(session, item, data=payload)


@router.delete(
    "/events/{event_id}/checklist/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除準備事項",
)
async def delete_checklist_item(
    event_id: uuid.UUID,
    item_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> None:
    codes = await _permission_codes(session, current_user)
    event = await _manageable_event_or_404(session, event_id, current_user, codes)
    _assert_not_projection(event)
    item = await session.get(CalendarEventChecklistItem, item_id)
    if item is None or item.event_id != event_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此準備事項")
    await calendar_svc.delete_checklist_item(session, item)


@router.post(
    "/events/{event_id}/links",
    response_model=CalendarLinkOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增事件關聯連結",
)
async def create_link(
    event_id: uuid.UUID,
    payload: CalendarLinkCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> CalendarEventLink:
    codes = await _permission_codes(session, current_user)
    event = await _manageable_event_or_404(session, event_id, current_user, codes)
    _assert_not_projection(event)
    return await calendar_svc.create_link(session, event, data=payload, actor_id=current_user.id)


@router.delete(
    "/events/{event_id}/links/{link_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除事件關聯連結",
)
async def delete_link(
    event_id: uuid.UUID,
    link_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> None:
    codes = await _permission_codes(session, current_user)
    event = await _manageable_event_or_404(session, event_id, current_user, codes)
    _assert_not_projection(event)
    link = await session.scalar(
        select(CalendarEventLink).where(
            CalendarEventLink.id == link_id,
            CalendarEventLink.event_id == event_id,
        )
    )
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此關聯連結")
    await calendar_svc.delete_link(session, link)


# ── Google Calendar 雙向同步 ──────────────────────────────────────────────────


class GoogleCalendarStatusOut(BaseModel):
    is_connected: bool
    authorized_email: str | None
    google_calendar_id: str
    sync_enabled: bool
    last_pull_at: datetime | None
    last_error: str | None
    authorized_at: datetime | None

    model_config = {"from_attributes": True}


class GoogleCalendarItem(BaseModel):
    id: str
    summary: str
    primary: bool


class GoogleConfigUpdate(BaseModel):
    google_calendar_id: str


def _require_calendar_admin(user: User, codes: frozenset[str]) -> None:
    if not user.is_superuser and PermissionCode.CALENDAR_ADMIN not in codes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="需要 calendar:admin 權限"
        )


async def _get_google_config_or_404(
    session: AsyncSession, org_id: uuid.UUID
) -> OrgGoogleCalendarConfig:
    config = await session.scalar(
        select(OrgGoogleCalendarConfig).where(
            OrgGoogleCalendarConfig.org_id == org_id,
            OrgGoogleCalendarConfig.is_active.is_(True),
        )
    )
    return or_404(config, "此組織尚未連結 Google Calendar")


@router.get(
    "/google/status/{org_id}",
    response_model=GoogleCalendarStatusOut,
    summary="查詢 Google Calendar 同步狀態",
)
async def google_calendar_status(
    org_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> GoogleCalendarStatusOut:
    from api.models.google_calendar import OrgGoogleCalendarConfig

    codes = await _permission_codes(session, current_user)
    _require_calendar_admin(current_user, codes)
    config = await session.scalar(
        select(OrgGoogleCalendarConfig).where(
            OrgGoogleCalendarConfig.org_id == org_id,
            OrgGoogleCalendarConfig.is_active.is_(True),
        )
    )
    if config is None:
        return GoogleCalendarStatusOut(
            is_connected=False,
            authorized_email=None,
            google_calendar_id="primary",
            sync_enabled=False,
            last_pull_at=None,
            last_error=None,
            authorized_at=None,
        )
    return GoogleCalendarStatusOut(
        is_connected=config.is_connected,
        authorized_email=config.authorized_email,
        google_calendar_id=config.google_calendar_id,
        sync_enabled=config.sync_enabled,
        last_pull_at=config.last_pull_at,
        last_error=config.last_error,
        authorized_at=config.authorized_at,
    )


@router.get("/google/authorize", summary="發起 Google Calendar OAuth 授權")
async def google_calendar_authorize(
    request: Request,
    org_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> RedirectResponse:
    from api.core.oauth import google_calendar as gcal_client

    codes = await _permission_codes(session, current_user)
    _require_calendar_admin(current_user, codes)

    request.session["gcal_org_id"] = str(org_id)
    request.session["gcal_user_id"] = str(current_user.id)

    from api.core.config import settings

    redirect_uri = settings.GOOGLE_CALENDAR_REDIRECT_URI
    return await gcal_client.authorize_redirect(request, redirect_uri)  # type: ignore[return-value]


@router.get(
    "/google/callback", summary="Google Calendar OAuth 回呼（內部端點）", include_in_schema=False
)
async def google_calendar_callback(
    request: Request,
    session: DbDep,
) -> RedirectResponse:
    from datetime import datetime

    from api.core.config import settings
    from api.core.field_crypto import FieldEncryptionNotConfigured
    from api.core.oauth import google_calendar as gcal_client
    from api.models.google_calendar import OrgGoogleCalendarConfig

    frontend_origin = (
        settings.ALLOWED_ORIGINS[0] if settings.ALLOWED_ORIGINS else "http://localhost:3000"
    )

    org_id_str = request.session.pop("gcal_org_id", None)
    user_id_str = request.session.pop("gcal_user_id", None)

    if not org_id_str or not user_id_str:
        return RedirectResponse(
            url=f"{frontend_origin}/admin/calendar/google?error=session_expired"
        )

    try:
        token_data = await gcal_client.authorize_access_token(request)
    except OAuthError as exc:
        logger.warning("Google Calendar OAuth 失敗：%s", exc)
        return RedirectResponse(url=f"{frontend_origin}/admin/calendar/google?error=oauth_error")

    access_token: str = token_data.get("access_token", "")
    refresh_token: str | None = token_data.get("refresh_token")
    expires_at: float | None = token_data.get("expires_at")
    userinfo: dict = token_data.get("userinfo") or {}
    authorized_email: str | None = userinfo.get("email")

    token_expiry: datetime | None = None
    if expires_at:
        token_expiry = datetime.fromtimestamp(expires_at, tz=UTC)

    org_uuid = uuid.UUID(org_id_str)
    user_uuid = uuid.UUID(user_id_str)

    try:
        existing = await session.scalar(
            select(OrgGoogleCalendarConfig).where(
                OrgGoogleCalendarConfig.org_id == org_uuid,
            )
        )
        if existing is None:
            config = OrgGoogleCalendarConfig(
                org_id=org_uuid,
                authorized_by=user_uuid,
            )
            session.add(config)
        else:
            config = existing
            config.is_active = True
            config.authorized_by = user_uuid

        config.access_token = access_token
        if refresh_token:
            config.refresh_token = refresh_token
        config.token_expiry = token_expiry
        config.authorized_email = authorized_email
        config.authorized_at = datetime.now(UTC)
        config.sync_enabled = True
        config.sync_token = None
        config.last_error = None

        await session.commit()
    except FieldEncryptionNotConfigured:
        logger.error("Google Calendar callback：FIELD_ENCRYPTION_KEYS 未設定")
        return RedirectResponse(
            url=f"{frontend_origin}/admin/calendar/google?error=encryption_not_configured"
        )
    except Exception:
        await session.rollback()
        logger.exception("Google Calendar callback：儲存 token 失敗")
        return RedirectResponse(url=f"{frontend_origin}/admin/calendar/google?error=save_failed")

    return RedirectResponse(
        url=f"{frontend_origin}/admin/calendar/google?connected=true&org_id={org_id_str}"
    )


@router.delete(
    "/google/disconnect/{org_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="解除 Google Calendar 連結",
)
async def google_calendar_disconnect(
    org_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> None:
    codes = await _permission_codes(session, current_user)
    _require_calendar_admin(current_user, codes)
    config = await _get_google_config_or_404(session, org_id)
    config.is_active = False
    config.sync_enabled = False
    config.sync_token = None
    await session.commit()


@router.post("/google/trigger-pull/{org_id}", summary="手動觸發 Google Calendar 拉取")
async def google_calendar_trigger_pull(
    org_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> dict:
    from api.services.google_calendar_tasks import pull_all_orgs

    codes = await _permission_codes(session, current_user)
    _require_calendar_admin(current_user, codes)
    await _get_google_config_or_404(session, org_id)
    pull_all_orgs.delay()
    return {"status": "queued"}


@router.get(
    "/google/calendars/{org_id}",
    response_model=list[GoogleCalendarItem],
    summary="列出 Google 帳戶可用日曆",
)
async def list_google_calendars(
    org_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> list[GoogleCalendarItem]:
    from api.services.google_calendar_service import GoogleCalendarAuthError, list_calendars

    codes = await _permission_codes(session, current_user)
    _require_calendar_admin(current_user, codes)
    config = await _get_google_config_or_404(session, org_id)

    try:
        items = await list_calendars(session, config)
    except GoogleCalendarAuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=f"無法取得日曆清單：{exc}"
        ) from exc

    return [GoogleCalendarItem(**item) for item in items]


@router.patch(
    "/google/config/{org_id}",
    response_model=GoogleCalendarStatusOut,
    summary="更新 Google Calendar 同步設定（選定日曆）",
)
async def update_google_config(
    org_id: uuid.UUID,
    body: GoogleConfigUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> GoogleCalendarStatusOut:
    codes = await _permission_codes(session, current_user)
    _require_calendar_admin(current_user, codes)
    config = await _get_google_config_or_404(session, org_id)

    if config.google_calendar_id != body.google_calendar_id:
        config.google_calendar_id = body.google_calendar_id
        # 切換日曆後清空 syncToken，下次 pull 執行 full resync
        config.sync_token = None
        config.sync_token_updated_at = None

    await session.commit()
    await session.refresh(config)

    return GoogleCalendarStatusOut(
        is_connected=config.is_connected,
        authorized_email=config.authorized_email,
        google_calendar_id=config.google_calendar_id,
        sync_enabled=config.sync_enabled,
        last_pull_at=config.last_pull_at,
        last_error=config.last_error,
        authorized_at=config.authorized_at,
    )
