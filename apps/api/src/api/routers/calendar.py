"""行事曆 Router - 事件 / 參與者 / 準備清單 / 關聯連結。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
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
from api.models.user import User
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


async def _event_or_404(
    session: AsyncSession,
    event_id: uuid.UUID,
    user: User,
    codes: frozenset[str],
) -> CalendarEvent:
    event = await calendar_svc.get_event(session, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此行事曆事件")
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
    await _manageable_event_or_404(session, event_id, current_user, codes)
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
    await _manageable_event_or_404(session, event_id, current_user, codes)
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
    await _manageable_event_or_404(session, event_id, current_user, codes)
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
    await _manageable_event_or_404(session, event_id, current_user, codes)
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
    await _manageable_event_or_404(session, event_id, current_user, codes)
    link = await session.scalar(
        select(CalendarEventLink).where(
            CalendarEventLink.id == link_id,
            CalendarEventLink.event_id == event_id,
        )
    )
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此關聯連結")
    await calendar_svc.delete_link(session, link)
