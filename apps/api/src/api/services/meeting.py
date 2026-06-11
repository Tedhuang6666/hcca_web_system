"""議事系統服務層。"""

from __future__ import annotations

import logging
import secrets
import uuid
from datetime import UTC, datetime

from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import TAIPEI, local_today
from api.models.meeting import (
    AgendaItemType,
    AttendanceRole,
    AttendanceSourceType,
    AttendanceStatus,
    BallotChoice,
    Meeting,
    MeetingAgendaItem,
    MeetingAgendaRecusal,
    MeetingArtifactLink,
    MeetingAttendance,
    MeetingAttendanceSource,
    MeetingBallot,
    MeetingBillStage,
    MeetingDecision,
    MeetingEvent,
    MeetingMode,
    MeetingMotion,
    MeetingRequest,
    MeetingRequestStatus,
    MeetingScreenState,
    MeetingSpeechQueueItem,
    MeetingStatus,
    MeetingTimerState,
    MeetingVote,
    SpeechQueueStatus,
    TimerStatus,
    VoteRecordMethod,
    VoteStatus,
    VoteThresholdType,
    VoteVisibility,
)
from api.models.org import Org, Permission, Position, UserPosition
from api.models.regulation import Regulation, RegulationWorkflowStatus
from api.models.school_class import ClassCadre, ClassMembership, ClassMembershipStatus, SchoolClass
from api.models.user import User
from api.schemas.meeting import (
    AgendaItemCreate,
    AgendaItemUpdate,
    ArtifactLinkCreate,
    ArtifactLinkUpdate,
    AttendanceCreate,
    AttendanceSourceCreate,
    AttendanceSourceResolveRequest,
    AttendanceUpdate,
    DecisionCreate,
    DecisionUpdate,
    MeetingCreate,
    MeetingRequestCreate,
    MeetingUpdate,
    MotionCreate,
    MotionUpdate,
    RecorderBallotCreate,
    ScreenStateUpdate,
    SpeechQueueCreate,
    SpeechQueueUpdate,
    VoteCreate,
    VoteUpdate,
)
from api.services import school_class as class_svc
from api.services.permission import active_tenure_filter

logger = logging.getLogger(__name__)


def _new_token() -> str:
    return secrets.token_urlsafe(32)


def _vote_tally(vote: MeetingVote, eligible_count: int, present_voters: int = 0) -> dict:
    """計算表決結果，依 record_method 分流。

    - ACCLAMATION：無異議通過，視為全體出席表決權同意。
    - TALLY：取主席口頭計票彙總（manual_tally）。
    - BALLOTS：自逐人票統計（簡易版紀錄代登或完整版議員自投皆同）。
    自訂選項（options）時改回傳 option_counts，過/不過由 result_label 認定。
    """
    method = VoteRecordMethod(vote.record_method)
    options = vote.options or None
    threshold_type = VoteThresholdType(vote.threshold_type)

    # 無異議通過：不需計票
    if method == VoteRecordMethod.ACCLAMATION:
        return {
            "approve": present_voters,
            "reject": 0,
            "abstain": 0,
            "total": present_voters,
            "eligible": eligible_count,
            "pass_threshold": 0,
            "threshold_type": threshold_type,
            "passed": True,
            "option_counts": {},
            "result_label": vote.result_label or "無異議通過",
        }

    # 自訂選項：回傳各選項票數，最高票為當選；過/不過依是否已認定結論
    if options:
        keys = [str(opt.get("key")) for opt in options if opt.get("key")]
        option_counts = {key: 0 for key in keys}
        if method == VoteRecordMethod.TALLY:
            for key in keys:
                option_counts[key] = int((vote.manual_tally or {}).get(key, 0))
        else:
            for ballot in vote.ballots:
                if ballot.option_key in option_counts:
                    option_counts[ballot.option_key] += 1
        total = sum(option_counts.values())
        return {
            "approve": 0,
            "reject": 0,
            "abstain": 0,
            "total": total,
            "eligible": eligible_count,
            "pass_threshold": 0,
            "threshold_type": threshold_type,
            "passed": bool(vote.result_label),
            "option_counts": option_counts,
            "result_label": vote.result_label,
        }

    # 標準同意/不同意/棄權
    if method == VoteRecordMethod.TALLY:
        tally = vote.manual_tally or {}
        approve = int(tally.get("approve", 0))
        reject = int(tally.get("reject", 0))
        abstain = int(tally.get("abstain", 0))
    else:
        approve = sum(1 for b in vote.ballots if b.choice == BallotChoice.APPROVE)
        reject = sum(1 for b in vote.ballots if b.choice == BallotChoice.REJECT)
        abstain = sum(1 for b in vote.ballots if b.choice == BallotChoice.ABSTAIN)
    total = approve + reject + abstain

    if threshold_type == VoteThresholdType.CUSTOM:
        threshold = vote.pass_threshold or 0
        passed = approve >= threshold if threshold > 0 else approve > reject
    elif threshold_type == VoteThresholdType.PRESENT_MAJORITY:
        threshold = present_voters // 2 + 1
        passed = approve >= threshold
    elif threshold_type == VoteThresholdType.ALL_MEMBERS_MAJORITY:
        threshold = eligible_count // 2 + 1
        passed = approve >= threshold
    else:
        threshold = 0
        passed = approve > reject
    return {
        "approve": approve,
        "reject": reject,
        "abstain": abstain,
        "total": total,
        "eligible": eligible_count,
        "pass_threshold": threshold,
        "threshold_type": threshold_type,
        "passed": passed,
        "option_counts": {},
        "result_label": vote.result_label,
    }


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
    # 未指定時，依開會組織在議事流程的角色自動偵測法案審議階段
    org = await session.get(Org, data.org_id)
    bill_stage = data.bill_stage or (org.bill_stage if org else None)
    # 法案審議流程天生需要完整議事（逐人表決＋門檻＋法案推進），強制完整版
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
    values = data.model_dump(exclude_unset=True)
    for field, value in values.items():
        setattr(meeting, field, value)
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
    actor: User,
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
    actor: User,
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

    # 通知所有出席者：開會邀請
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


# ── 法案審議階段對應 ─────────────────────────────────────────────────────────
# 各階段「自動帶入議程」的法案狀態（常委會看送審中提案、議會看常委會通過案）
_STAGE_INTAKE: dict[MeetingBillStage, RegulationWorkflowStatus] = {
    MeetingBillStage.STANDING_COMMITTEE: RegulationWorkflowStatus.UNDER_REVIEW,
    MeetingBillStage.COUNCIL: RegulationWorkflowStatus.SCHEDULED,
}
# 各階段表決通過後，法案推進到的下一狀態
_STAGE_ADVANCE: dict[MeetingBillStage, RegulationWorkflowStatus] = {
    MeetingBillStage.STANDING_COMMITTEE: RegulationWorkflowStatus.SCHEDULED,
    MeetingBillStage.COUNCIL: RegulationWorkflowStatus.COUNCIL_APPROVED,
}


