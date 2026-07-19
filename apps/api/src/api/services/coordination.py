"""跨模組協調投影：行事曆、待辦、通知與社群平台的統一資料來源。"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.activity import Activity
from api.models.announcement import Announcement
from api.models.calendar import (
    CalendarEvent,
    CalendarEventParticipant,
    CalendarEventStatus,
    CalendarEventType,
    CalendarParticipantRole,
    CalendarVisibility,
)
from api.models.discord_account import DiscordOrgChannelMapping
from api.models.document import Document, DocumentStatus
from api.models.email_message import EmailMessage, EmailStatus
from api.models.meal import MealPickupSlot, MealProductAvailability, MealVendor, MenuSchedule
from api.models.meeting import Meeting
from api.models.partner_map import PartnerBusiness, PartnerOffer
from api.models.shop import Product
from api.models.survey import Survey
from api.models.work_item import WorkItem, WorkItemStatus
from api.services.outbox import emit


def _overlaps(column, start: datetime | None, end: datetime | None):  # noqa: ANN001
    clauses = [column.is_not(None)]
    if start is not None:
        clauses.append(column >= start)
    if end is not None:
        clauses.append(column <= end)
    return clauses


def _in_range(column, start: datetime | None, end: datetime | None):  # noqa: ANN001
    return and_(*_overlaps(column, start, end))


async def sync_calendar_projections(
    session: AsyncSession,
    *,
    start: datetime | None,
    end: datetime | None,
) -> int:
    """把所有既有系統的時間點投影到 calendar_events，回傳 upsert 筆數。"""
    total = 0
    total += await _project_documents(session, start, end)
    total += await _project_meetings(session, start, end)
    total += await _project_surveys(session, start, end)
    total += await _project_announcements(session, start, end)
    total += await _project_shop_products(session, start, end)
    total += await _project_meals(session, start, end)
    total += await _project_partner_offers(session, start, end)
    total += await _project_email_messages(session, start, end)
    total += await _project_work_items(session, start, end)
    total += await _project_activities(session, start, end)
    return total


async def publish_calendar_social_notice(
    session: AsyncSession,
    event: CalendarEvent,
    *,
    action: str,
) -> int:
    """把組織級以上的行事曆事件送到既有 Discord 組織公告頻道。"""
    if event.org_id is None:
        return 0
    if event.visibility not in {
        CalendarVisibility.ORG,
        CalendarVisibility.LOGGED_IN,
        CalendarVisibility.PUBLIC,
    }:
        return 0

    channel_ids = (
        (
            await session.execute(
                select(DiscordOrgChannelMapping.channel_id)
                .where(
                    DiscordOrgChannelMapping.org_id == event.org_id,
                    DiscordOrgChannelMapping.is_active.is_(True),
                )
                .order_by(DiscordOrgChannelMapping.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )
    sent = 0
    body_parts = []
    if event.location:
        body_parts.append(f"地點：{event.location}")
    if event.starts_at:
        body_parts.append(f"時間：{event.starts_at.isoformat()}")
    if event.description:
        body_parts.append(event.description[:300])

    for channel_id in dict.fromkeys(channel_ids):
        await emit(
            session,
            event_type="discord.channel_alert",
            payload={
                "channel_id": channel_id,
                "title": f"{action}：{event.title}",
                "body": "\n".join(body_parts) if body_parts else None,
                "link": event.href or f"/calendar?event={event.id}",
            },
        )
        sent += 1
    return sent


async def _upsert_projection(
    session: AsyncSession,
    *,
    source_module: str,
    source_id: uuid.UUID,
    source_key: str,
    org_id: uuid.UUID | None,
    title: str,
    starts_at: datetime,
    created_by: uuid.UUID,
    href: str,
    participant_user_ids: Iterable[uuid.UUID] = (),
    event_type: CalendarEventType = CalendarEventType.DEADLINE,
    status: CalendarEventStatus = CalendarEventStatus.CONFIRMED,
    visibility: CalendarVisibility = CalendarVisibility.ORG,
    description: str | None = None,
    location: str | None = None,
    ends_at: datetime | None = None,
) -> CalendarEvent:
    event = await session.scalar(
        select(CalendarEvent).where(
            CalendarEvent.source_module == source_module,
            CalendarEvent.source_id == source_id,
            CalendarEvent.source_key == source_key,
        )
    )
    if event is None:
        candidate = CalendarEvent(
            source_module=source_module,
            source_id=source_id,
            source_key=source_key,
            created_by=created_by,
        )
        session.add(candidate)
        try:
            # Two calendar reads can project the same source concurrently.  The
            # unique constraint is the final arbiter; use a savepoint so a race
            # rolls back only this candidate, not the caller's transaction.
            async with session.begin_nested():
                await session.flush()
            event = candidate
        except IntegrityError:
            event = await session.scalar(
                select(CalendarEvent).where(
                    CalendarEvent.source_module == source_module,
                    CalendarEvent.source_id == source_id,
                    CalendarEvent.source_key == source_key,
                )
            )
            if event is None:
                raise
    event.org_id = org_id
    event.title = title[:200]
    event.description = description
    event.event_type = event_type
    event.status = status
    event.visibility = visibility
    event.location = location[:200] if location else None
    event.starts_at = starts_at
    event.ends_at = ends_at
    event.href = href
    event.is_active = True
    await session.flush()
    for user_id in participant_user_ids:
        exists = await session.scalar(
            select(CalendarEventParticipant.id).where(
                CalendarEventParticipant.event_id == event.id,
                CalendarEventParticipant.user_id == user_id,
            )
        )
        if exists is None:
            session.add(
                CalendarEventParticipant(
                    event_id=event.id,
                    user_id=user_id,
                    role=CalendarParticipantRole.REQUIRED,
                )
            )
    await session.flush()
    return event


async def _project_documents(
    session: AsyncSession, start: datetime | None, end: datetime | None
) -> int:
    rows = (
        await session.execute(
            select(Document)
            .where(*_overlaps(Document.due_date, start, end))
            .where(Document.status != DocumentStatus.ARCHIVED)
            .limit(500)
        )
    ).scalars()
    count = 0
    for doc in rows:
        if not doc.due_date:
            continue
        await _upsert_projection(
            session,
            source_module="document",
            source_id=doc.id,
            source_key="due_date",
            org_id=doc.org_id,
            title=f"公文期限：{doc.title}",
            starts_at=doc.due_date,
            created_by=doc.created_by,
            href=f"/documents/{doc.serial_number}" if doc.serial_number else f"/documents/{doc.id}",
            description=doc.subject or doc.doc_description,
        )
        count += 1
    return count


async def _project_meetings(
    session: AsyncSession, start: datetime | None, end: datetime | None
) -> int:
    from api.services import calendar as calendar_svc

    rows = (
        await session.execute(
            select(Meeting).where(*_overlaps(Meeting.starts_at, start, end)).limit(500)
        )
    ).scalars()
    count = 0
    for meeting in rows:
        await calendar_svc.sync_meeting_to_event(session, meeting, actor_id=meeting.created_by)
        count += 1
    return count


async def _project_surveys(
    session: AsyncSession, start: datetime | None, end: datetime | None
) -> int:
    rows = (
        await session.execute(
            select(Survey)
            .where(
                or_(
                    _in_range(Survey.opens_at, start, end),
                    _in_range(Survey.closes_at, start, end),
                )
            )
            .limit(500)
        )
    ).scalars()
    count = 0
    for survey in rows:
        for key, at, label in [
            ("opens_at", survey.opens_at, "問卷開放"),
            ("closes_at", survey.closes_at, "問卷截止"),
        ]:
            if not at:
                continue
            await _upsert_projection(
                session,
                source_module="survey",
                source_id=survey.id,
                source_key=key,
                org_id=survey.org_id,
                title=f"{label}：{survey.title}",
                starts_at=at,
                created_by=survey.created_by,
                href=f"/surveys/{survey.id}",
                description=survey.description,
            )
            count += 1
    return count


async def _project_announcements(
    session: AsyncSession, start: datetime | None, end: datetime | None
) -> int:
    rows = (
        await session.execute(
            select(Announcement)
            .where(
                or_(
                    _in_range(Announcement.published_at, start, end),
                    _in_range(Announcement.urgent_until, start, end),
                )
            )
            .limit(500)
        )
    ).scalars()
    count = 0
    for ann in rows:
        for key, at, label in [
            ("published_at", ann.published_at, "公告發布"),
            ("urgent_until", ann.urgent_until, "重要公告期限"),
        ]:
            if not at:
                continue
            await _upsert_projection(
                session,
                source_module="announcement",
                source_id=ann.id,
                source_key=key,
                org_id=ann.org_id,
                title=f"{label}：{ann.title}",
                starts_at=at,
                created_by=ann.author_id,
                href=f"/announcements/{ann.id}",
                event_type=CalendarEventType.DEADLINE
                if key == "urgent_until"
                else CalendarEventType.OTHER,
                visibility=CalendarVisibility.LOGGED_IN,
            )
            count += 1
    return count


async def _project_shop_products(
    session: AsyncSession, start: datetime | None, end: datetime | None
) -> int:
    rows = (
        await session.execute(
            select(Product)
            .where(
                or_(
                    _in_range(Product.sale_start, start, end),
                    _in_range(Product.sale_end, start, end),
                )
            )
            .limit(500)
        )
    ).scalars()
    count = 0
    for product in rows:
        for key, at, label in [
            ("sale_start", product.sale_start, "商品開賣"),
            ("sale_end", product.sale_end, "商品停售"),
        ]:
            if not at:
                continue
            await _upsert_projection(
                session,
                source_module="shop",
                source_id=product.id,
                source_key=key,
                org_id=product.org_id,
                title=f"{label}：{product.name}",
                starts_at=at,
                created_by=product.created_by,
                href=f"/shop/admin?product={product.id}",
                event_type=CalendarEventType.DEADLINE
                if key == "sale_end"
                else CalendarEventType.OTHER,
            )
            count += 1
    return count


async def _project_meals(
    session: AsyncSession, start: datetime | None, end: datetime | None
) -> int:
    count = 0
    schedules = (
        await session.execute(
            select(MenuSchedule)
            .options(selectinload(MenuSchedule.vendor))
            .where(
                or_(
                    _in_range(MenuSchedule.order_open_time, start, end),
                    _in_range(MenuSchedule.order_deadline, start, end),
                )
            )
            .limit(500)
        )
    ).scalars()
    for schedule in schedules:
        for key, at, label in [
            ("order_open_time", schedule.order_open_time, "學餐開放訂購"),
            ("order_deadline", schedule.order_deadline, "學餐結單"),
        ]:
            if not at:
                continue
            await _upsert_projection(
                session,
                source_module="meal",
                source_id=schedule.id,
                source_key=key,
                org_id=schedule.vendor.org_id,
                title=f"{label}：{schedule.vendor.name}",
                starts_at=at,
                created_by=schedule.created_by,
                href="/meal/vendor",
                event_type=CalendarEventType.DEADLINE
                if key == "order_deadline"
                else CalendarEventType.OTHER,
            )
            count += 1

    slots = (
        await session.execute(
            select(MealPickupSlot)
            .join(
                MealProductAvailability,
                MealProductAvailability.id == MealPickupSlot.availability_id,
            )
            .join(MealVendor, MealVendor.id == MealProductAvailability.vendor_id)
            .options(
                selectinload(MealPickupSlot.availability).selectinload(
                    MealProductAvailability.vendor
                )
            )
            .where(*_overlaps(MealPickupSlot.pickup_start, start, end))
            .limit(500)
        )
    ).scalars()
    for slot in slots:
        availability = slot.availability
        await _upsert_projection(
            session,
            source_module="meal",
            source_id=slot.id,
            source_key="pickup_start",
            org_id=availability.vendor.org_id,
            title=f"學餐取餐：{availability.vendor.name} {slot.label}",
            starts_at=slot.pickup_start,
            ends_at=slot.pickup_end,
            created_by=availability.vendor.created_by,
            href="/meal/orders",
            event_type=CalendarEventType.OTHER,
        )
        count += 1
    return count


async def _project_partner_offers(
    session: AsyncSession, start: datetime | None, end: datetime | None
) -> int:
    rows = (
        await session.execute(
            select(PartnerOffer)
            .join(PartnerBusiness, PartnerBusiness.id == PartnerOffer.business_id)
            .options(selectinload(PartnerOffer.business))
            .where(
                or_(
                    _in_range(PartnerOffer.starts_at, start, end),
                    _in_range(PartnerOffer.ends_at, start, end),
                )
            )
            .limit(500)
        )
    ).scalars()
    count = 0
    for offer in rows:
        if offer.business.created_by is None:
            continue
        for key, at, label in [
            ("starts_at", offer.starts_at, "特約優惠開始"),
            ("ends_at", offer.ends_at, "特約優惠結束"),
        ]:
            if not at:
                continue
            await _upsert_projection(
                session,
                source_module="partner_map",
                source_id=offer.id,
                source_key=key,
                org_id=None,
                title=f"{label}：{offer.title}",
                starts_at=at,
                created_by=offer.business.created_by,
                href=f"/partner-map?business={offer.business_id}",
                event_type=CalendarEventType.DEADLINE
                if key == "ends_at"
                else CalendarEventType.OTHER,
                visibility=CalendarVisibility.LOGGED_IN,
            )
            count += 1
    return count


async def _project_email_messages(
    session: AsyncSession, start: datetime | None, end: datetime | None
) -> int:
    rows = (
        await session.execute(
            select(EmailMessage)
            .where(*_overlaps(EmailMessage.scheduled_at, start, end))
            .where(EmailMessage.status == EmailStatus.SCHEDULED)
            .limit(500)
        )
    ).scalars()
    count = 0
    for message in rows:
        if not message.scheduled_at or not message.sender_id:
            continue
        await _upsert_projection(
            session,
            source_module="email",
            source_id=message.id,
            source_key="scheduled_at",
            org_id=None,
            title=f"預約寄信：{message.subject}",
            starts_at=message.scheduled_at,
            created_by=message.sender_id,
            href=f"/email/logs?message={message.id}",
            event_type=CalendarEventType.OTHER,
            visibility=CalendarVisibility.PRIVATE,
        )
        count += 1
    return count


async def _project_work_items(
    session: AsyncSession, start: datetime | None, end: datetime | None
) -> int:
    rows = (
        await session.execute(
            select(WorkItem)
            .where(*_overlaps(WorkItem.due_at, start, end))
            .where(WorkItem.status == WorkItemStatus.OPEN, WorkItem.is_active.is_(True))
            .limit(500)
        )
    ).scalars()
    count = 0
    for item in rows:
        if not item.due_at or not item.created_by_id:
            continue
        await _upsert_projection(
            session,
            source_module="work_item",
            source_id=item.id,
            source_key="due_at",
            org_id=None,
            title=f"工作期限：{item.title}",
            starts_at=item.due_at,
            created_by=item.created_by_id,
            href="/tasks",
            event_type=CalendarEventType.DEADLINE,
            visibility=CalendarVisibility.PARTICIPANTS,
            participant_user_ids=[item.assigned_to_id] if item.assigned_to_id else [],
        )
        count += 1
    return count


async def _project_activities(
    session: AsyncSession, start: datetime | None, end: datetime | None
) -> int:
    rows = (
        await session.execute(
            select(Activity)
            .options(selectinload(Activity.conveners))
            .where(*_overlaps(Activity.starts_at, start, end))
            .limit(500)
        )
    ).scalars()
    count = 0
    for activity in rows:
        if not activity.starts_at or not activity.conveners:
            continue
        await _upsert_projection(
            session,
            source_module="activity",
            source_id=activity.id,
            source_key="starts_at",
            org_id=activity.org_id,
            title=f"活動：{activity.name}",
            starts_at=activity.starts_at,
            ends_at=activity.ends_at,
            created_by=activity.conveners[0].user_id,
            href=f"/admin/activities?activity={activity.id}",
            event_type=CalendarEventType.ACTIVITY,
        )
        count += 1
    return count
