"""會議 CRUD / 生命週期"""

from __future__ import annotations

import logging
import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.meeting import (
    Meeting,
    MeetingAgendaItem,
    MeetingAgendaRecusal,
    MeetingAttendance,
    MeetingBallot,
    MeetingMode,
    MeetingMotion,
    MeetingRequest,
    MeetingScreenState,
    MeetingSpeechQueueItem,
    MeetingStatus,
    MeetingTimerState,
    MeetingVote,
)
from api.models.org import Org
from api.schemas.meeting import MeetingCreate, MeetingUpdate
from api.services._base import apply_updates

logger = logging.getLogger(__name__)


def _new_token() -> str:
    return secrets.token_urlsafe(32)


async def get_meeting(session: AsyncSession, meeting_id: uuid.UUID) -> Meeting | None:
    result = await session.execute(
        select(Meeting)
        .options(
            selectinload(Meeting.agenda_items).selectinload(MeetingAgendaItem.regulation),
            selectinload(Meeting.agenda_items).selectinload(MeetingAgendaItem.attachments),
            selectinload(Meeting.agenda_items).selectinload(MeetingAgendaItem.artifact_links),
            selectinload(Meeting.agenda_items)
            .selectinload(MeetingAgendaItem.recusals)
            .selectinload(MeetingAgendaRecusal.user),
            selectinload(Meeting.attendance_records).selectinload(MeetingAttendance.user),
            selectinload(Meeting.attendance_records).selectinload(MeetingAttendance.voting_class),
            selectinload(Meeting.attendance_records).selectinload(MeetingAttendance.proxy_for_user),
            selectinload(Meeting.attendance_sources),
            selectinload(Meeting.votes)
            .selectinload(MeetingVote.ballots)
            .selectinload(MeetingBallot.voter),
            selectinload(Meeting.requests).selectinload(MeetingRequest.user),
            selectinload(Meeting.speech_queue).selectinload(MeetingSpeechQueueItem.user),
            selectinload(Meeting.timer_state).selectinload(MeetingTimerState.active_speech),
            selectinload(Meeting.motions).selectinload(MeetingMotion.proposer),
            selectinload(Meeting.decisions),
            selectinload(Meeting.screen_state),
            selectinload(Meeting.events),
        )
        .where(Meeting.id == meeting_id)
    )
    return result.scalar_one_or_none()


async def get_meeting_by_screen_token(session: AsyncSession, token: str) -> Meeting | None:
    result = await session.execute(select(Meeting.id).where(Meeting.screen_token == token))
    meeting_id = result.scalar_one_or_none()
    if meeting_id is None:
        return None
    return await get_meeting(session, meeting_id)


async def get_meeting_by_join_token(session: AsyncSession, token: str) -> Meeting | None:
    result = await session.execute(select(Meeting.id).where(Meeting.checkin_token == token))
    meeting_id = result.scalar_one_or_none()
    if meeting_id is None:
        return None
    return await get_meeting(session, meeting_id)