async def list_proposable_regulations(session: AsyncSession, meeting: Meeting) -> list[Regulation]:
    """依會議的法案審議階段自動偵測尚未排入此會議議程的待審法案。"""
    if meeting.bill_stage is None:
        return []
    intake = _STAGE_INTAKE[MeetingBillStage(meeting.bill_stage)]
    linked = {item.regulation_id for item in meeting.agenda_items if item.regulation_id}
    result = await session.execute(
        select(Regulation)
        .where(Regulation.workflow_status == intake)
        .where(Regulation.is_active.is_(True))
        .order_by(Regulation.updated_at.desc())
    )
    return [reg for reg in result.scalars().all() if reg.id not in linked]


async def sync_proposals_to_agenda(session: AsyncSession, meeting: Meeting) -> int:
    """把自動偵測到的待審法案批次加到議程末端，回傳新增筆數。"""
    proposals = await list_proposable_regulations(session, meeting)
    if not proposals:
        return 0
    max_order = max((item.order_index for item in meeting.agenda_items), default=-1)
    for offset, reg in enumerate(proposals, start=1):
        session.add(
            MeetingAgendaItem(
                meeting_id=meeting.id,
                title=f"審議：{reg.title}",
                description=reg.proposal_metadata or reg.legal_basis or reg.preface,
                item_type=AgendaItemType.REGULATION,
                order_index=max_order + offset,
                regulation_id=reg.id,
            )
        )
    await session.flush()
    return len(proposals)


async def advance_agenda_regulation(
    session: AsyncSession,
    meeting: Meeting,
    item: MeetingAgendaItem,
    *,
    actor_id: uuid.UUID,
) -> Regulation:
    """表決通過後，依會議審議階段把議程關聯的法案推進到下一狀態。"""
    from api.services import regulation as regulation_svc

    if meeting.bill_stage is None:
        raise ValueError("此會議未設定法案審議階段")
    if item.regulation_id is None:
        raise ValueError("此議程項目未關聯法案")
    reg = await session.get(Regulation, item.regulation_id)
    if reg is None:
        raise ValueError("找不到關聯的法案")
    stage = MeetingBillStage(meeting.bill_stage)
    if reg.workflow_status != _STAGE_INTAKE[stage]:
        raise ValueError("此法案目前狀態與會議審議階段不符，無法推進")
    return await regulation_svc.transition_workflow(
        session,
        reg,
        to_status=_STAGE_ADVANCE[stage],
        actor_id=actor_id,
        note=item.resolution or f"會議「{meeting.title}」表決通過",
    )


async def delete_agenda_item(
    session: AsyncSession, meeting: Meeting, item: MeetingAgendaItem
) -> None:
    """刪除草稿議程項目。"""
    if meeting.status not in {MeetingStatus.DRAFT, MeetingStatus.CONFIRMED}:
        raise ValueError("僅草稿或議程已確認狀態的會議可以刪除議程項目")
    if meeting.current_agenda_item_id == item.id:
        meeting.current_agenda_item_id = None
    await session.delete(item)
    await session.flush()


async def seed_voter_roster(session: AsyncSession, meeting: Meeting) -> int:
    """用 meeting:vote 權限與有效任期建立預設表決權名冊。"""
    today = local_today()
    result = await session.execute(
        select(User.id)
        .join(UserPosition, UserPosition.user_id == User.id)
        .join(Position, Position.id == UserPosition.position_id)
        .join(Permission, Permission.position_id == Position.id)
        .where(Position.org_id == meeting.org_id)
        .where(Permission.code == "meeting:vote")
        .where(*active_tenure_filter(today))
        .distinct()
    )
    user_ids = [row[0] for row in result.all()]
    inserted = 0
    for user_id in user_ids:
        exists = await session.scalar(
            select(MeetingAttendance.id).where(
                MeetingAttendance.meeting_id == meeting.id,
                MeetingAttendance.user_id == user_id,
            )
        )
        if exists:
            continue
        values = await _normalize_voting_attendance(
            session,
            meeting,
            values={
                "user_id": user_id,
                "role": AttendanceRole.VOTER,
                "status": AttendanceStatus.EXPECTED,
                "is_voting_eligible": True,
            },
        )
        session.add(
            MeetingAttendance(
                meeting_id=meeting.id,
                **values,
            )
        )
        inserted += 1
    if inserted:
        await session.flush()
    return inserted


