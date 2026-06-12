"""行事曆服務層。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Select, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.permission_codes import PermissionCode
from api.models.calendar import (
    CalendarEvent,
    CalendarEventChecklistItem,
    CalendarEventLink,
    CalendarEventParticipant,
    CalendarEventStatus,
    CalendarEventType,
    CalendarLinkType,
    CalendarParticipantRole,
    CalendarVisibility,
)
from api.models.meeting import Meeting, MeetingStatus
from api.models.user import User
from api.schemas.calendar import (
    CalendarChecklistCreate,
    CalendarChecklistUpdate,
    CalendarEventCreate,
    CalendarEventUpdate,
    CalendarLinkCreate,
    CalendarParticipantCreate,
    CalendarParticipantUpdate,
)
from api.services._base import apply_updates
from api.services.permission import get_user_org_ids

FORMAL_MEETING_LOCKED_STATUSES = {
    MeetingStatus.CHECKIN,
    MeetingStatus.ACTIVE,
    MeetingStatus.CLOSED,
    MeetingStatus.ARCHIVED,
}


def _event_load_options() -> list:
    return [
        selectinload(CalendarEvent.participants).selectinload(CalendarEventParticipant.user),
        selectinload(CalendarEvent.checklist_items).selectinload(
            CalendarEventChecklistItem.assignee
        ),
        selectinload(CalendarEvent.links),
    ]


async def get_event(session: AsyncSession, event_id: uuid.UUID) -> CalendarEvent | None:
    result = await session.execute(
        select(CalendarEvent)
        .options(*_event_load_options())
        .where(CalendarEvent.id == event_id, CalendarEvent.is_active.is_(True))
    )
    return result.scalar_one_or_none()


async def get_event_by_meeting(
    session: AsyncSession, meeting_id: uuid.UUID
) -> CalendarEvent | None:
    result = await session.execute(
        select(CalendarEvent)
        .options(*_event_load_options())
        .where(
            CalendarEvent.source_meeting_id == meeting_id,
            CalendarEvent.is_active.is_(True),
        )
    )
    return result.scalar_one_or_none()


async def _visible_event_ids_for_user(
    session: AsyncSession, user: User, permission_codes: frozenset[str]
) -> Select:
    if user.is_superuser or PermissionCode.CALENDAR_ADMIN in permission_codes:
        return select(CalendarEvent.id).where(CalendarEvent.is_active.is_(True))

    org_ids = await get_user_org_ids(session, user.id)
    participant_events = select(CalendarEventParticipant.event_id).where(
        CalendarEventParticipant.user_id == user.id
    )
    can_view_all = PermissionCode.CALENDAR_VIEW_ALL in permission_codes

    clauses = [
        CalendarEvent.created_by == user.id,
        CalendarEvent.visibility.in_([CalendarVisibility.LOGGED_IN, CalendarVisibility.PUBLIC]),
        CalendarEvent.id.in_(participant_events),
    ]
    if org_ids:
        clauses.append(CalendarEvent.visibility == CalendarVisibility.ORG)
        clauses[-1] = clauses[-1] & CalendarEvent.org_id.in_(org_ids)
    if can_view_all:
        clauses.append(CalendarEvent.visibility == CalendarVisibility.ORG)

    return select(CalendarEvent.id).where(CalendarEvent.is_active.is_(True), or_(*clauses))


async def list_events(
    session: AsyncSession,
    *,
    user: User,
    permission_codes: frozenset[str],
    start: datetime | None = None,
    end: datetime | None = None,
    org_id: uuid.UUID | None = None,
    event_type: CalendarEventType | None = None,
    visibility: CalendarVisibility | None = None,
    mine: bool = False,
) -> list[CalendarEvent]:
    visible_ids = await _visible_event_ids_for_user(session, user, permission_codes)
    stmt = (
        select(CalendarEvent)
        .options(*_event_load_options())
        .where(CalendarEvent.id.in_(visible_ids))
        .order_by(CalendarEvent.starts_at.asc(), CalendarEvent.created_at.asc())
    )
    if start is not None:
        stmt = stmt.where(or_(CalendarEvent.ends_at.is_(None), CalendarEvent.ends_at >= start))
    if end is not None:
        stmt = stmt.where(CalendarEvent.starts_at <= end)
    if org_id is not None:
        stmt = stmt.where(CalendarEvent.org_id == org_id)
    if event_type is not None:
        stmt = stmt.where(CalendarEvent.event_type == event_type)
    if visibility is not None:
        stmt = stmt.where(CalendarEvent.visibility == visibility)
    if mine:
        stmt = stmt.where(
            or_(
                CalendarEvent.created_by == user.id,
                CalendarEvent.id.in_(
                    select(CalendarEventParticipant.event_id).where(
                        CalendarEventParticipant.user_id == user.id
                    )
                ),
            )
        )
    result = await session.execute(stmt)
    return list(result.scalars().unique().all())


async def create_event(
    session: AsyncSession,
    *,
    data: CalendarEventCreate,
    actor: User,
) -> CalendarEvent:
    event = CalendarEvent(
        org_id=data.org_id,
        title=data.title,
        description=data.description,
        event_type=data.event_type,
        status=data.status,
        visibility=data.visibility,
        location=data.location,
        starts_at=data.starts_at,
        ends_at=data.ends_at,
        all_day=data.all_day,
        created_by=actor.id,
        updated_by=actor.id,
    )
    session.add(event)
    await session.flush()
    await _ensure_owner_participant(session, event, actor.id)
    for participant in data.participants:
        await upsert_participant(session, event, data=participant)
    for item in data.checklist_items:
        session.add(
            CalendarEventChecklistItem(
                event_id=event.id,
                title=item.title,
                due_at=item.due_at,
                assignee_id=item.assignee_id,
            )
        )
    for link in data.links:
        session.add(
            CalendarEventLink(
                event_id=event.id,
                link_type=link.link_type,
                object_id=link.object_id,
                title=link.title,
                url=str(link.url) if link.url else None,
                created_by=actor.id,
            )
        )
    await session.flush()
    await _notify_participants(session, event, actor, "calendar_event_invited")
    await _publish_social_notice(session, event, action="新增行程")
    return await get_event(session, event.id) or event


async def update_event(
    session: AsyncSession,
    event: CalendarEvent,
    *,
    data: CalendarEventUpdate,
    actor: User,
    permission_codes: frozenset[str],
) -> CalendarEvent:
    values = data.model_dump(exclude_unset=True)
    if event.source_meeting_id is not None:
        await _assert_can_update_linked_meeting(session, event, permission_codes)
    elif event.source_module:
        raise ValueError("投影事件請回到來源模組更新")
    for field, value in values.items():
        setattr(event, field, value)
    if event.ends_at is not None and event.ends_at < event.starts_at:
        raise ValueError("結束時間不可早於開始時間")
    event.updated_by = actor.id
    await session.flush()
    if event.source_meeting_id is not None:
        await sync_event_to_meeting(session, event, actor_id=actor.id)
    await _notify_participants(session, event, actor, "calendar_event_updated")
    await _publish_social_notice(session, event, action="更新行程")
    return await get_event(session, event.id) or event


async def delete_event(session: AsyncSession, event: CalendarEvent) -> None:
    if event.source_meeting_id is not None:
        raise ValueError("正式會議事件不可直接從行事曆刪除")
    if event.source_module:
        raise ValueError("投影事件請回到來源模組刪除或停用")
    event.is_active = False
    await session.flush()


async def upsert_participant(
    session: AsyncSession,
    event: CalendarEvent,
    *,
    data: CalendarParticipantCreate,
) -> CalendarEventParticipant:
    existing = await session.scalar(
        select(CalendarEventParticipant).where(
            CalendarEventParticipant.event_id == event.id,
            CalendarEventParticipant.user_id == data.user_id,
        )
    )
    if existing is not None:
        existing.role = data.role
        existing.response = data.response
        await session.flush()
        return existing
    record = CalendarEventParticipant(
        event_id=event.id,
        user_id=data.user_id,
        role=data.role,
        response=data.response,
    )
    session.add(record)
    await session.flush()
    return record


async def update_participant(
    session: AsyncSession,
    participant: CalendarEventParticipant,
    *,
    data: CalendarParticipantUpdate,
) -> CalendarEventParticipant:
    apply_updates(participant, data)
    await session.flush()
    return participant


async def delete_participant(session: AsyncSession, participant: CalendarEventParticipant) -> None:
    if participant.role == CalendarParticipantRole.OWNER:
        raise ValueError("不可移除事件擁有者")
    await session.delete(participant)
    await session.flush()


async def create_checklist_item(
    session: AsyncSession,
    event: CalendarEvent,
    *,
    data: CalendarChecklistCreate,
) -> CalendarEventChecklistItem:
    item = CalendarEventChecklistItem(
        event_id=event.id,
        title=data.title,
        due_at=data.due_at,
        assignee_id=data.assignee_id,
    )
    session.add(item)
    await session.flush()
    return item


async def update_checklist_item(
    session: AsyncSession,
    item: CalendarEventChecklistItem,
    *,
    data: CalendarChecklistUpdate,
) -> CalendarEventChecklistItem:
    values = data.model_dump(exclude_unset=True)
    for field, value in values.items():
        if field == "is_done":
            item.is_done = value
            item.done_at = datetime.now(UTC) if value else None
        else:
            setattr(item, field, value)
    await session.flush()
    return item


async def delete_checklist_item(session: AsyncSession, item: CalendarEventChecklistItem) -> None:
    await session.delete(item)
    await session.flush()


async def create_link(
    session: AsyncSession,
    event: CalendarEvent,
    *,
    data: CalendarLinkCreate,
    actor_id: uuid.UUID,
) -> CalendarEventLink:
    link = CalendarEventLink(
        event_id=event.id,
        link_type=data.link_type,
        object_id=data.object_id,
        title=data.title,
        url=str(data.url) if data.url else None,
        created_by=actor_id,
    )
    session.add(link)
    await session.flush()
    return link


async def delete_link(session: AsyncSession, link: CalendarEventLink) -> None:
    await session.delete(link)
    await session.flush()


async def sync_meeting_to_event(
    session: AsyncSession,
    meeting: Meeting,
    *,
    actor_id: uuid.UUID,
) -> CalendarEvent | None:
    if meeting.starts_at is None:
        return None
    event = await get_event_by_meeting(session, meeting.id)
    status = (
        CalendarEventStatus.DONE
        if meeting.status in {MeetingStatus.CLOSED, MeetingStatus.ARCHIVED}
        else CalendarEventStatus.CONFIRMED
    )
    if event is None:
        event = CalendarEvent(
            org_id=meeting.org_id,
            title=meeting.title,
            description=meeting.description,
            event_type=CalendarEventType.FORMAL_MEETING,
            status=status,
            visibility=CalendarVisibility.ORG,
            location=meeting.location,
            starts_at=meeting.starts_at,
            ends_at=meeting.ends_at,
            source_meeting_id=meeting.id,
            source_module="meeting",
            source_id=meeting.id,
            source_key="starts_at",
            href=f"/meetings/{meeting.id}",
            created_by=meeting.created_by,
            updated_by=actor_id,
        )
        session.add(event)
        await session.flush()
        await _ensure_owner_participant(session, event, meeting.created_by)
        session.add(
            CalendarEventLink(
                event_id=event.id,
                link_type=CalendarLinkType.MEETING,
                object_id=meeting.id,
                title=meeting.title,
                url=f"/meetings/{meeting.id}",
                created_by=actor_id,
            )
        )
    else:
        event.org_id = meeting.org_id
        event.title = meeting.title
        event.description = meeting.description
        event.status = status
        event.location = meeting.location
        event.starts_at = meeting.starts_at
        event.ends_at = meeting.ends_at
        event.source_module = "meeting"
        event.source_id = meeting.id
        event.source_key = "starts_at"
        event.href = f"/meetings/{meeting.id}"
        event.updated_by = actor_id
    await session.flush()
    return event


async def sync_event_to_meeting(
    session: AsyncSession,
    event: CalendarEvent,
    *,
    actor_id: uuid.UUID,
) -> Meeting | None:
    if event.source_meeting_id is None:
        return None
    meeting = await session.get(Meeting, event.source_meeting_id)
    if meeting is None:
        return None
    meeting.title = event.title
    meeting.description = event.description
    meeting.location = event.location
    meeting.starts_at = event.starts_at
    meeting.ends_at = event.ends_at
    meeting.org_id = event.org_id
    await session.flush()
    return meeting


async def _assert_can_update_linked_meeting(
    session: AsyncSession,
    event: CalendarEvent,
    permission_codes: frozenset[str],
) -> None:
    if PermissionCode.MEETING_MANAGE not in permission_codes:
        raise PermissionError("需要 meeting:manage 才能透過行事曆更新正式會議")
    meeting = await session.get(Meeting, event.source_meeting_id)
    if meeting is None:
        raise ValueError("找不到連結的正式會議")
    if meeting.status in FORMAL_MEETING_LOCKED_STATUSES:
        raise ValueError("報到中、進行中或已結束的會議不可從行事曆調整")


async def _ensure_owner_participant(
    session: AsyncSession,
    event: CalendarEvent,
    user_id: uuid.UUID,
) -> None:
    exists = await session.scalar(
        select(CalendarEventParticipant.id).where(
            CalendarEventParticipant.event_id == event.id,
            CalendarEventParticipant.user_id == user_id,
        )
    )
    if exists is not None:
        return
    session.add(
        CalendarEventParticipant(
            event_id=event.id,
            user_id=user_id,
            role=CalendarParticipantRole.OWNER,
        )
    )


async def _notify_participants(
    session: AsyncSession,
    event: CalendarEvent,
    actor: User,
    notification_type: str,
) -> None:
    try:
        from api.routers.notifications import create_notification

        for participant in event.participants:
            if participant.user_id == actor.id:
                continue
            await create_notification(
                session,
                user_id=participant.user_id,
                type=notification_type,
                title=f"行事曆：{event.title}",
                body=event.location or event.description or "",
                link=f"/calendar?event={event.id}",
                related_id=event.id,
            )
    except Exception:
        return


async def _publish_social_notice(
    session: AsyncSession,
    event: CalendarEvent,
    *,
    action: str,
) -> None:
    try:
        from api.services import coordination as coordination_svc

        await coordination_svc.publish_calendar_social_notice(session, event, action=action)
    except Exception:
        return