async def list_meetings(
    session: AsyncSession,
    *,
    org_id: uuid.UUID | None = None,
    status: MeetingStatus | None = None,
    attendee_id: uuid.UUID | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[Meeting]:
    stmt = select(Meeting).order_by(Meeting.starts_at.desc().nullslast(), Meeting.created_at.desc())
    if org_id:
        stmt = stmt.where(Meeting.org_id == org_id)
    if status:
        stmt = stmt.where(Meeting.status == status)
    if attendee_id:
        stmt = stmt.where(
            Meeting.id.in_(
                select(MeetingAttendance.meeting_id).where(MeetingAttendance.user_id == attendee_id)
            )
        )
    result = await session.execute(stmt.limit(limit).offset(offset))
    return list(result.scalars().all())


async def create_meeting(
    session: AsyncSession, *, data: MeetingCreate, created_by: uuid.UUID
) -> Meeting:
    from api.services.meeting._agenda import seed_voter_roster

    org = await session.get(Org, data.org_id)
    bill_stage = data.bill_stage or (org.bill_stage if org else None)
    mode = MeetingMode.FULL if bill_stage else data.mode
    meeting = Meeting(
        org_id=data.org_id,
        activity_id=data.activity_id,
        title=data.title,
        mode=mode,
        description=data.description,
        location=data.location,
        chair_name=data.chair_name,
        starts_at=data.starts_at,
        ends_at=data.ends_at,
        expected_voters=data.expected_voters,
        quorum_count=data.quorum_count,
        default_pass_threshold=data.default_pass_threshold,
        default_speech_seconds=data.default_speech_seconds,
        allow_observer_requests=data.allow_observer_requests,
        bill_stage=bill_stage,
        screen_token=_new_token(),
        checkin_token=_new_token(),
        created_by=created_by,
    )
    session.add(meeting)
    await session.flush()
    session.add(MeetingScreenState(meeting_id=meeting.id))
    session.add(
        MeetingTimerState(
            meeting_id=meeting.id,
            duration_seconds=meeting.default_speech_seconds,
            remaining_when_paused=meeting.default_speech_seconds,
        )
    )
    await session.flush()
    await seed_voter_roster(session, meeting)
    await _sync_calendar_event(session, meeting, actor_id=created_by)
    return meeting


async def update_meeting(
    session: AsyncSession,
    meeting: Meeting,
    *,
    data: MeetingUpdate,
    actor_id: uuid.UUID | None = None,
) -> Meeting:
    apply_updates(meeting, data)
    await session.flush()
    await _sync_calendar_event(session, meeting, actor_id=actor_id or meeting.created_by)
    return meeting


async def transition_meeting(
    session: AsyncSession,
    meeting: Meeting,
    *,
    status: MeetingStatus,
    actor_id: uuid.UUID | None = None,
) -> Meeting:
    if meeting.status in {MeetingStatus.CLOSED, MeetingStatus.ARCHIVED} and status not in {
        MeetingStatus.CLOSED,
        MeetingStatus.ARCHIVED,
    }:
        raise ValueError("已結束的會議不可重新開啟")
    allowed: dict[MeetingStatus, set[MeetingStatus]] = {
        MeetingStatus.DRAFT: {MeetingStatus.CONFIRMED, MeetingStatus.CHECKIN, MeetingStatus.ACTIVE},
        MeetingStatus.CONFIRMED: {MeetingStatus.CHECKIN, MeetingStatus.ACTIVE, MeetingStatus.DRAFT},
        MeetingStatus.CHECKIN: {MeetingStatus.ACTIVE, MeetingStatus.PAUSED, MeetingStatus.CLOSED},
        MeetingStatus.ACTIVE: {MeetingStatus.BREAK, MeetingStatus.PAUSED, MeetingStatus.CLOSED},
        MeetingStatus.BREAK: {MeetingStatus.ACTIVE, MeetingStatus.PAUSED, MeetingStatus.CLOSED},
        MeetingStatus.PAUSED: {MeetingStatus.ACTIVE, MeetingStatus.BREAK, MeetingStatus.CLOSED},
        MeetingStatus.CLOSED: {MeetingStatus.ARCHIVED},
        MeetingStatus.ARCHIVED: set(),
    }
    if status != meeting.status and status not in allowed.get(MeetingStatus(meeting.status), set()):
        raise ValueError("不允許的會議狀態轉換")
    meeting.status = status
    if status == MeetingStatus.CLOSED and meeting.ends_at is None:
        meeting.ends_at = datetime.now(UTC)
    await session.flush()
    await _sync_calendar_event(session, meeting, actor_id=actor_id or meeting.created_by)
    return meeting


async def _sync_calendar_event(
    session: AsyncSession,
    meeting: Meeting,
    *,
    actor_id: uuid.UUID,
) -> None:
    try:
        from api.services import calendar as calendar_svc

        await calendar_svc.sync_meeting_to_event(session, meeting, actor_id=actor_id)
    except Exception:
        logger.warning("sync meeting calendar event failed", exc_info=True)


async def _create_notice_document(
    session: AsyncSession,
    meeting: Meeting,
    *,
    actor,
    serial_template_id: uuid.UUID | None = None,
    manual_serial_number: str | None = None,
):
    """以會議基本設定與議程產生一份開會通知單公文草稿。"""
    from api.models.document import DocumentCategory, RecipientType
    from api.schemas.document import DocumentCreate, RecipientCreate
    from api.services import document as document_svc

    ordered = sorted(meeting.agenda_items, key=lambda x: x.order_index)
    agenda_text = "\n".join(f"{i + 1}. {item.title}" for i, item in enumerate(ordered))
    recipients = [
        RecipientCreate(
            recipient_type=RecipientType.MAIN,
            name=record.user.display_name,
            email=record.user.email,
        )
        for record in meeting.attendance_records
        if record.user is not None
    ]
    return await document_svc.create_document(
        session,
        data=DocumentCreate(
            title=f"{meeting.title}開會通知單",
            org_id=meeting.org_id,
            serial_template_id=serial_template_id,
            manual_serial_number=manual_serial_number,
            category=DocumentCategory.MEETING_NOTICE,
            subject=f"檢送「{meeting.title}」開會通知，請查照並準時出席。",
            meeting_purpose=meeting.description or meeting.title,
            meeting_time=meeting.starts_at,
            meeting_location=meeting.location,
            meeting_chairperson=meeting.chair_name,
            doc_description=agenda_text or "(議程待補)",
            action_required="請與會人員準時出席；如有議案修正意見，請於會前提出。",
            content=f"## 議程\n\n{agenda_text}" if agenda_text else "## 議程\n\n(議程待補)",
            handler_name=actor.display_name,
            handler_email=actor.email,
            recipients=recipients[:100],
        ),
        created_by=actor.id,
    )


async def confirm_meeting(
    session: AsyncSession,
    meeting: Meeting,
    *,
    actor,
    notice_serial_template_id: uuid.UUID | None = None,
    notice_serial_number: str | None = None,
) -> Meeting:
    """確認議程草稿：鎖定基本設定、並以基本設定與議程自動產生開會通知單公文草稿。"""
    if meeting.status != MeetingStatus.DRAFT:
        raise ValueError("只有草稿狀態的會議可以確認議程")
    if meeting.confirmed_at is not None:
        raise ValueError("此會議議程已確認，不可重複確認")
    if not meeting.agenda_items:
        raise ValueError("請先建立至少一個議程項目再確認")
    if meeting.starts_at is None:
        raise ValueError("確認議程前請先設定開會時間")
    if not meeting.location or not meeting.location.strip():
        raise ValueError("確認議程前請先設定開會地點")

    notice = await _create_notice_document(
        session,
        meeting,
        actor=actor,
        serial_template_id=notice_serial_template_id,
        manual_serial_number=notice_serial_number.strip() if notice_serial_number else None,
    )
    meeting.notice_document_id = notice.id
    meeting.confirmed_at = datetime.now(UTC)
    meeting.status = MeetingStatus.CONFIRMED
    await session.flush()

    try:
        from api.routers.notifications import create_notification

        starts_label = (
            meeting.starts_at.astimezone().strftime("%Y/%m/%d %H:%M")
            if meeting.starts_at
            else "(待定)"
        )
        body = f"時間：{starts_label}　地點：{meeting.location or '(待定)'}"
        link = f"/meetings/{meeting.id}"
        for att in meeting.attendance_records:
            await create_notification(
                session,
                user_id=att.user_id,
                type="meeting_invited",
                title=f"開會通知：{meeting.title}",
                body=body,
                link=link,
                related_id=meeting.id,
            )
    except Exception:
        logger.warning("send meeting_invited notifications failed", exc_info=True)

    return meeting