async def active_voting_class_for_user(
    session: AsyncSession, user_id: uuid.UUID
) -> SchoolClass | None:
    result = await session.execute(
        select(SchoolClass)
        .join(ClassMembership, ClassMembership.class_id == SchoolClass.id)
        .where(ClassMembership.user_id == user_id)
        .where(ClassMembership.status == ClassMembershipStatus.ACTIVE)
        .where(SchoolClass.is_active == True)  # noqa: E712
        .order_by(ClassMembership.academic_year.desc(), SchoolClass.class_code.asc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _normalize_voting_attendance(
    session: AsyncSession,
    meeting: Meeting,
    *,
    values: dict,
    existing: MeetingAttendance | None = None,
) -> dict:
    role = values.get("role", existing.role if existing else AttendanceRole.ATTENDEE)
    is_voting = bool(
        values.get(
            "is_voting_eligible",
            existing.is_voting_eligible if existing else False,
        )
    )
    if role == AttendanceRole.VOTER:
        is_voting = True
    if is_voting:
        values["role"] = AttendanceRole.VOTER
        values["is_voting_eligible"] = True
        user_id = values.get("user_id", existing.user_id if existing else None)
        voting_class = await active_voting_class_for_user(session, user_id)
        values["voting_class_id"] = voting_class.id if voting_class else None
        if voting_class is not None:
            duplicate = await session.scalar(
                select(MeetingAttendance)
                .where(MeetingAttendance.meeting_id == meeting.id)
                .where(MeetingAttendance.voting_class_id == voting_class.id)
                .where(MeetingAttendance.is_voting_eligible == True)  # noqa: E712
                .where(
                    MeetingAttendance.id != existing.id
                    if existing is not None
                    else MeetingAttendance.id.is_not(None)
                )
            )
            if duplicate is not None:
                label = class_svc.class_display_label(voting_class) or voting_class.class_code
                raise ValueError(f"{label} 已有表決權人，請先移除原表決權人後再新增")
    else:
        values["is_voting_eligible"] = False
        if role == AttendanceRole.VOTER:
            values["role"] = AttendanceRole.ATTENDEE
        values["voting_class_id"] = None
    return values


async def record_event(
    session: AsyncSession,
    meeting: Meeting,
    *,
    event_type: str,
    actor_id: uuid.UUID | None = None,
    agenda_item_id: uuid.UUID | None = None,
    payload: dict | None = None,
) -> MeetingEvent:
    event = MeetingEvent(
        meeting_id=meeting.id,
        agenda_item_id=agenda_item_id,
        event_type=event_type,
        actor_id=actor_id,
        payload=jsonable_encoder(payload or {}),
    )
    session.add(event)
    await session.flush()
    return event


async def list_events(
    session: AsyncSession, meeting_id: uuid.UUID, *, limit: int = 200
) -> list[MeetingEvent]:
    result = await session.execute(
        select(MeetingEvent)
        .where(MeetingEvent.meeting_id == meeting_id)
        .order_by(MeetingEvent.created_at.asc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def create_agenda_item(
    session: AsyncSession, meeting: Meeting, *, data: AgendaItemCreate
) -> MeetingAgendaItem:
    item = MeetingAgendaItem(meeting_id=meeting.id, **data.model_dump())
    session.add(item)
    await session.flush()
    if meeting.current_agenda_item_id is None:
        meeting.current_agenda_item_id = item.id
        await session.flush()
    return item


async def reorder_agenda_items(
    session: AsyncSession, meeting: Meeting, *, ordered_ids: list[uuid.UUID]
) -> list[MeetingAgendaItem]:
    items_by_id = {item.id: item for item in meeting.agenda_items}
    if set(ordered_ids) != set(items_by_id):
        raise ValueError("排序清單必須包含此會議的全部議程項目")
    for index, item_id in enumerate(ordered_ids):
        items_by_id[item_id].order_index = index
    await session.flush()
    return [items_by_id[item_id] for item_id in ordered_ids]


async def create_artifact_link(
    session: AsyncSession,
    item: MeetingAgendaItem,
    *,
    data: ArtifactLinkCreate,
    created_by: uuid.UUID,
) -> MeetingArtifactLink:
    link = MeetingArtifactLink(
        agenda_item_id=item.id,
        artifact_type=data.artifact_type,
        object_id=data.object_id,
        title=data.title,
        url=str(data.url) if data.url else None,
        summary=data.summary,
        created_by=created_by,
    )
    session.add(link)
    await session.flush()
    return link


async def update_artifact_link(
    session: AsyncSession, link: MeetingArtifactLink, *, data: ArtifactLinkUpdate
) -> MeetingArtifactLink:
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "url" and value is not None:
            value = str(value)
        setattr(link, field, value)
    await session.flush()
    return link


async def delete_artifact_link(session: AsyncSession, link: MeetingArtifactLink) -> None:
    await session.delete(link)
    await session.flush()


async def create_agenda_item_for_regulation(
    session: AsyncSession, meeting: Meeting, *, regulation_id: uuid.UUID, note: str | None = None
) -> MeetingAgendaItem:
    from api.models.regulation import Regulation

    reg = await session.get(Regulation, regulation_id)
    if reg is None:
        raise ValueError("找不到此法規")
    max_order = await session.scalar(
        select(func.coalesce(func.max(MeetingAgendaItem.order_index), -1)).where(
            MeetingAgendaItem.meeting_id == meeting.id
        )
    )
    data = AgendaItemCreate(
        title=f"審議：{reg.title}",
        description=reg.proposal_metadata or reg.legal_basis or reg.preface,
        item_type=AgendaItemType.REGULATION,
        order_index=int(max_order or -1) + 1,
        regulation_id=reg.id,
        notes=note,
    )
    return await create_agenda_item(session, meeting, data=data)


async def create_agenda_item_for_council_proposal(
    session: AsyncSession,
    meeting: Meeting,
    *,
    council_proposal_id: uuid.UUID,
    note: str | None = None,
) -> MeetingAgendaItem:
    """把議會提案排入會議議程末端，回傳建立的議程項目。"""
    from api.models.council_proposal import CouncilProposal

    proposal = await session.get(CouncilProposal, council_proposal_id)
    if proposal is None:
        raise ValueError("找不到此議會提案")
    max_order = await session.scalar(
        select(func.coalesce(func.max(MeetingAgendaItem.order_index), -1)).where(
            MeetingAgendaItem.meeting_id == meeting.id
        )
    )
    data = AgendaItemCreate(
        title=f"審議：{proposal.title}",
        description=proposal.summary,
        item_type=AgendaItemType.PROPOSAL,
        order_index=int(max_order or -1) + 1,
        council_proposal_id=proposal.id,
        notes=note,
    )
    return await create_agenda_item(session, meeting, data=data)


async def update_agenda_item(
    session: AsyncSession, item: MeetingAgendaItem, *, data: AgendaItemUpdate
) -> MeetingAgendaItem:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    await session.flush()
    return item


async def resolve_attendance_source(
    session: AsyncSession, data: AttendanceSourceResolveRequest
) -> tuple[str, list[User]]:
    users: list[User] = []
    label = "手動選取"
    today = local_today()
    if data.source_type in {AttendanceSourceType.CLASS_CADRES, AttendanceSourceType.CLASS_MEMBERS}:
        if data.source_id is None:
            raise ValueError("請選擇班級")
        sc = await class_svc.get_class(session, data.source_id)
        if sc is None:
            raise ValueError("找不到班級")
        label = f"{class_svc.class_display_label(sc)}" or "班級"
        if data.source_type == AttendanceSourceType.CLASS_CADRES:
            label = f"{label}幹部"
            result = await session.execute(
                select(User)
                .join(ClassCadre, ClassCadre.user_id == User.id)
                .where(ClassCadre.class_id == sc.id)
            )
            users = list(result.scalars().all())
        else:
            users = [
                await session.get(User, member.id)
                for member in await class_svc.list_class_members(session, sc)
            ]
            users = [u for u in users if u is not None]
    elif data.source_type == AttendanceSourceType.ORG_MEMBERS:
        if data.source_id is None:
            raise ValueError("請選擇組織")
        org = await session.get(Org, data.source_id)
        if org is None:
            raise ValueError("找不到組織")
        label = f"{org.name}成員"
        result = await session.execute(
            select(User)
            .join(UserPosition, UserPosition.user_id == User.id)
            .join(Position, Position.id == UserPosition.position_id)
            .where(Position.org_id == org.id)
            .where(UserPosition.start_date <= today)
            .where((UserPosition.end_date.is_(None)) | (UserPosition.end_date >= today))
            .distinct()
        )
        users = list(result.scalars().all())
    elif data.source_type == AttendanceSourceType.POSITION_MEMBERS:
        if data.source_id is None:
            raise ValueError("請選擇職位")
        position = await session.get(Position, data.source_id)
        if position is None:
            raise ValueError("找不到職位")
        label = f"{position.name}成員"
        result = await session.execute(
            select(User)
            .join(UserPosition, UserPosition.user_id == User.id)
            .where(UserPosition.position_id == position.id)
            .where(UserPosition.start_date <= today)
            .where((UserPosition.end_date.is_(None)) | (UserPosition.end_date >= today))
            .distinct()
        )
        users = list(result.scalars().all())
    elif data.source_type == AttendanceSourceType.MANUAL:
        if not data.user_ids:
            raise ValueError("請至少選擇一位使用者")
        result = await session.execute(select(User).where(User.id.in_(data.user_ids)))
        users = list(result.scalars().all())
    seen: set[uuid.UUID] = set()
    deduped: list[User] = []
    for user in users:
        if user.id in seen:
            continue
        seen.add(user.id)
        deduped.append(user)
    deduped.sort(key=lambda u: (u.student_id or "", u.display_name))
    return label, deduped


async def import_attendance_source(
    session: AsyncSession,
    meeting: Meeting,
    *,
    data: AttendanceSourceCreate,
    created_by: uuid.UUID,
) -> MeetingAttendanceSource:
    label, users = await resolve_attendance_source(session, data)
    source = MeetingAttendanceSource(
        meeting_id=meeting.id,
        source_type=data.source_type,
        source_id=data.source_id,
        label=data.label or label,
        role=data.role,
        is_voting_eligible=data.is_voting_eligible,
        imported_count=len(users),
        created_by=created_by,
    )
    session.add(source)
    for user in users:
        await upsert_attendance(
            session,
            meeting,
            data=AttendanceCreate(
                user_id=user.id,
                role=data.role,
                status=AttendanceStatus.EXPECTED,
                is_voting_eligible=data.is_voting_eligible,
                note=source.label,
            ),
        )
    await session.flush()
    return source


async def check_in(
    session: AsyncSession, meeting: Meeting, *, user_id: uuid.UUID, token: str | None = None
) -> MeetingAttendance:
    if token and token != meeting.checkin_token:
        raise PermissionError("簽到碼不正確")
    record = await session.scalar(
        select(MeetingAttendance).where(
            MeetingAttendance.meeting_id == meeting.id,
            MeetingAttendance.user_id == user_id,
        )
    )
    if record is None:
        record = MeetingAttendance(
            meeting_id=meeting.id,
            user_id=user_id,
            role=AttendanceRole.ATTENDEE,
            status=AttendanceStatus.PRESENT,
            checked_in_at=datetime.now(UTC),
            is_voting_eligible=False,
        )
        session.add(record)
    else:
        record.status = AttendanceStatus.PRESENT
        record.checked_in_at = datetime.now(UTC)
    await session.flush()
    return record


async def upsert_attendance(
    session: AsyncSession, meeting: Meeting, *, data: AttendanceCreate
) -> MeetingAttendance:
    record = await session.scalar(
        select(MeetingAttendance).where(
            MeetingAttendance.meeting_id == meeting.id,
            MeetingAttendance.user_id == data.user_id,
        )
    )
    values = data.model_dump()
    if record is None:
        values = await _normalize_voting_attendance(session, meeting, values=values)
        record = MeetingAttendance(meeting_id=meeting.id, **values)
        if record.status == AttendanceStatus.PRESENT and record.checked_in_at is None:
            record.checked_in_at = datetime.now(UTC)
        session.add(record)
    else:
        values = await _normalize_voting_attendance(
            session, meeting, values=values, existing=record
        )
        for field, value in values.items():
            setattr(record, field, value)
        if record.status == AttendanceStatus.PRESENT and record.checked_in_at is None:
            record.checked_in_at = datetime.now(UTC)
    await session.flush()
    return record


async def update_attendance(
    session: AsyncSession, record: MeetingAttendance, *, data: AttendanceUpdate
) -> MeetingAttendance:
    meeting = await session.get(Meeting, record.meeting_id)
    if meeting is None:
        raise ValueError("找不到此會議")
    values = await _normalize_voting_attendance(
        session,
        meeting,
        values=data.model_dump(exclude_unset=True),
        existing=record,
    )
    for field, value in values.items():
        setattr(record, field, value)
    if record.status == AttendanceStatus.PRESENT and record.checked_in_at is None:
        record.checked_in_at = datetime.now(UTC)
    await session.flush()
    return record


async def create_vote(session: AsyncSession, meeting: Meeting, *, data: VoteCreate) -> MeetingVote:
    vote = MeetingVote(
        meeting_id=meeting.id,
        title=data.title,
        description=data.description,
        agenda_item_id=data.agenda_item_id,
        visibility=data.visibility,
        pass_threshold=data.pass_threshold or meeting.default_pass_threshold,
        threshold_type=data.threshold_type,
        record_method=data.record_method,
        options=[opt.model_dump() for opt in data.options] if data.options else None,
    )
    session.add(vote)
    await session.flush()
    return vote


async def create_motion(
    session: AsyncSession, meeting: Meeting, *, data: MotionCreate
) -> MeetingMotion:
    motion = MeetingMotion(meeting_id=meeting.id, **data.model_dump())
    session.add(motion)
    await session.flush()
    return motion


async def update_motion(
    session: AsyncSession, motion: MeetingMotion, *, data: MotionUpdate
) -> MeetingMotion:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(motion, field, value)
    await session.flush()
    return motion


async def create_decision(
    session: AsyncSession,
    meeting: Meeting,
    *,
    data: DecisionCreate,
    created_by: uuid.UUID,
) -> MeetingDecision:
    decision_fields = data.model_dump(
        exclude={
            "create_follow_up",
            "follow_up_assignee_id",
            "follow_up_due_at",
            "create_document_draft",
        }
    )
    decision = MeetingDecision(meeting_id=meeting.id, created_by=created_by, **decision_fields)
    session.add(decision)
    item = next((x for x in meeting.agenda_items if x.id == data.agenda_item_id), None)
    if item is not None and data.status != "draft":
        item.resolution = data.content
    await session.flush()
    return decision


async def update_decision(
    session: AsyncSession, decision: MeetingDecision, *, data: DecisionUpdate
) -> MeetingDecision:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(decision, field, value)
    await session.flush()
    return decision


async def get_or_create_screen_state(session: AsyncSession, meeting: Meeting) -> MeetingScreenState:
    state = meeting.screen_state
    if state is None:
        state = MeetingScreenState(meeting_id=meeting.id)
        session.add(state)
        await session.flush()
    return state


async def get_or_create_timer_state(session: AsyncSession, meeting: Meeting) -> MeetingTimerState:
    state = meeting.timer_state
    if state is None:
        state = MeetingTimerState(
            meeting_id=meeting.id,
            duration_seconds=meeting.default_speech_seconds,
            remaining_when_paused=meeting.default_speech_seconds,
        )
        session.add(state)
        await session.flush()
    return state


async def update_screen_state(
    session: AsyncSession,
    meeting: Meeting,
    *,
    data: ScreenStateUpdate,
    updated_by: uuid.UUID | None,
) -> MeetingScreenState:
    state = await get_or_create_screen_state(session, meeting)
    values = data.model_dump(exclude_unset=True)
    for field, value in values.items():
        setattr(state, field, value)
    if data.agenda_item_id is not None:
        meeting.current_agenda_item_id = data.agenda_item_id
    state.updated_by = updated_by
    await session.flush()
    return state


async def update_vote(session: AsyncSession, vote: MeetingVote, *, data: VoteUpdate) -> MeetingVote:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(vote, field, value)
    await session.flush()
    return vote


def current_timer_remaining(state: MeetingTimerState, now: datetime | None = None) -> int:
    if state.status == TimerStatus.RUNNING and state.server_started_at is not None:
        now = now or datetime.now(UTC)
        elapsed = int((now - state.server_started_at).total_seconds())
        return state.duration_seconds - elapsed
    return state.remaining_when_paused


async def create_speech_queue_item(
    session: AsyncSession,
    meeting: Meeting,
    *,
    data: SpeechQueueCreate,
) -> MeetingSpeechQueueItem:
    request = None
    user = None
    if data.request_id is not None:
        request = await session.get(MeetingRequest, data.request_id)
        if request is None or request.meeting_id != meeting.id:
            raise ValueError("找不到此議事請求")
    user_id = data.user_id or (request.user_id if request else None)
    if user_id is not None:
        user = await session.get(User, user_id)
    speaker_name = data.speaker_name or (user.display_name if user else None)
    if not speaker_name:
        raise ValueError("請提供發言人姓名")
    max_order = max((item.order_index for item in meeting.speech_queue), default=-1)
    duration = data.duration_seconds or meeting.default_speech_seconds
    item = MeetingSpeechQueueItem(
        meeting_id=meeting.id,
        agenda_item_id=data.agenda_item_id
        or (request.agenda_item_id if request else meeting.current_agenda_item_id),
        user_id=user_id,
        request_id=data.request_id,
        speaker_name=speaker_name,
        speaker_role=data.speaker_role,
        order_index=max_order + 1,
        duration_seconds=duration,
        remaining_seconds=duration,
    )
    session.add(item)
    if request is not None:
        request.status = MeetingRequestStatus.ACKNOWLEDGED
    await session.flush()
    return item


async def update_speech_queue_item(
    session: AsyncSession,
    item: MeetingSpeechQueueItem,
    *,
    data: SpeechQueueUpdate,
) -> MeetingSpeechQueueItem:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    if (
        "duration_seconds" in data.model_fields_set
        and "remaining_seconds" not in data.model_fields_set
    ):
        item.remaining_seconds = item.duration_seconds
    await session.flush()
    return item


async def reorder_speech_queue(
    session: AsyncSession, meeting: Meeting, ordered_ids: list[uuid.UUID]
) -> list[MeetingSpeechQueueItem]:
    items = {item.id: item for item in meeting.speech_queue}
    if set(ordered_ids) != set(items):
        raise ValueError("發言排序清單與目前 queue 不一致")
    for index, item_id in enumerate(ordered_ids):
        items[item_id].order_index = index
    await session.flush()
    return sorted(items.values(), key=lambda item: item.order_index)


async def start_speech(
    session: AsyncSession, meeting: Meeting, item: MeetingSpeechQueueItem
) -> MeetingSpeechQueueItem:
    state = await get_or_create_timer_state(session, meeting)
    now = datetime.now(UTC)
    for other in meeting.speech_queue:
        if (
            other.status in {SpeechQueueStatus.SPEAKING, SpeechQueueStatus.PAUSED}
            and other.id != item.id
        ):
            other.status = SpeechQueueStatus.FINISHED
            other.finished_at = now
    item.status = SpeechQueueStatus.SPEAKING
    item.started_at = now
    item.paused_at = None
    if item.remaining_seconds <= 0:
        item.remaining_seconds = item.duration_seconds
    state.active_speech_id = item.id
    state.status = TimerStatus.RUNNING
    state.server_started_at = now
    state.duration_seconds = item.remaining_seconds
    state.remaining_when_paused = item.remaining_seconds
    await session.flush()
    return item


async def pause_speech(
    session: AsyncSession, meeting: Meeting, item: MeetingSpeechQueueItem
) -> MeetingSpeechQueueItem:
    state = await get_or_create_timer_state(session, meeting)
    if state.active_speech_id != item.id or state.status != TimerStatus.RUNNING:
        raise ValueError("此發言目前沒有進行中的計時")
    remaining = current_timer_remaining(state)
    item.remaining_seconds = max(0, remaining)
    item.status = SpeechQueueStatus.PAUSED
    item.paused_at = datetime.now(UTC)
    state.status = TimerStatus.PAUSED if remaining >= 0 else TimerStatus.OVERTIME
    state.remaining_when_paused = remaining
    state.server_started_at = None
    await session.flush()
    return item


async def resume_speech(
    session: AsyncSession, meeting: Meeting, item: MeetingSpeechQueueItem
) -> MeetingSpeechQueueItem:
    state = await get_or_create_timer_state(session, meeting)
    if state.active_speech_id != item.id:
        state.active_speech_id = item.id
    item.status = SpeechQueueStatus.SPEAKING
    item.paused_at = None
    state.status = TimerStatus.RUNNING
    state.server_started_at = datetime.now(UTC)
    state.duration_seconds = item.remaining_seconds
    state.remaining_when_paused = item.remaining_seconds
    await session.flush()
    return item


async def finish_speech(
    session: AsyncSession,
    meeting: Meeting,
    item: MeetingSpeechQueueItem,
    *,
    status: SpeechQueueStatus = SpeechQueueStatus.FINISHED,
) -> MeetingSpeechQueueItem:
    state = await get_or_create_timer_state(session, meeting)
    if state.active_speech_id == item.id:
        item.remaining_seconds = max(0, current_timer_remaining(state))
        state.active_speech_id = None
        state.status = TimerStatus.IDLE
        state.server_started_at = None
        state.duration_seconds = meeting.default_speech_seconds
        state.remaining_when_paused = meeting.default_speech_seconds
    item.status = status
    item.finished_at = datetime.now(UTC)
    await session.flush()
    return item


async def extend_speech(
    session: AsyncSession, meeting: Meeting, item: MeetingSpeechQueueItem, *, seconds: int
) -> MeetingSpeechQueueItem:
    state = await get_or_create_timer_state(session, meeting)
    if state.active_speech_id == item.id and state.status == TimerStatus.RUNNING:
        remaining = current_timer_remaining(state) + seconds
        state.server_started_at = datetime.now(UTC)
        state.duration_seconds = remaining
        state.remaining_when_paused = remaining
        item.remaining_seconds = remaining
    else:
        item.remaining_seconds += seconds
    item.duration_seconds += seconds
    await session.flush()
    return item


async def open_vote(session: AsyncSession, vote: MeetingVote) -> MeetingVote:
    if vote.status == VoteStatus.CLOSED:
        raise ValueError("已關閉的表決不可重新開啟")
    vote.status = VoteStatus.OPEN
    vote.opened_at = datetime.now(UTC)
    await session.flush()
    return vote


async def close_vote(session: AsyncSession, vote: MeetingVote) -> MeetingVote:
    if vote.status != VoteStatus.OPEN:
        raise ValueError("只有進行中的表決可以關閉")
    vote.status = VoteStatus.CLOSED
    vote.closed_at = datetime.now(UTC)
    await session.flush()
    # 簡易模式逐人表決：關閉時自動把結論回寫議程案 resolution（完整模式走正式決議流程）
    meeting = await session.get(Meeting, vote.meeting_id)
    if meeting is not None and meeting.mode == MeetingMode.SIMPLE:
        await _write_back_resolution(session, vote)
    return vote


async def _assert_voter_eligible(
    session: AsyncSession, vote: MeetingVote, voter_id: uuid.UUID
) -> None:
    """檢查投票者具表決權、已出席，且未對該議程案迴避。"""
    attendance = await session.scalar(
        select(MeetingAttendance).where(
            MeetingAttendance.meeting_id == vote.meeting_id,
            MeetingAttendance.user_id == voter_id,
            MeetingAttendance.is_voting_eligible == True,  # noqa: E712
            MeetingAttendance.status == AttendanceStatus.PRESENT,
        )
    )
    if attendance is None:
        raise PermissionError("不是本場會議可投票且已出席的成員")
    if vote.agenda_item_id is not None:
        recused = await session.scalar(
            select(MeetingAgendaRecusal).where(
                MeetingAgendaRecusal.agenda_item_id == vote.agenda_item_id,
                MeetingAgendaRecusal.user_id == voter_id,
            )
        )
        if recused is not None:
            raise PermissionError("此委員已對本案迴避，不可表決")


async def cast_ballot(
    session: AsyncSession, vote: MeetingVote, *, voter_id: uuid.UUID, choice: BallotChoice
) -> MeetingBallot:
    if vote.status != VoteStatus.OPEN:
        raise ValueError("表決尚未開放或已關閉")
    await _assert_voter_eligible(session, vote, voter_id)
    existing = await session.scalar(
        select(MeetingBallot).where(
            MeetingBallot.vote_id == vote.id, MeetingBallot.voter_id == voter_id
        )
    )
    if existing is not None:
        raise ValueError("此表決已投票，關閉前不可重複投票")
    ballot = MeetingBallot(
        vote_id=vote.id, voter_id=voter_id, choice=choice, cast_at=datetime.now(UTC)
    )
    session.add(ballot)
    await session.flush()
    return ballot


async def recorder_cast_ballot(
    session: AsyncSession, vote: MeetingVote, *, data: RecorderBallotCreate
) -> MeetingBallot:
    """紀錄代登逐人票（簡易模式）：可重複登記以更正，不要求操作者＝投票者。"""
    if vote.status != VoteStatus.OPEN:
        raise ValueError("表決尚未開放或已關閉")
    await _assert_voter_eligible(session, vote, data.voter_id)
    existing = await session.scalar(
        select(MeetingBallot).where(
            MeetingBallot.vote_id == vote.id, MeetingBallot.voter_id == data.voter_id
        )
    )
    if existing is not None:
        existing.choice = data.choice
        existing.option_key = data.option_key
        existing.cast_at = datetime.now(UTC)
        await session.flush()
        return existing
    ballot = MeetingBallot(
        vote_id=vote.id,
        voter_id=data.voter_id,
        choice=data.choice,
        option_key=data.option_key,
        cast_at=datetime.now(UTC),
    )
    session.add(ballot)
    await session.flush()
    return ballot


async def record_manual_tally(
    session: AsyncSession,
    vote: MeetingVote,
    *,
    manual_tally: dict[str, int],
    result_label: str | None = None,
) -> MeetingVote:
    """主席口頭計票：寫入彙總票數、設為 TALLY 方式並關閉表決。"""
    vote.record_method = VoteRecordMethod.TALLY
    vote.manual_tally = {str(k): int(v) for k, v in manual_tally.items()}
    if result_label:
        vote.result_label = result_label
    if vote.status == VoteStatus.DRAFT:
        vote.opened_at = datetime.now(UTC)
    vote.status = VoteStatus.CLOSED
    vote.closed_at = datetime.now(UTC)
    await session.flush()
    await _write_back_resolution(session, vote)
    return vote


async def record_acclamation(
    session: AsyncSession,
    meeting: Meeting,
    *,
    agenda_item_id: uuid.UUID | None,
    title: str,
    result_label: str = "無異議通過",
) -> MeetingVote:
    """無異議通過：一鍵建立並關閉 ACCLAMATION 表決。"""
    vote = MeetingVote(
        meeting_id=meeting.id,
        agenda_item_id=agenda_item_id,
        title=title,
        visibility=VoteVisibility.NAMED,
        record_method=VoteRecordMethod.ACCLAMATION,
        result_label=result_label,
        status=VoteStatus.CLOSED,
        opened_at=datetime.now(UTC),
        closed_at=datetime.now(UTC),
    )
    session.add(vote)
    await session.flush()
    await _write_back_resolution(session, vote)
    return vote


async def _write_back_resolution(session: AsyncSession, vote: MeetingVote) -> None:
    """表決關閉後把結論回寫議程案 resolution，供會議紀錄取用。"""
    if vote.agenda_item_id is None:
        return
    item = await session.get(MeetingAgendaItem, vote.agenda_item_id)
    if item is None:
        return
    eligible = await eligible_voter_count(session, vote.meeting_id)
    eligible -= await recused_voter_count(session, vote.meeting_id, vote.agenda_item_id)
    summary = await attendance_summary(session, vote.meeting_id)
    tally = _vote_tally(vote, max(eligible, 0), summary.get("present_voters", 0))
    item.resolution = _format_resolution(vote, tally)
    await session.flush()


def _format_resolution(vote: MeetingVote, tally: dict) -> str:
    """依表決方式產生決議文字。"""
    method = VoteRecordMethod(vote.record_method)
    if method == VoteRecordMethod.ACCLAMATION:
        return vote.result_label or "無異議通過"
    if vote.options:
        labels = {str(o.get("key")): str(o.get("label")) for o in vote.options}
        parts = [
            f"{labels.get(key, key)} {count} 票"
            for key, count in tally.get("option_counts", {}).items()
        ]
        body = "、".join(parts)
        return f"{body}；{vote.result_label}" if vote.result_label else body
    verdict = "通過" if tally.get("passed") else "不通過"
    return f"同意 {tally['approve']}、不同意 {tally['reject']}、棄權 {tally['abstain']}，{verdict}"


async def add_recusal(
    session: AsyncSession,
    agenda_item: MeetingAgendaItem,
    *,
    user_id: uuid.UUID,
    note: str | None,
    created_by: uuid.UUID,
) -> MeetingAgendaRecusal:
    existing = await session.scalar(
        select(MeetingAgendaRecusal).where(
            MeetingAgendaRecusal.agenda_item_id == agenda_item.id,
            MeetingAgendaRecusal.user_id == user_id,
        )
    )
    if existing is not None:
        existing.note = note
        await session.flush()
        return existing
    recusal = MeetingAgendaRecusal(
        agenda_item_id=agenda_item.id, user_id=user_id, note=note, created_by=created_by
    )
    session.add(recusal)
    await session.flush()
    return recusal


async def remove_recusal(
    session: AsyncSession, agenda_item: MeetingAgendaItem, *, user_id: uuid.UUID
) -> bool:
    recusal = await session.scalar(
        select(MeetingAgendaRecusal).where(
            MeetingAgendaRecusal.agenda_item_id == agenda_item.id,
            MeetingAgendaRecusal.user_id == user_id,
        )
    )
    if recusal is None:
        return False
    await session.delete(recusal)
    await session.flush()
    return True


async def create_request(
    session: AsyncSession,
    meeting: Meeting,
    *,
    user_id: uuid.UUID,
    data: MeetingRequestCreate,
) -> MeetingRequest:
    record = MeetingRequest(
        meeting_id=meeting.id,
        user_id=user_id,
        request_type=data.request_type,
        agenda_item_id=data.agenda_item_id or meeting.current_agenda_item_id,
        content=data.content,
    )
    session.add(record)
    await session.flush()
    return record


async def update_request_status(
    session: AsyncSession,
    record: MeetingRequest,
    *,
    status: MeetingRequestStatus,
) -> MeetingRequest:
    record.status = status
    await session.flush()
    return record


async def eligible_voter_count(session: AsyncSession, meeting_id: uuid.UUID) -> int:
    return int(
        await session.scalar(
            select(func.count()).where(
                MeetingAttendance.meeting_id == meeting_id,
                MeetingAttendance.is_voting_eligible == True,  # noqa: E712
            )
        )
        or 0
    )


async def recused_voter_count(
    session: AsyncSession, meeting_id: uuid.UUID, agenda_item_id: uuid.UUID
) -> int:
    """該議程案迴避且具表決權的委員人數。"""
    return int(
        await session.scalar(
            select(func.count())
            .select_from(MeetingAgendaRecusal)
            .join(
                MeetingAttendance,
                (MeetingAttendance.user_id == MeetingAgendaRecusal.user_id)
                & (MeetingAttendance.meeting_id == meeting_id),
            )
            .where(
                MeetingAgendaRecusal.agenda_item_id == agenda_item_id,
                MeetingAttendance.is_voting_eligible == True,  # noqa: E712
            )
        )
        or 0
    )


async def attendance_summary(session: AsyncSession, meeting_id: uuid.UUID) -> dict[str, int]:
    result = await session.execute(
        select(MeetingAttendance.status, func.count())
        .where(MeetingAttendance.meeting_id == meeting_id)
        .group_by(MeetingAttendance.status)
    )
    summary = {status.value: int(count) for status, count in result.all()}
    present_voters = await session.scalar(
        select(func.count()).where(
            MeetingAttendance.meeting_id == meeting_id,
            MeetingAttendance.status == AttendanceStatus.PRESENT,
            MeetingAttendance.is_voting_eligible == True,  # noqa: E712
        )
    )
    summary["present_voters"] = int(present_voters or 0)
    return summary


async def decorate_vote(session: AsyncSession, vote: MeetingVote, *, include_ballots: bool) -> dict:
    eligible = await eligible_voter_count(session, vote.meeting_id)
    # 逐案迴避：扣除該議程案迴避且具表決權的委員
    if vote.agenda_item_id is not None:
        eligible -= await recused_voter_count(session, vote.meeting_id, vote.agenda_item_id)
    eligible = max(eligible, 0)
    summary = await attendance_summary(session, vote.meeting_id)
    ballots = vote.ballots if include_ballots or vote.visibility == VoteVisibility.NAMED else []
    return {
        "id": vote.id,
        "meeting_id": vote.meeting_id,
        "agenda_item_id": vote.agenda_item_id,
        "title": vote.title,
        "description": vote.description,
        "visibility": vote.visibility,
        "status": vote.status,
        "pass_threshold": vote.pass_threshold,
        "threshold_type": vote.threshold_type,
        "record_method": vote.record_method,
        "options": vote.options,
        "manual_tally": vote.manual_tally,
        "result_label": vote.result_label,
        "opened_at": vote.opened_at,
        "closed_at": vote.closed_at,
        "result_note": vote.result_note,
        "created_at": vote.created_at,
        "updated_at": vote.updated_at,
        "tally": _vote_tally(vote, eligible, summary.get("present_voters", 0)),
        "ballots": ballots,
    }


def _vote_roster_status(record: dict[str, int]) -> str:
    choices = sum(1 for key in ("approve", "reject", "abstain") if record[key] > 0)
    if choices > 1:
        return "mixed"
    if record["approve"] > 0:
        return "approve"
    if record["reject"] > 0:
        return "reject"
    if record["abstain"] > 0:
        return "abstain"
    return "not_voted"


async def vote_roster_payload(
    session: AsyncSession, meeting: Meeting, vote: MeetingVote | None
) -> dict | None:
    if vote is None:
        return None

    class_rows = await session.execute(
        select(SchoolClass.id, SchoolClass.class_code, SchoolClass.label, SchoolClass.grade)
        .where(SchoolClass.is_active == True)  # noqa: E712
        .order_by(SchoolClass.grade.asc(), SchoolClass.class_code.asc())
    )
    records: dict[uuid.UUID | None, dict] = {
        class_id: {
            "class_id": class_id,
            "class_code": class_code,
            "label": label or class_code,
            "grade": grade,
            "eligible": 0,
            "present": 0,
            "approve": 0,
            "reject": 0,
            "abstain": 0,
            "not_voted": 0,
            "status": "not_voted",
        }
        for class_id, class_code, label, grade in class_rows.all()
    }
    unassigned = {
        "class_id": None,
        "class_code": "未分班",
        "label": "未分班",
        "grade": None,
        "eligible": 0,
        "present": 0,
        "approve": 0,
        "reject": 0,
        "abstain": 0,
        "not_voted": 0,
        "status": "not_voted",
    }
    eligible_records = [
        record for record in meeting.attendance_records if record.is_voting_eligible
    ]
    user_ids = [record.user_id for record in eligible_records if record.voting_class_id is None]
    user_class: dict[uuid.UUID, uuid.UUID] = {}
    if user_ids:
        membership_rows = await session.execute(
            select(ClassMembership.user_id, ClassMembership.class_id)
            .join(SchoolClass, SchoolClass.id == ClassMembership.class_id)
            .where(
                ClassMembership.user_id.in_(user_ids),
                ClassMembership.status == ClassMembershipStatus.ACTIVE,
                SchoolClass.is_active == True,  # noqa: E712
            )
            .order_by(ClassMembership.academic_year.desc())
        )
        for user_id, class_id in membership_rows.all():
            user_class.setdefault(user_id, class_id)

    ballots = {ballot.voter_id: ballot.choice for ballot in vote.ballots}
    for record in eligible_records:
        class_id = record.voting_class_id or user_class.get(record.user_id)
        target = records.get(class_id, unassigned)
        target["eligible"] += 1
        if record.status == AttendanceStatus.PRESENT:
            target["present"] += 1

        choice = ballots.get(record.user_id)
        if choice == BallotChoice.APPROVE:
            target["approve"] += 1
        elif choice == BallotChoice.REJECT:
            target["reject"] += 1
        elif choice == BallotChoice.ABSTAIN:
            target["abstain"] += 1
        else:
            target["not_voted"] += 1

    for record in records.values():
        record["status"] = _vote_roster_status(record)
    unassigned["status"] = _vote_roster_status(unassigned)

    return {
        "classes": list(records.values()),
        "unassigned": unassigned if unassigned["eligible"] > 0 else None,
    }


async def screen_payload(session: AsyncSession, meeting: Meeting) -> dict:
    current = next(
        (item for item in meeting.agenda_items if item.id == meeting.current_agenda_item_id), None
    )
    active_vote = next((vote for vote in meeting.votes if vote.status == VoteStatus.OPEN), None)
    timer_state = await get_or_create_timer_state(session, meeting)
    active_speech = next(
        (
            item
            for item in meeting.speech_queue
            if item.id == timer_state.active_speech_id
            or item.status in {SpeechQueueStatus.SPEAKING, SpeechQueueStatus.PAUSED}
        ),
        None,
    )
    return {
        "meeting": meeting,
        "current_agenda_item": current,
        "active_vote": await decorate_vote(session, active_vote, include_ballots=False)
        if active_vote
        else None,
        "attendance_summary": await attendance_summary(session, meeting.id),
        "screen_state": await get_or_create_screen_state(session, meeting),
        "vote_roster": await vote_roster_payload(session, meeting, active_vote),
        "active_speech": active_speech,
        "speech_queue": [
            item
            for item in sorted(meeting.speech_queue, key=lambda item: item.order_index)
            if item.status
            in {SpeechQueueStatus.QUEUED, SpeechQueueStatus.SPEAKING, SpeechQueueStatus.PAUSED}
        ],
        "timer_state": timer_state,
    }


async def join_payload(session: AsyncSession, meeting: Meeting, *, user_id: uuid.UUID) -> dict:
    record = await session.scalar(
        select(MeetingAttendance).where(
            MeetingAttendance.meeting_id == meeting.id,
            MeetingAttendance.user_id == user_id,
        )
    )
    current = next(
        (item for item in meeting.agenda_items if item.id == meeting.current_agenda_item_id), None
    )
    active_vote = next((vote for vote in meeting.votes if vote.status == VoteStatus.OPEN), None)
    my_ballot = (
        next((ballot for ballot in active_vote.ballots if ballot.voter_id == user_id), None)
        if active_vote
        else None
    )
    timer_state = await get_or_create_timer_state(session, meeting)
    active_speech = next(
        (
            item
            for item in meeting.speech_queue
            if item.id == timer_state.active_speech_id
            or item.status in {SpeechQueueStatus.SPEAKING, SpeechQueueStatus.PAUSED}
        ),
        None,
    )
    return {
        "meeting": meeting,
        "current_agenda_item": current,
        "attendance": record,
        "is_rostered": record is not None,
        "can_vote": bool(
            record and record.is_voting_eligible and record.status == AttendanceStatus.PRESENT
        ),
        "active_vote": await decorate_vote(session, active_vote, include_ballots=False)
        if active_vote
        else None,
        "my_ballot": my_ballot,
        "my_speech_queue_items": [
            item
            for item in sorted(meeting.speech_queue, key=lambda item: item.order_index)
            if item.user_id == user_id
            and item.status
            in {SpeechQueueStatus.QUEUED, SpeechQueueStatus.SPEAKING, SpeechQueueStatus.PAUSED}
        ],
        "active_speech": active_speech,
        "timer_state": timer_state,
    }


async def workspace_payload(session: AsyncSession) -> dict:
    today = local_today()
    rows = await list_meetings(session, limit=200)
    return {
        "today": [m for m in rows if m.starts_at and m.starts_at.date() == today],
        "drafts": [m for m in rows if m.status in {MeetingStatus.DRAFT, MeetingStatus.CONFIRMED}],
        "active": [
            m
            for m in rows
            if m.status
            in {
                MeetingStatus.CHECKIN,
                MeetingStatus.ACTIVE,
                MeetingStatus.BREAK,
                MeetingStatus.PAUSED,
            }
        ],
        "closing_pending": [m for m in rows if m.status == MeetingStatus.CLOSED],
    }


def _fmt_local(dt: datetime | None) -> str:
    return dt.astimezone(TAIPEI).strftime("%Y-%m-%d %H:%M") if dt else "未填"


def _attendee_names(meeting: Meeting, statuses: set[AttendanceStatus]) -> list[str]:
    return [
        (record.user.display_name if record.user else str(record.user_id))
        for record in meeting.attendance_records
        if record.status in statuses
    ]


def _full_minutes_lines(meeting: Meeting, votes: list[dict], summary: dict[str, int]) -> list[str]:
    lines = [
        f"# {meeting.title}",
        "",
        f"- 地點：{meeting.location or '未填'}",
        f"- 主席：{meeting.chair_name or '未填'}",
        f"- 出席表決權人數：{summary.get('present_voters', 0)}",
        "",
        "## 議程與決議",
    ]
    for item in sorted(meeting.agenda_items, key=lambda x: x.order_index):
        lines.append(f"### {item.order_index + 1}. {item.title}")
        if item.description:
            lines.append(item.description)
        if item.artifact_links:
            lines.append("資料包：")
            for link in item.artifact_links:
                suffix = f" {link.url}" if link.url else ""
                lines.append(f"- {link.title}{suffix}")
        if item.attachments:
            lines.append("附件：")
            for attachment in item.attachments:
                lines.append(f"- {attachment.display_name or attachment.filename}")
        if item.resolution:
            lines.append(f"決議：{item.resolution}")
    if meeting.motions:
        lines.extend(["", "## 動議"])
        for motion in meeting.motions:
            lines.append(f"- {motion.title}（{motion.status}）")
    if meeting.decisions:
        lines.extend(["", "## 正式決議"])
        for decision in meeting.decisions:
            lines.append(f"- {decision.title}：{decision.content}")
    if meeting.speech_queue:
        lines.extend(["", "## 發言紀錄"])
        for item in sorted(meeting.speech_queue, key=lambda x: x.started_at or x.created_at):
            if item.status in {SpeechQueueStatus.FINISHED, SpeechQueueStatus.SKIPPED}:
                lines.append(f"- {item.speaker_name}：{item.status}")
    lines.extend(["", "## 表決"])
    for vote in votes:
        tally = vote["tally"]
        lines.append(
            f"- {vote['title']}：同意 {tally['approve']}、反對 {tally['reject']}、"
            f"棄權 {tally['abstain']}，{'通過' if tally['passed'] else '未通過'}"
        )
    return lines


def _simple_minutes_lines(meeting: Meeting, summary: dict[str, int]) -> list[str]:
    present = _attendee_names(meeting, {AttendanceStatus.PRESENT})
    leave = _attendee_names(meeting, {AttendanceStatus.LEAVE})
    absent = _attendee_names(meeting, {AttendanceStatus.ABSENT})
    lines = [
        f"# {meeting.title}",
        "",
        f"- 開會時間：{_fmt_local(meeting.starts_at)}",
        f"- 地點：{meeting.location or '未填'}",
        f"- 主席：{meeting.chair_name or '未填'}",
        f"- 出席委員（{len(present)}）：{'、'.join(present) or '無'}",
    ]
    if leave:
        lines.append(f"- 請假：{'、'.join(leave)}")
    if absent:
        lines.append(f"- 缺席：{'、'.join(absent)}")
    lines.extend(["", "## 討論事項"])
    for item in sorted(meeting.agenda_items, key=lambda x: x.order_index):
        lines.append(f"### {item.order_index + 1}. {item.title}")
        if item.description:
            lines.append(f"說明：{item.description}")
        if item.notes:
            lines.append(f"討論：{item.notes}")
        recused = [(r.user.display_name if r.user else str(r.user_id)) for r in item.recusals]
        if recused:
            lines.append(f"（{'、'.join(recused)}委員迴避）")
        lines.append(f"決議：{item.resolution or '未做成決議'}")
        lines.append("")
    return lines


async def minutes_payload(session: AsyncSession, meeting: Meeting) -> dict:
    votes = [await decorate_vote(session, vote, include_ballots=True) for vote in meeting.votes]
    summary = await attendance_summary(session, meeting.id)
    if meeting.mode == MeetingMode.SIMPLE:
        lines = _simple_minutes_lines(meeting, summary)
    else:
        lines = _full_minutes_lines(meeting, votes, summary)
    return {
        "meeting": meeting,
        "attendance_summary": summary,
        "agenda_items": sorted(meeting.agenda_items, key=lambda x: x.order_index),
        "votes": votes,
        "events": await list_events(session, meeting.id),
        "markdown": "\n".join(lines),
    }
