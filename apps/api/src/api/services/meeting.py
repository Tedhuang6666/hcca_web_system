"""議事系統服務層。"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.meeting import (
    AgendaItemType,
    AttendanceRole,
    AttendanceSourceType,
    AttendanceStatus,
    BallotChoice,
    Meeting,
    MeetingAgendaItem,
    MeetingArtifactLink,
    MeetingAttendance,
    MeetingAttendanceSource,
    MeetingBallot,
    MeetingBillStage,
    MeetingDecision,
    MeetingMotion,
    MeetingRequest,
    MeetingRequestStatus,
    MeetingScreenState,
    MeetingStatus,
    MeetingVote,
    VoteStatus,
    VoteVisibility,
)
from api.models.org import Org, Permission, Position, UserPosition
from api.models.regulation import Regulation, RegulationWorkflowStatus
from api.models.school_class import ClassCadre
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
    ScreenStateUpdate,
    VoteCreate,
    VoteUpdate,
)
from api.services import school_class as class_svc
from api.services.permission import active_tenure_filter


def _new_token() -> str:
    return secrets.token_urlsafe(32)


def _vote_tally(vote: MeetingVote, eligible_count: int) -> dict[str, int | bool]:
    approve = sum(1 for b in vote.ballots if b.choice == BallotChoice.APPROVE)
    reject = sum(1 for b in vote.ballots if b.choice == BallotChoice.REJECT)
    abstain = sum(1 for b in vote.ballots if b.choice == BallotChoice.ABSTAIN)
    total = approve + reject + abstain
    threshold = vote.pass_threshold or 0
    return {
        "approve": approve,
        "reject": reject,
        "abstain": abstain,
        "total": total,
        "eligible": eligible_count,
        "pass_threshold": threshold,
        "passed": approve >= threshold if threshold > 0 else approve > reject,
    }


async def get_meeting(session: AsyncSession, meeting_id: uuid.UUID) -> Meeting | None:
    result = await session.execute(
        select(Meeting)
        .options(
            selectinload(Meeting.agenda_items).selectinload(MeetingAgendaItem.regulation),
            selectinload(Meeting.agenda_items).selectinload(MeetingAgendaItem.attachments),
            selectinload(Meeting.agenda_items).selectinload(MeetingAgendaItem.artifact_links),
            selectinload(Meeting.attendance_records).selectinload(MeetingAttendance.user),
            selectinload(Meeting.attendance_records).selectinload(MeetingAttendance.proxy_for_user),
            selectinload(Meeting.attendance_sources),
            selectinload(Meeting.votes)
            .selectinload(MeetingVote.ballots)
            .selectinload(MeetingBallot.voter),
            selectinload(Meeting.requests).selectinload(MeetingRequest.user),
            selectinload(Meeting.motions).selectinload(MeetingMotion.proposer),
            selectinload(Meeting.decisions),
            selectinload(Meeting.screen_state),
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
    limit: int = 50,
    offset: int = 0,
) -> list[Meeting]:
    stmt = select(Meeting).order_by(Meeting.starts_at.desc().nullslast(), Meeting.created_at.desc())
    if org_id:
        stmt = stmt.where(Meeting.org_id == org_id)
    if status:
        stmt = stmt.where(Meeting.status == status)
    result = await session.execute(stmt.limit(limit).offset(offset))
    return list(result.scalars().all())


async def create_meeting(
    session: AsyncSession, *, data: MeetingCreate, created_by: uuid.UUID
) -> Meeting:
    # 未指定時，依開會組織在議事流程的角色自動偵測法案審議階段
    org = await session.get(Org, data.org_id)
    meeting = Meeting(
        org_id=data.org_id,
        title=data.title,
        description=data.description,
        location=data.location,
        chair_name=data.chair_name,
        starts_at=data.starts_at,
        ends_at=data.ends_at,
        expected_voters=data.expected_voters,
        quorum_count=data.quorum_count,
        default_pass_threshold=data.default_pass_threshold,
        bill_stage=data.bill_stage or (org.bill_stage if org else None),
        screen_token=_new_token(),
        checkin_token=_new_token(),
        created_by=created_by,
    )
    session.add(meeting)
    await session.flush()
    session.add(MeetingScreenState(meeting_id=meeting.id))
    await session.flush()
    await seed_voter_roster(session, meeting)
    return meeting


async def update_meeting(
    session: AsyncSession, meeting: Meeting, *, data: MeetingUpdate
) -> Meeting:
    values = data.model_dump(exclude_unset=True)
    for field, value in values.items():
        setattr(meeting, field, value)
    await session.flush()
    return meeting


async def transition_meeting(
    session: AsyncSession, meeting: Meeting, *, status: MeetingStatus
) -> Meeting:
    if meeting.status == MeetingStatus.CLOSED and status != MeetingStatus.CLOSED:
        raise ValueError("已結束的會議不可重新開啟")
    meeting.status = status
    if status == MeetingStatus.CLOSED and meeting.ends_at is None:
        meeting.ends_at = datetime.now(UTC)
    await session.flush()
    return meeting


async def _create_notice_document(session: AsyncSession, meeting: Meeting, *, actor: User):
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


async def confirm_meeting(session: AsyncSession, meeting: Meeting, *, actor: User) -> Meeting:
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
    invalid_items = [
        item.title for item in meeting.agenda_items if not _agenda_item_has_packet(item)
    ]
    if invalid_items:
        raise ValueError(f"下列議程缺少對應法規或詳情檔案：{'、'.join(invalid_items[:5])}")

    notice = await _create_notice_document(session, meeting, actor=actor)
    meeting.notice_document_id = notice.id
    meeting.confirmed_at = datetime.now(UTC)
    await session.flush()
    return meeting


def _agenda_item_has_packet(item: MeetingAgendaItem) -> bool:
    if item.item_type == AgendaItemType.REGULATION:
        return item.regulation_id is not None
    if item.item_type == AgendaItemType.DOCUMENT:
        return item.document_id is not None
    return bool(
        item.description
        or item.notes
        or item.regulation_id
        or item.document_id
        or item.attachments
        or item.artifact_links
    )


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
    if meeting.status != MeetingStatus.DRAFT:
        raise ValueError("僅草稿狀態的會議可以刪除議程項目")
    if meeting.current_agenda_item_id == item.id:
        meeting.current_agenda_item_id = None
    await session.delete(item)
    await session.flush()


async def seed_voter_roster(session: AsyncSession, meeting: Meeting) -> int:
    """用 meeting:vote 權限與有效任期建立預設表決權名冊。"""
    today = datetime.now(UTC).date()
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
        session.add(
            MeetingAttendance(
                meeting_id=meeting.id,
                user_id=user_id,
                role=AttendanceRole.VOTER,
                status=AttendanceStatus.EXPECTED,
                is_voting_eligible=True,
            )
        )
        inserted += 1
    if inserted:
        await session.flush()
    return inserted


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
    today = datetime.now(UTC).date()
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
        record = MeetingAttendance(meeting_id=meeting.id, **values)
        if record.status == AttendanceStatus.PRESENT and record.checked_in_at is None:
            record.checked_in_at = datetime.now(UTC)
        session.add(record)
    else:
        for field, value in values.items():
            setattr(record, field, value)
        if record.status == AttendanceStatus.PRESENT and record.checked_in_at is None:
            record.checked_in_at = datetime.now(UTC)
    await session.flush()
    return record


async def update_attendance(
    session: AsyncSession, record: MeetingAttendance, *, data: AttendanceUpdate
) -> MeetingAttendance:
    for field, value in data.model_dump(exclude_unset=True).items():
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
    decision = MeetingDecision(meeting_id=meeting.id, created_by=created_by, **data.model_dump())
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
    return vote


async def cast_ballot(
    session: AsyncSession, vote: MeetingVote, *, voter_id: uuid.UUID, choice: BallotChoice
) -> MeetingBallot:
    if vote.status != VoteStatus.OPEN:
        raise ValueError("表決尚未開放或已關閉")
    attendance = await session.scalar(
        select(MeetingAttendance).where(
            MeetingAttendance.meeting_id == vote.meeting_id,
            MeetingAttendance.user_id == voter_id,
            MeetingAttendance.is_voting_eligible == True,  # noqa: E712
            MeetingAttendance.status == AttendanceStatus.PRESENT,
        )
    )
    if attendance is None:
        raise PermissionError("您不是本場會議可投票且已出席的成員")
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
        "opened_at": vote.opened_at,
        "closed_at": vote.closed_at,
        "result_note": vote.result_note,
        "created_at": vote.created_at,
        "updated_at": vote.updated_at,
        "tally": _vote_tally(vote, eligible),
        "ballots": ballots,
    }


async def screen_payload(session: AsyncSession, meeting: Meeting) -> dict:
    current = next(
        (item for item in meeting.agenda_items if item.id == meeting.current_agenda_item_id), None
    )
    active_vote = next((vote for vote in meeting.votes if vote.status == VoteStatus.OPEN), None)
    return {
        "meeting": meeting,
        "current_agenda_item": current,
        "active_vote": await decorate_vote(session, active_vote, include_ballots=False)
        if active_vote
        else None,
        "attendance_summary": await attendance_summary(session, meeting.id),
        "screen_state": await get_or_create_screen_state(session, meeting),
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
    }


async def workspace_payload(session: AsyncSession) -> dict:
    today = datetime.now(UTC).date()
    rows = await list_meetings(session, limit=200)
    return {
        "today": [m for m in rows if m.starts_at and m.starts_at.date() == today],
        "drafts": [m for m in rows if m.status == MeetingStatus.DRAFT],
        "active": [m for m in rows if m.status in {MeetingStatus.ACTIVE, MeetingStatus.PAUSED}],
        "closing_pending": [m for m in rows if m.status == MeetingStatus.CLOSED],
    }


async def minutes_payload(session: AsyncSession, meeting: Meeting) -> dict:
    votes = [await decorate_vote(session, vote, include_ballots=True) for vote in meeting.votes]
    summary = await attendance_summary(session, meeting.id)
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
    lines.append("")
    lines.append("## 表決")
    for vote in votes:
        tally = vote["tally"]
        lines.append(
            f"- {vote['title']}：同意 {tally['approve']}、反對 {tally['reject']}、"
            f"棄權 {tally['abstain']}，{'通過' if tally['passed'] else '未通過'}"
        )
    return {
        "meeting": meeting,
        "attendance_summary": summary,
        "agenda_items": sorted(meeting.agenda_items, key=lambda x: x.order_index),
        "votes": votes,
        "markdown": "\n".join(lines),
    }
