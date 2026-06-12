"""議程 / 出勤 / 法案推進 / 議事事件"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.models.meeting import (
    AgendaItemType,
    AttendanceRole,
    AttendanceSourceType,
    AttendanceStatus,
    Meeting,
    MeetingAgendaItem,
    MeetingArtifactLink,
    MeetingAttendance,
    MeetingAttendanceSource,
    MeetingBillStage,
    MeetingEvent,
    MeetingStatus,
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
)
from api.services import school_class as class_svc
from api.services._base import apply_updates
from api.services.permission import active_tenure_filter

# 各階段「自動帶入議程」的法案狀態
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
    apply_updates(item, data)
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
