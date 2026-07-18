"""會議 CRUD / 生命週期"""

from __future__ import annotations

import logging
import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.email_message import EmailMessage
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


_CN_ORDINALS = "一二三四五六七八九十"


def _roc_datetime_label(dt: datetime) -> str:
    """將 UTC/本地 datetime 轉換為民國曆格式文字，例：中華民國115年6月30日(星期一)晚上10時00分。"""
    local = dt.astimezone()
    roc_year = local.year - 1911
    weekdays = "一二三四五六日"
    weekday_cn = weekdays[local.weekday()]
    hour = local.hour
    minute = local.minute
    if 0 <= hour < 5:
        period, hour_12 = "凌晨", hour
    elif 5 <= hour < 12:
        period, hour_12 = "上午", hour
    elif hour == 12:
        period, hour_12 = "中午", 12
    elif 13 <= hour < 18:
        period, hour_12 = "下午", hour - 12
    else:
        period, hour_12 = "晚上", hour - 12
    return (
        f"中華民國{roc_year}年{local.month}月{local.day}日"
        f"(星期{weekday_cn}){period}{hour_12}時{minute:02d}分"
    )


def _cn_ordinal(n: int) -> str:
    """將正整數轉為中文序號（1→一，10→十，11→十一，...）。"""
    if n <= 0:
        return str(n)
    tens, ones = divmod(n - 1, 10) if n > 10 else (0, n - 1)
    if n <= 10:
        return _CN_ORDINALS[ones]
    prefix = ("" if tens == 0 else _CN_ORDINALS[tens - 1]) + "十"
    suffix = _CN_ORDINALS[ones] if ones < len(_CN_ORDINALS) else str(ones + 1)
    return prefix + (suffix if ones > 0 else "")


async def _create_notice_email_draft(
    session: AsyncSession,
    meeting: Meeting,
    *,
    actor_id: uuid.UUID,
) -> EmailMessage:
    """在現有事務中建立開會通知信草稿（DRAFT），格式與歷史通知信一致。"""
    from api.core.config import settings
    from api.models.email_message import EmailCampaignRecipient, EmailStatus

    starts_label = _roc_datetime_label(meeting.starts_at) if meeting.starts_at else "（待定）"
    location = meeting.location or "（待定）"
    chair = meeting.chair_name or "（待定）"

    ordered_items = sorted(meeting.agenda_items, key=lambda x: x.order_index)
    agenda_lines = "\n>\n".join(
        f"> {_cn_ordinal(i + 1)}、{item.title}" for i, item in enumerate(ordered_items)
    )

    body_md = (
        f"### {{{{ 姓名 }}}}您好，\n\n"
        f"敬請準時出席下列會議，會議資訊如下：\n\n"
        f"**開會事由**：{meeting.title}\n\n"
        f"**開會時間**：{starts_label}\n\n"
        f"**開會地點**：{location}\n\n"
        f"**主持人**：{chair}\\\n\\\n\n"
        f"**議事日程**\n\n" + (agenda_lines if agenda_lines else "> （議程待補）")
    )

    base = settings.FRONTEND_BASE_URL.rstrip("/")
    join_url = f"{base}/meetings/join/{meeting.checkin_token}"

    context = {
        "blocks": [],
        "buttons": [{"url": join_url, "label": "議員入口", "style": "primary"}],
        "cta_url": "",
        "heading": f"「{meeting.title}」{starts_label}召開",
        "card_rows": [{"label": "會議資訊", "value": f"{starts_label}｜{location}"}],
        "cta_label": "",
        "footer_text": f"主席 {chair}" if chair != "（待定）" else "",
        "accent_color": "#111827",
        "preview_text": f"{meeting.title}｜{starts_label}｜{location}",
        "background_color": "#eef2f7",
        "banner_image_alt": "",
        "banner_image_url": "",
        "body_line_height": 1.6,
        "paragraph_spacing": 18,
        "show_system_footer": True,
        "content_background_color": "#ffffff",
    }

    recipients = [
        att for att in meeting.attendance_records if att.user is not None and att.user.email
    ]
    external_emails = [att.user.email for att in recipients]
    recipient_variables = [
        {
            "user_id": str(att.user_id),
            "email": att.user.email,
            "name": att.user.display_name or att.user.email,
            "variables": {"姓名": att.user.display_name or att.user.email},
        }
        for att in recipients
    ]

    msg = EmailMessage(
        sender_id=actor_id,
        org_id=meeting.org_id,
        subject=f"【開會通知】{meeting.title}",
        body=body_md,
        template="generic",
        context=context,
        recipient_spec={"external_emails": external_emails},
        variable_definitions=[
            {"key": "姓名", "label": "姓名", "required": False, "default_value": "您"}
        ],
        default_variables={"姓名": "您"},
        recipient_variables=recipient_variables,
        resolved_emails=external_emails,
        recipient_count=len(external_emails),
        status=EmailStatus.DRAFT,
        idempotency_key=f"meeting-notice-{meeting.id}",
    )
    session.add(msg)
    await session.flush()

    for rv in recipient_variables:
        session.add(
            EmailCampaignRecipient(
                message_id=msg.id,
                user_id=uuid.UUID(rv["user_id"]),
                email=rv["email"],
                name=rv["name"],
                variables=rv["variables"],
                status="queued",
            )
        )
    await session.flush()
    return msg


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

    try:
        email_draft = await _create_notice_email_draft(session, meeting, actor_id=actor.id)
        meeting.notice_email_message_id = email_draft.id
        await session.flush()
    except Exception:
        logger.warning("create meeting notice email draft failed", exc_info=True)

    return meeting
