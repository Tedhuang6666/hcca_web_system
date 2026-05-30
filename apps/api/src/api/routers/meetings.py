"""議事系統 Router - 會議 / 議程 / 出列席 / 表決 / 大屏"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.core.ws_manager import manager
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.models.document import DocumentCategory, DocumentStatus
from api.models.meeting import (
    Meeting,
    MeetingAgendaAttachment,
    MeetingAgendaItem,
    MeetingArtifactLink,
    MeetingAttendance,
    MeetingDecision,
    MeetingMotion,
    MeetingRequest,
    MeetingSpeechQueueItem,
    MeetingStatus,
    MeetingVote,
    SpeechQueueStatus,
)
from api.models.regulation import Regulation
from api.models.user import User
from api.schemas.document import DocumentCreate, RecipientCreate
from api.schemas.meeting import (
    AgendaAttachmentLinkCreate,
    AgendaAttachmentOut,
    AgendaItemCreate,
    AgendaItemOut,
    AgendaItemUpdate,
    ArtifactLinkCreate,
    ArtifactLinkOut,
    ArtifactLinkUpdate,
    AttendanceCreate,
    AttendanceOut,
    AttendanceSourceCreate,
    AttendanceSourceOut,
    AttendanceSourcePreviewOut,
    AttendanceSourceResolveRequest,
    AttendanceUpdate,
    BallotCreate,
    BallotOut,
    DecisionCreate,
    DecisionOut,
    DecisionUpdate,
    MeetingConfirmCreate,
    MeetingCreate,
    MeetingDocumentDraftOut,
    MeetingEventOut,
    MeetingJoinOut,
    MeetingListItem,
    MeetingMinutesOut,
    MeetingOut,
    MeetingRequestCreate,
    MeetingRequestOut,
    MeetingRequestUpdate,
    MeetingScreenOut,
    MeetingUpdate,
    MeetingWorkspaceOut,
    MotionCreate,
    MotionOut,
    MotionUpdate,
    RegulationBrief,
    ScreenStateOut,
    ScreenStateUpdate,
    SpeechQueueCreate,
    SpeechQueueExtend,
    SpeechQueueItemOut,
    SpeechQueueReorder,
    SpeechQueueUpdate,
    VoteCreate,
    VoteOut,
    VoteUpdate,
)
from api.services import audit as audit_svc
from api.services import document as document_svc
from api.services import meeting as meeting_svc
from api.services.storage import get_storage

router = APIRouter(prefix="/meetings", tags=["議事系統"])
public_router = APIRouter(prefix="/public/meetings", tags=["公開議事大屏"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


async def _meeting_or_404(session: AsyncSession, meeting_id: uuid.UUID) -> Meeting:
    meeting = await meeting_svc.get_meeting(session, meeting_id)
    if meeting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此會議")
    storage = get_storage()
    for item in meeting.agenda_items:
        for attachment in item.attachments:
            attachment.__dict__["url"] = (
                await storage.get_url(attachment.storage_key) if attachment.storage_key else ""
            )
    return meeting


async def _agenda_or_404(
    session: AsyncSession, meeting: Meeting, agenda_item_id: uuid.UUID
) -> MeetingAgendaItem:
    item = next((x for x in meeting.agenda_items if x.id == agenda_item_id), None)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此議程項目")
    return item


async def _agenda_attachment_or_404(
    session: AsyncSession, item: MeetingAgendaItem, attachment_id: uuid.UUID
) -> MeetingAgendaAttachment:
    result = await session.execute(
        select(MeetingAgendaAttachment).where(
            MeetingAgendaAttachment.id == attachment_id,
            MeetingAgendaAttachment.agenda_item_id == item.id,
        )
    )
    attachment = result.scalar_one_or_none()
    if attachment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此議程附件")
    return attachment


async def _artifact_link_or_404(
    session: AsyncSession, item: MeetingAgendaItem, link_id: uuid.UUID
) -> MeetingArtifactLink:
    result = await session.execute(
        select(MeetingArtifactLink).where(
            MeetingArtifactLink.id == link_id,
            MeetingArtifactLink.agenda_item_id == item.id,
        )
    )
    link = result.scalar_one_or_none()
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此議程資料包")
    return link


async def _attendance_or_404(
    session: AsyncSession, meeting_id: uuid.UUID, attendance_id: uuid.UUID
) -> MeetingAttendance:
    record = await session.get(MeetingAttendance, attendance_id)
    if record is None or record.meeting_id != meeting_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此出席紀錄")
    return record


async def _motion_or_404(
    session: AsyncSession, meeting_id: uuid.UUID, motion_id: uuid.UUID
) -> MeetingMotion:
    motion = await session.get(MeetingMotion, motion_id)
    if motion is None or motion.meeting_id != meeting_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此動議")
    return motion


async def _decision_or_404(
    session: AsyncSession, meeting_id: uuid.UUID, decision_id: uuid.UUID
) -> MeetingDecision:
    decision = await session.get(MeetingDecision, decision_id)
    if decision is None or decision.meeting_id != meeting_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此決議")
    return decision


async def _vote_or_404(session: AsyncSession, meeting: Meeting, vote_id: uuid.UUID) -> MeetingVote:
    vote = next((x for x in meeting.votes if x.id == vote_id), None)
    if vote is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此表決")
    return vote


async def _request_or_404(
    session: AsyncSession, meeting_id: uuid.UUID, request_id: uuid.UUID
) -> MeetingRequest:
    record = await session.get(MeetingRequest, request_id)
    if record is None or record.meeting_id != meeting_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此議事請求")
    return record


async def _speech_or_404(
    session: AsyncSession, meeting_id: uuid.UUID, speech_id: uuid.UUID
) -> MeetingSpeechQueueItem:
    record = await session.get(MeetingSpeechQueueItem, speech_id)
    if record is None or record.meeting_id != meeting_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此發言項目")
    return record


async def _broadcast_meeting(session: AsyncSession, meeting_id: uuid.UUID, event: str) -> None:
    meeting = await meeting_svc.get_meeting(session, meeting_id)
    if meeting is None:
        return
    payload = await meeting_svc.screen_payload(session, meeting)
    message = manager.build_message(event, payload, room=f"meeting:{meeting_id}")
    await manager.broadcast_to_room(
        f"meeting:{meeting_id}",
        message,
    )
    await manager.broadcast_to_room(f"meeting-screen:{meeting.screen_token}", message)


async def _record_event(
    session: AsyncSession,
    meeting: Meeting,
    *,
    event_type: str,
    actor: User | None = None,
    agenda_item_id: uuid.UUID | None = None,
    payload: dict | None = None,
) -> None:
    await meeting_svc.record_event(
        session,
        meeting,
        event_type=event_type,
        actor_id=actor.id if actor else None,
        agenda_item_id=agenda_item_id,
        payload=payload,
    )


@router.get("", response_model=list[MeetingListItem], summary="列出會議")
async def list_meetings(
    session: DbDep,
    current_user: CurrentUser,
    org_id: uuid.UUID | None = Query(None),
    status_filter: MeetingStatus | None = Query(None, alias="status"),
    invited_only: bool = Query(False, description="僅回傳目前使用者受邀（列入名冊）的會議"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[Meeting]:
    return await meeting_svc.list_meetings(
        session,
        org_id=org_id,
        status=status_filter,
        attendee_id=current_user.id if invited_only else None,
        limit=limit,
        offset=offset,
    )


@router.get("/workspace", response_model=MeetingWorkspaceOut, summary="議事工作台摘要")
async def meeting_workspace(session: DbDep, _: CurrentUser) -> dict:
    return await meeting_svc.workspace_payload(session)


@router.get("/join/{token}", response_model=MeetingJoinOut, summary="由 QR / 簽到碼進入會議")
async def join_meeting(token: str, session: DbDep, current_user: CurrentUser) -> dict:
    meeting = await meeting_svc.get_meeting_by_join_token(session, token)
    if meeting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此會議入口")
    return await meeting_svc.join_payload(session, meeting, user_id=current_user.id)


@router.post(
    "",
    response_model=MeetingOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立會議（meeting:create）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CREATE))],
)
async def create_meeting(
    payload: MeetingCreate, session: DbDep, current_user: CurrentUser
) -> Meeting:
    try:
        meeting = await meeting_svc.create_meeting(
            session, data=payload, created_by=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await _record_event(
        session,
        meeting,
        event_type="meeting.created",
        actor=current_user,
        payload={"title": meeting.title, "org_id": str(meeting.org_id)},
    )
    await audit_svc.record(
        session,
        entity_type="meeting",
        entity_id=str(meeting.id),
        action="meeting.create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"org_id": str(meeting.org_id), "title": meeting.title},
        summary=f"建立會議「{meeting.title}」",
    )
    return await _meeting_or_404(session, meeting.id)


@router.get("/{meeting_id}", response_model=MeetingOut, summary="取得會議詳細")
async def get_meeting(meeting_id: uuid.UUID, session: DbDep, _: CurrentUser) -> Meeting:
    return await _meeting_or_404(session, meeting_id)


@router.patch(
    "/{meeting_id}",
    response_model=MeetingOut,
    summary="更新會議（meeting:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_MANAGE))],
)
async def update_meeting(
    meeting_id: uuid.UUID,
    payload: MeetingUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> Meeting:
    meeting = await _meeting_or_404(session, meeting_id)
    old_agenda_item_id = meeting.current_agenda_item_id
    meeting = await meeting_svc.update_meeting(
        session, meeting, data=payload, actor_id=current_user.id
    )
    values = payload.model_dump(exclude_unset=True, mode="json")
    if "current_agenda_item_id" in values and old_agenda_item_id != meeting.current_agenda_item_id:
        await _record_event(
            session,
            meeting,
            event_type="agenda.changed",
            actor=current_user,
            agenda_item_id=meeting.current_agenda_item_id,
            payload={
                "from_agenda_item_id": str(old_agenda_item_id) if old_agenda_item_id else None,
                "to_agenda_item_id": str(meeting.current_agenda_item_id)
                if meeting.current_agenda_item_id
                else None,
            },
        )
    else:
        await _record_event(
            session,
            meeting,
            event_type="meeting.updated",
            actor=current_user,
            payload=values,
        )
    await audit_svc.record(
        session,
        entity_type="meeting",
        entity_id=str(meeting.id),
        action="meeting.update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=values,
        summary=f"更新會議「{meeting.title}」",
    )
    await _broadcast_meeting(session, meeting.id, "meeting.updated")
    return await _meeting_or_404(session, meeting.id)


@router.post(
    "/{meeting_id}/start",
    response_model=MeetingOut,
    summary="開始會議（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def start_meeting(
    meeting_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> Meeting:
    meeting = await _meeting_or_404(session, meeting_id)
    try:
        await meeting_svc.transition_meeting(
            session, meeting, status=MeetingStatus.ACTIVE, actor_id=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await _record_event(session, meeting, event_type="meeting.started", actor=current_user)
    await _broadcast_meeting(session, meeting.id, "meeting.started")
    return await _meeting_or_404(session, meeting.id)


@router.post(
    "/{meeting_id}/check-in/open",
    response_model=MeetingOut,
    summary="開放報到（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def open_checkin(meeting_id: uuid.UUID, session: DbDep, current_user: CurrentUser) -> Meeting:
    meeting = await _meeting_or_404(session, meeting_id)
    try:
        await meeting_svc.transition_meeting(
            session, meeting, status=MeetingStatus.CHECKIN, actor_id=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await _record_event(session, meeting, event_type="meeting.checkin_opened", actor=current_user)
    await _broadcast_meeting(session, meeting.id, "meeting.checkin_opened")
    return await _meeting_or_404(session, meeting.id)


@router.post(
    "/{meeting_id}/pause",
    response_model=MeetingOut,
    summary="暫停會議（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def pause_meeting(
    meeting_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> Meeting:
    meeting = await _meeting_or_404(session, meeting_id)
    try:
        await meeting_svc.transition_meeting(
            session, meeting, status=MeetingStatus.PAUSED, actor_id=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await _record_event(session, meeting, event_type="meeting.paused", actor=current_user)
    await _broadcast_meeting(session, meeting.id, "meeting.paused")
    return await _meeting_or_404(session, meeting.id)


@router.post(
    "/{meeting_id}/break",
    response_model=MeetingOut,
    summary="進入休息（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def break_meeting(
    meeting_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> Meeting:
    meeting = await _meeting_or_404(session, meeting_id)
    try:
        await meeting_svc.transition_meeting(
            session, meeting, status=MeetingStatus.BREAK, actor_id=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await meeting_svc.update_screen_state(
        session,
        meeting,
        data=ScreenStateUpdate(reading_mode="break", title="會議休息中"),
        updated_by=current_user.id,
    )
    await _record_event(session, meeting, event_type="meeting.break_started", actor=current_user)
    await _broadcast_meeting(session, meeting.id, "meeting.break_started")
    return await _meeting_or_404(session, meeting.id)


@router.post(
    "/{meeting_id}/close",
    response_model=MeetingOut,
    summary="結束會議（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def close_meeting(
    meeting_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> Meeting:
    meeting = await _meeting_or_404(session, meeting_id)
    try:
        await meeting_svc.transition_meeting(
            session, meeting, status=MeetingStatus.CLOSED, actor_id=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await _record_event(session, meeting, event_type="meeting.closed", actor=current_user)
    await _broadcast_meeting(session, meeting.id, "meeting.closed")
    return await _meeting_or_404(session, meeting.id)


@router.post(
    "/{meeting_id}/archive",
    response_model=MeetingOut,
    summary="封存會議（meeting:export）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_EXPORT))],
)
async def archive_meeting(
    meeting_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> Meeting:
    meeting = await _meeting_or_404(session, meeting_id)
    try:
        await meeting_svc.transition_meeting(
            session, meeting, status=MeetingStatus.ARCHIVED, actor_id=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await _record_event(session, meeting, event_type="meeting.archived", actor=current_user)
    await _broadcast_meeting(session, meeting.id, "meeting.archived")
    return await _meeting_or_404(session, meeting.id)


@router.post(
    "/{meeting_id}/confirm",
    response_model=MeetingOut,
    summary="確認議程草稿並產生開會通知單（meeting:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_MANAGE))],
)
async def confirm_meeting(
    meeting_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
    payload: MeetingConfirmCreate | None = None,
) -> Meeting:
    meeting = await _meeting_or_404(session, meeting_id)
    payload = payload or MeetingConfirmCreate()
    try:
        await meeting_svc.confirm_meeting(
            session,
            meeting,
            actor=current_user,
            notice_serial_template_id=payload.notice_serial_template_id,
            notice_serial_number=payload.notice_serial_number,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await _record_event(
        session,
        meeting,
        event_type="meeting.confirmed",
        actor=current_user,
        payload={
            "notice_document_id": str(meeting.notice_document_id),
            "notice_serial_number": payload.notice_serial_number,
            "notice_serial_template_id": str(payload.notice_serial_template_id)
            if payload.notice_serial_template_id
            else None,
        },
    )
    await audit_svc.record(
        session,
        entity_type="meeting",
        entity_id=str(meeting.id),
        action="meeting.confirm",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"notice_document_id": str(meeting.notice_document_id)},
        summary=f"確認會議「{meeting.title}」議程並產生開會通知單",
    )
    await _broadcast_meeting(session, meeting.id, "meeting.confirmed")
    return await _meeting_or_404(session, meeting.id)


@router.get(
    "/{meeting_id}/proposable-regulations",
    response_model=list[RegulationBrief],
    summary="自動偵測可排入議程的待審法案（meeting:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_MANAGE))],
)
async def list_proposable_regulations(
    meeting_id: uuid.UUID, session: DbDep, _: CurrentUser
) -> list[Regulation]:
    meeting = await _meeting_or_404(session, meeting_id)
    return await meeting_svc.list_proposable_regulations(session, meeting)


@router.post(
    "/{meeting_id}/agenda-items/sync-proposals",
    response_model=MeetingOut,
    summary="把偵測到的待審法案批次排入議程（meeting:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_MANAGE))],
)
async def sync_proposals(
    meeting_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> Meeting:
    meeting = await _meeting_or_404(session, meeting_id)
    added = await meeting_svc.sync_proposals_to_agenda(session, meeting)
    if added:
        await audit_svc.record(
            session,
            entity_type="meeting",
            entity_id=str(meeting.id),
            action="meeting.sync_proposals",
            actor_id=str(current_user.id),
            actor_email=current_user.email,
            meta={"added": added},
            summary=f"自動排入 {added} 件待審法案至會議「{meeting.title}」議程",
        )
        await _record_event(
            session,
            meeting,
            event_type="agenda.synced",
            actor=current_user,
            payload={"added": added},
        )
        await _broadcast_meeting(session, meeting.id, "meeting.agenda_updated")
    # 新排入的議程項目以 FK 建立，須 expire 已載入集合才能在重查時取得
    session.expire(meeting, ["agenda_items"])
    return await _meeting_or_404(session, meeting.id)


@router.post(
    "/{meeting_id}/agenda-items",
    response_model=AgendaItemOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增議程項目（meeting:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_MANAGE))],
)
async def create_agenda_item(
    meeting_id: uuid.UUID, payload: AgendaItemCreate, session: DbDep, current_user: CurrentUser
) -> MeetingAgendaItem:
    meeting = await _meeting_or_404(session, meeting_id)
    try:
        item = await meeting_svc.create_agenda_item(session, meeting, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await _record_event(
        session,
        meeting,
        event_type="agenda.item_created",
        actor=current_user,
        agenda_item_id=item.id,
        payload={"title": item.title},
    )
    await _broadcast_meeting(session, meeting.id, "meeting.agenda_updated")
    # 新項目以 FK 建立，未進入已載入的 meeting.agenda_items 集合；
    # 須先 expire 該集合，重查時 selectinload 才會重新載入（含新項目與 regulation 關聯）
    session.expire(meeting, ["agenda_items"])
    refreshed = await _meeting_or_404(session, meeting.id)
    return await _agenda_or_404(session, refreshed, item.id)


@router.patch(
    "/{meeting_id}/agenda-items/reorder",
    response_model=list[AgendaItemOut],
    summary="批次重排議程（meeting:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_MANAGE))],
)
async def reorder_agenda_items(
    meeting_id: uuid.UUID,
    ordered_ids: list[uuid.UUID],
    session: DbDep,
    _: CurrentUser,
) -> list[MeetingAgendaItem]:
    meeting = await _meeting_or_404(session, meeting_id)
    try:
        await meeting_svc.reorder_agenda_items(session, meeting, ordered_ids=ordered_ids)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await _broadcast_meeting(session, meeting.id, "meeting.agenda_updated")
    return (await _meeting_or_404(session, meeting.id)).agenda_items


@router.patch(
    "/{meeting_id}/agenda-items/{agenda_item_id}",
    response_model=AgendaItemOut,
    summary="更新議程項目（meeting:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_MANAGE))],
)
async def update_agenda_item(
    meeting_id: uuid.UUID,
    agenda_item_id: uuid.UUID,
    payload: AgendaItemUpdate,
    session: DbDep,
    _: CurrentUser,
) -> MeetingAgendaItem:
    meeting = await _meeting_or_404(session, meeting_id)
    item = await _agenda_or_404(session, meeting, agenda_item_id)
    item = await meeting_svc.update_agenda_item(session, item, data=payload)
    await _broadcast_meeting(session, meeting.id, "meeting.agenda_updated")
    # 重新查詢以含有最新的 regulation 關聯
    refreshed = await _meeting_or_404(session, meeting.id)
    return await _agenda_or_404(session, refreshed, item.id)


@router.post(
    "/{meeting_id}/agenda-items/{agenda_item_id}/attachments",
    response_model=AgendaAttachmentOut,
    status_code=status.HTTP_201_CREATED,
    summary="上傳議程附件（meeting:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_MANAGE))],
)
async def upload_agenda_attachment(
    meeting_id: uuid.UUID,
    agenda_item_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
    file: UploadFile = File(..., description="議程附件檔案"),
) -> MeetingAgendaAttachment:
    meeting = await _meeting_or_404(session, meeting_id)
    item = await _agenda_or_404(session, meeting, agenda_item_id)
    storage = get_storage()
    try:
        stored = await storage.save(file, prefix=f"meetings/{meeting_id}/{agenda_item_id}")
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    attachment = MeetingAgendaAttachment(
        agenda_item_id=item.id,
        filename=stored.filename,
        storage_key=stored.storage_key,
        content_type=stored.content_type,
        file_size=stored.file_size,
        uploaded_by=current_user.id,
    )
    session.add(attachment)
    await session.flush()
    attachment.__dict__["url"] = stored.url
    await _broadcast_meeting(session, meeting.id, "meeting.agenda_updated")
    return attachment


@router.post(
    "/{meeting_id}/agenda-items/{agenda_item_id}/attachments/link",
    response_model=AgendaAttachmentOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增議程連結附件（meeting:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_MANAGE))],
)
async def add_agenda_link_attachment(
    meeting_id: uuid.UUID,
    agenda_item_id: uuid.UUID,
    payload: AgendaAttachmentLinkCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> MeetingAgendaAttachment:
    meeting = await _meeting_or_404(session, meeting_id)
    item = await _agenda_or_404(session, meeting, agenda_item_id)
    display = (
        payload.display_text.strip()
        if payload.display_text and payload.display_text.strip()
        else str(payload.url)
    )
    attachment = MeetingAgendaAttachment(
        agenda_item_id=item.id,
        filename=display,
        link_url=str(payload.url),
        uploaded_by=current_user.id,
    )
    session.add(attachment)
    await session.flush()
    attachment.__dict__["url"] = ""
    await _broadcast_meeting(session, meeting.id, "meeting.agenda_updated")
    return attachment


@router.post(
    "/{meeting_id}/agenda-items/{agenda_item_id}/artifact-links",
    response_model=ArtifactLinkOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增議程資料包關聯（meeting:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_MANAGE))],
)
async def create_artifact_link(
    meeting_id: uuid.UUID,
    agenda_item_id: uuid.UUID,
    payload: ArtifactLinkCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> MeetingArtifactLink:
    meeting = await _meeting_or_404(session, meeting_id)
    item = await _agenda_or_404(session, meeting, agenda_item_id)
    link = await meeting_svc.create_artifact_link(
        session, item, data=payload, created_by=current_user.id
    )
    await _broadcast_meeting(session, meeting.id, "meeting.agenda_updated")
    return link


@router.patch(
    "/{meeting_id}/agenda-items/{agenda_item_id}/artifact-links/{link_id}",
    response_model=ArtifactLinkOut,
    summary="更新議程資料包關聯（meeting:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_MANAGE))],
)
async def update_artifact_link(
    meeting_id: uuid.UUID,
    agenda_item_id: uuid.UUID,
    link_id: uuid.UUID,
    payload: ArtifactLinkUpdate,
    session: DbDep,
    _: CurrentUser,
) -> MeetingArtifactLink:
    meeting = await _meeting_or_404(session, meeting_id)
    item = await _agenda_or_404(session, meeting, agenda_item_id)
    link = await _artifact_link_or_404(session, item, link_id)
    await meeting_svc.update_artifact_link(session, link, data=payload)
    await _broadcast_meeting(session, meeting.id, "meeting.agenda_updated")
    return link


@router.delete(
    "/{meeting_id}/agenda-items/{agenda_item_id}/artifact-links/{link_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除議程資料包關聯（meeting:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_MANAGE))],
)
async def delete_artifact_link(
    meeting_id: uuid.UUID,
    agenda_item_id: uuid.UUID,
    link_id: uuid.UUID,
    session: DbDep,
    _: CurrentUser,
) -> None:
    meeting = await _meeting_or_404(session, meeting_id)
    item = await _agenda_or_404(session, meeting, agenda_item_id)
    link = await _artifact_link_or_404(session, item, link_id)
    await meeting_svc.delete_artifact_link(session, link)
    await _broadcast_meeting(session, meeting.id, "meeting.agenda_updated")


@router.delete(
    "/{meeting_id}/agenda-items/{agenda_item_id}/attachments/{attachment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除議程附件（meeting:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_MANAGE))],
)
async def delete_agenda_attachment(
    meeting_id: uuid.UUID,
    agenda_item_id: uuid.UUID,
    attachment_id: uuid.UUID,
    session: DbDep,
    _: CurrentUser,
) -> None:
    meeting = await _meeting_or_404(session, meeting_id)
    item = await _agenda_or_404(session, meeting, agenda_item_id)
    attachment = await _agenda_attachment_or_404(session, item, attachment_id)
    storage = get_storage()
    if attachment.storage_key:
        await storage.delete(attachment.storage_key)
    await session.delete(attachment)
    await _broadcast_meeting(session, meeting.id, "meeting.agenda_updated")


@router.get(
    "/{meeting_id}/agenda-items/{agenda_item_id}/attachments/{attachment_id}/download",
    summary="下載議程附件",
)
async def download_agenda_attachment(
    meeting_id: uuid.UUID,
    agenda_item_id: uuid.UUID,
    attachment_id: uuid.UUID,
    session: DbDep,
    _: CurrentUser,
) -> FileResponse:
    import os

    meeting = await _meeting_or_404(session, meeting_id)
    item = await _agenda_or_404(session, meeting, agenda_item_id)
    attachment = await _agenda_attachment_or_404(session, item, attachment_id)
    if not attachment.storage_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="此附件不是可下載檔案")
    file_path = os.path.join("uploads", attachment.storage_key)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="檔案不存在")
    return FileResponse(
        path=file_path,
        filename=attachment.display_name or attachment.filename,
        media_type=attachment.content_type or "application/octet-stream",
    )


@router.delete(
    "/{meeting_id}/agenda-items/{agenda_item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除草稿議程項目（meeting:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_MANAGE))],
)
async def delete_agenda_item(
    meeting_id: uuid.UUID,
    agenda_item_id: uuid.UUID,
    session: DbDep,
    _: CurrentUser,
) -> None:
    meeting = await _meeting_or_404(session, meeting_id)
    item = await _agenda_or_404(session, meeting, agenda_item_id)
    try:
        await meeting_svc.delete_agenda_item(session, meeting, item)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await _broadcast_meeting(session, meeting.id, "meeting.agenda_updated")


@router.post(
    "/{meeting_id}/agenda-items/{agenda_item_id}/advance-regulation",
    response_model=AgendaItemOut,
    summary="表決通過後依審議階段推進關聯法案（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def advance_agenda_regulation(
    meeting_id: uuid.UUID,
    agenda_item_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> MeetingAgendaItem:
    meeting = await _meeting_or_404(session, meeting_id)
    item = await _agenda_or_404(session, meeting, agenda_item_id)
    try:
        reg = await meeting_svc.advance_agenda_regulation(
            session, meeting, item, actor_id=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="regulation",
        entity_id=str(reg.id),
        action="regulation.advance_via_meeting",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "meeting_id": str(meeting.id),
            "agenda_item_id": str(item.id),
            "to_status": str(reg.workflow_status),
        },
        summary=f"由會議「{meeting.title}」推進法案「{reg.title}」至 {reg.workflow_status}",
    )
    await _broadcast_meeting(session, meeting.id, "meeting.agenda_updated")
    refreshed = await _meeting_or_404(session, meeting.id)
    return await _agenda_or_404(session, refreshed, agenda_item_id)


@router.post("/{meeting_id}/check-in", response_model=AttendanceOut, summary="QR 報到")
async def check_in(
    meeting_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
    token: str | None = Query(None),
) -> MeetingAttendance:
    meeting = await _meeting_or_404(session, meeting_id)
    try:
        record = await meeting_svc.check_in(session, meeting, user_id=current_user.id, token=token)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    await _record_event(
        session,
        meeting,
        event_type="attendance.checked_in",
        actor=current_user,
        payload={
            "attendance_id": str(record.id),
            "is_voting_eligible": record.is_voting_eligible,
            "voting_class_id": str(record.voting_class_id) if record.voting_class_id else None,
        },
    )
    await _broadcast_meeting(session, meeting.id, "meeting.attendance_updated")
    return record


@router.post(
    "/{meeting_id}/attendance/sources/resolve",
    response_model=AttendanceSourcePreviewOut,
    summary="預覽名冊來源成員（meeting:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_MANAGE))],
)
async def resolve_attendance_source(
    meeting_id: uuid.UUID,
    payload: AttendanceSourceResolveRequest,
    session: DbDep,
    _: CurrentUser,
) -> dict:
    await _meeting_or_404(session, meeting_id)
    try:
        label, users = await meeting_svc.resolve_attendance_source(session, payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    return {
        "source_type": payload.source_type,
        "source_id": payload.source_id,
        "label": label,
        "members": users,
        "count": len(users),
    }


@router.post(
    "/{meeting_id}/attendance/sources",
    response_model=AttendanceSourceOut,
    status_code=status.HTTP_201_CREATED,
    summary="由班級/組織/職位批次匯入名冊（meeting:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_MANAGE))],
)
async def import_attendance_source(
    meeting_id: uuid.UUID,
    payload: AttendanceSourceCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> object:
    meeting = await _meeting_or_404(session, meeting_id)
    try:
        source = await meeting_svc.import_attendance_source(
            session, meeting, data=payload, created_by=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await _record_event(
        session,
        meeting,
        event_type="attendance.imported",
        actor=current_user,
        payload={
            "source_type": source.source_type,
            "source_id": str(source.source_id) if source.source_id else None,
            "imported_count": source.imported_count,
            "is_voting_eligible": source.is_voting_eligible,
        },
    )
    await _broadcast_meeting(session, meeting.id, "meeting.attendance_updated")
    return source


@router.post(
    "/{meeting_id}/attendance",
    response_model=AttendanceOut,
    summary="管理端補登出列席（meeting:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_MANAGE))],
)
async def upsert_attendance(
    meeting_id: uuid.UUID, payload: AttendanceCreate, session: DbDep, current_user: CurrentUser
) -> MeetingAttendance:
    meeting = await _meeting_or_404(session, meeting_id)
    try:
        record = await meeting_svc.upsert_attendance(session, meeting, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await _record_event(
        session,
        meeting,
        event_type="attendance.upserted",
        actor=current_user,
        payload={
            "attendance_id": str(record.id),
            "user_id": str(record.user_id),
            "is_voting_eligible": record.is_voting_eligible,
            "voting_class_id": str(record.voting_class_id) if record.voting_class_id else None,
        },
    )
    await _broadcast_meeting(session, meeting.id, "meeting.attendance_updated")
    return record


@router.patch(
    "/{meeting_id}/attendance/{attendance_id}",
    response_model=AttendanceOut,
    summary="修改出列席紀錄（meeting:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_MANAGE))],
)
async def update_attendance(
    meeting_id: uuid.UUID,
    attendance_id: uuid.UUID,
    payload: AttendanceUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> MeetingAttendance:
    record = await _attendance_or_404(session, meeting_id, attendance_id)
    try:
        record = await meeting_svc.update_attendance(session, record, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    meeting = await _meeting_or_404(session, meeting_id)
    await _record_event(
        session,
        meeting,
        event_type="attendance.updated",
        actor=current_user,
        payload={
            "attendance_id": str(record.id),
            "user_id": str(record.user_id),
            "values": payload.model_dump(exclude_unset=True, mode="json"),
        },
    )
    await _broadcast_meeting(session, meeting_id, "meeting.attendance_updated")
    return record


@router.post(
    "/{meeting_id}/votes",
    response_model=VoteOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立表決（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def create_vote(
    meeting_id: uuid.UUID, payload: VoteCreate, session: DbDep, current_user: CurrentUser
) -> dict:
    meeting = await _meeting_or_404(session, meeting_id)
    vote = await meeting_svc.create_vote(session, meeting, data=payload)
    await _record_event(
        session,
        meeting,
        event_type="vote.created",
        actor=current_user,
        agenda_item_id=vote.agenda_item_id,
        payload={"vote_id": str(vote.id), "title": vote.title},
    )
    vote = (await _meeting_or_404(session, meeting_id)).votes[-1]
    await _broadcast_meeting(session, meeting.id, "meeting.vote_created")
    return await meeting_svc.decorate_vote(session, vote, include_ballots=True)


@router.patch(
    "/{meeting_id}/votes/{vote_id}",
    response_model=VoteOut,
    summary="更新表決（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def update_vote(
    meeting_id: uuid.UUID,
    vote_id: uuid.UUID,
    payload: VoteUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> dict:
    meeting = await _meeting_or_404(session, meeting_id)
    vote = await _vote_or_404(session, meeting, vote_id)
    vote = await meeting_svc.update_vote(session, vote, data=payload)
    await _record_event(
        session,
        meeting,
        event_type="vote.updated",
        actor=current_user,
        agenda_item_id=vote.agenda_item_id,
        payload={
            "vote_id": str(vote.id),
            "values": payload.model_dump(exclude_unset=True, mode="json"),
        },
    )
    await _broadcast_meeting(session, meeting.id, "meeting.vote_updated")
    return await meeting_svc.decorate_vote(session, vote, include_ballots=True)


@router.post(
    "/{meeting_id}/motions",
    response_model=MotionOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立會中動議（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def create_motion(
    meeting_id: uuid.UUID,
    payload: MotionCreate,
    session: DbDep,
    _: CurrentUser,
) -> MeetingMotion:
    meeting = await _meeting_or_404(session, meeting_id)
    motion = await meeting_svc.create_motion(session, meeting, data=payload)
    await _broadcast_meeting(session, meeting.id, "meeting.motion_created")
    return motion


@router.patch(
    "/{meeting_id}/motions/{motion_id}",
    response_model=MotionOut,
    summary="更新會中動議（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def update_motion(
    meeting_id: uuid.UUID,
    motion_id: uuid.UUID,
    payload: MotionUpdate,
    session: DbDep,
    _: CurrentUser,
) -> MeetingMotion:
    motion = await _motion_or_404(session, meeting_id, motion_id)
    await meeting_svc.update_motion(session, motion, data=payload)
    await _broadcast_meeting(session, meeting_id, "meeting.motion_updated")
    return motion


@router.post(
    "/{meeting_id}/decisions",
    response_model=DecisionOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立正式決議（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def create_decision(
    meeting_id: uuid.UUID,
    payload: DecisionCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> MeetingDecision:
    meeting = await _meeting_or_404(session, meeting_id)
    decision = await meeting_svc.create_decision(
        session, meeting, data=payload, created_by=current_user.id
    )
    await _record_event(
        session,
        meeting,
        event_type="decision.created",
        actor=current_user,
        agenda_item_id=decision.agenda_item_id,
        payload={
            "decision_id": str(decision.id),
            "vote_id": str(decision.vote_id) if decision.vote_id else None,
            "title": decision.title,
            "status": decision.status,
        },
    )
    await _broadcast_meeting(session, meeting.id, "meeting.decision_created")
    return decision


@router.patch(
    "/{meeting_id}/decisions/{decision_id}",
    response_model=DecisionOut,
    summary="更新正式決議（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def update_decision(
    meeting_id: uuid.UUID,
    decision_id: uuid.UUID,
    payload: DecisionUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> MeetingDecision:
    decision = await _decision_or_404(session, meeting_id, decision_id)
    await meeting_svc.update_decision(session, decision, data=payload)
    meeting = await _meeting_or_404(session, meeting_id)
    await _record_event(
        session,
        meeting,
        event_type="decision.updated",
        actor=current_user,
        agenda_item_id=decision.agenda_item_id,
        payload={
            "decision_id": str(decision.id),
            "values": payload.model_dump(exclude_unset=True, mode="json"),
        },
    )
    await _broadcast_meeting(session, meeting_id, "meeting.decision_updated")
    return decision


@router.post(
    "/{meeting_id}/votes/{vote_id}/open",
    response_model=VoteOut,
    summary="開啟表決（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def open_vote(
    meeting_id: uuid.UUID, vote_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> dict:
    meeting = await _meeting_or_404(session, meeting_id)
    vote = await _vote_or_404(session, meeting, vote_id)
    try:
        vote = await meeting_svc.open_vote(session, vote)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await _record_event(
        session,
        meeting,
        event_type="vote.opened",
        actor=current_user,
        agenda_item_id=vote.agenda_item_id,
        payload={"vote_id": str(vote.id), "title": vote.title},
    )
    await _broadcast_meeting(session, meeting.id, "meeting.vote_opened")
    return await meeting_svc.decorate_vote(session, vote, include_ballots=True)


@router.post(
    "/{meeting_id}/votes/{vote_id}/close",
    response_model=VoteOut,
    summary="關閉表決（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def close_vote(
    meeting_id: uuid.UUID, vote_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> dict:
    meeting = await _meeting_or_404(session, meeting_id)
    vote = await _vote_or_404(session, meeting, vote_id)
    try:
        vote = await meeting_svc.close_vote(session, vote)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    decorated = await meeting_svc.decorate_vote(session, vote, include_ballots=True)
    await _record_event(
        session,
        meeting,
        event_type="vote.closed",
        actor=current_user,
        agenda_item_id=vote.agenda_item_id,
        payload={
            "vote_id": str(vote.id),
            "title": vote.title,
            "tally": decorated["tally"],
            "vote_roster": await meeting_svc.vote_roster_payload(session, meeting, vote),
        },
    )
    await _broadcast_meeting(session, meeting.id, "meeting.vote_closed")
    return decorated


@router.post(
    "/{meeting_id}/votes/{vote_id}/ballot",
    response_model=BallotOut,
    summary="送出表決票（meeting:vote）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_VOTE))],
)
async def cast_ballot(
    meeting_id: uuid.UUID,
    vote_id: uuid.UUID,
    payload: BallotCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> object:
    meeting = await _meeting_or_404(session, meeting_id)
    vote = await _vote_or_404(session, meeting, vote_id)
    try:
        ballot = await meeting_svc.cast_ballot(
            session, vote, voter_id=current_user.id, choice=payload.choice
        )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await _record_event(
        session,
        meeting,
        event_type="vote.ballot_cast",
        actor=current_user,
        agenda_item_id=vote.agenda_item_id,
        payload={"vote_id": str(vote.id), "choice": payload.choice},
    )
    await _broadcast_meeting(session, meeting.id, "meeting.ballot_cast")
    return ballot


@router.post(
    "/{meeting_id}/requests",
    response_model=MeetingRequestOut,
    status_code=status.HTTP_201_CREATED,
    summary="議員提出發言/秩序問題/權宜問題",
)
async def create_meeting_request(
    meeting_id: uuid.UUID,
    payload: MeetingRequestCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> MeetingRequest:
    meeting = await _meeting_or_404(session, meeting_id)
    record = await meeting_svc.create_request(
        session, meeting, user_id=current_user.id, data=payload
    )
    await _record_event(
        session,
        meeting,
        event_type="request.created",
        actor=current_user,
        agenda_item_id=record.agenda_item_id,
        payload={"request_id": str(record.id), "request_type": record.request_type},
    )
    await _broadcast_meeting(session, meeting.id, "meeting.request_created")
    return record


@router.patch(
    "/{meeting_id}/requests/{request_id}",
    response_model=MeetingRequestOut,
    summary="處理議員現場請求（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def update_meeting_request(
    meeting_id: uuid.UUID,
    request_id: uuid.UUID,
    payload: MeetingRequestUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> MeetingRequest:
    record = await _request_or_404(session, meeting_id, request_id)
    record = await meeting_svc.update_request_status(session, record, status=payload.status)
    meeting = await _meeting_or_404(session, meeting_id)
    await _record_event(
        session,
        meeting,
        event_type="request.updated",
        actor=current_user,
        agenda_item_id=record.agenda_item_id,
        payload={"request_id": str(record.id), "status": record.status},
    )
    await _broadcast_meeting(session, meeting_id, "meeting.request_updated")
    return record


@router.post(
    "/{meeting_id}/requests/{request_id}/enqueue",
    response_model=SpeechQueueItemOut,
    status_code=status.HTTP_201_CREATED,
    summary="將議員請求排入發言 queue（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def enqueue_request_speech(
    meeting_id: uuid.UUID,
    request_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> MeetingSpeechQueueItem:
    meeting = await _meeting_or_404(session, meeting_id)
    await _request_or_404(session, meeting_id, request_id)
    try:
        item = await meeting_svc.create_speech_queue_item(
            session, meeting, data=SpeechQueueCreate(request_id=request_id)
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await _record_event(
        session,
        meeting,
        event_type="speech.queued",
        actor=current_user,
        agenda_item_id=item.agenda_item_id,
        payload={"speech_id": str(item.id), "speaker_name": item.speaker_name},
    )
    await _broadcast_meeting(session, meeting_id, "meeting.speech_updated")
    return item


@router.post(
    "/{meeting_id}/speech-queue",
    response_model=SpeechQueueItemOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增發言 queue 項目（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def create_speech_queue_item(
    meeting_id: uuid.UUID,
    payload: SpeechQueueCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> MeetingSpeechQueueItem:
    meeting = await _meeting_or_404(session, meeting_id)
    try:
        item = await meeting_svc.create_speech_queue_item(session, meeting, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await _record_event(
        session,
        meeting,
        event_type="speech.queued",
        actor=current_user,
        agenda_item_id=item.agenda_item_id,
        payload={"speech_id": str(item.id), "speaker_name": item.speaker_name},
    )
    await _broadcast_meeting(session, meeting.id, "meeting.speech_updated")
    return item


@router.patch(
    "/{meeting_id}/speech-queue/reorder",
    response_model=list[SpeechQueueItemOut],
    summary="重排發言 queue（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def reorder_speech_queue(
    meeting_id: uuid.UUID,
    payload: SpeechQueueReorder,
    session: DbDep,
    current_user: CurrentUser,
) -> list[MeetingSpeechQueueItem]:
    meeting = await _meeting_or_404(session, meeting_id)
    try:
        items = await meeting_svc.reorder_speech_queue(
            session, meeting, ordered_ids=payload.ordered_ids
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await _record_event(
        session,
        meeting,
        event_type="speech.reordered",
        actor=current_user,
        payload={"ordered_ids": [str(item_id) for item_id in payload.ordered_ids]},
    )
    await _broadcast_meeting(session, meeting.id, "meeting.speech_updated")
    return items


@router.patch(
    "/{meeting_id}/speech-queue/{speech_id}",
    response_model=SpeechQueueItemOut,
    summary="更新發言 queue 項目（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def update_speech_queue_item(
    meeting_id: uuid.UUID,
    speech_id: uuid.UUID,
    payload: SpeechQueueUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> MeetingSpeechQueueItem:
    item = await _speech_or_404(session, meeting_id, speech_id)
    item = await meeting_svc.update_speech_queue_item(session, item, data=payload)
    meeting = await _meeting_or_404(session, meeting_id)
    await _record_event(
        session,
        meeting,
        event_type="speech.updated",
        actor=current_user,
        agenda_item_id=item.agenda_item_id,
        payload={
            "speech_id": str(item.id),
            "values": payload.model_dump(exclude_unset=True, mode="json"),
        },
    )
    await _broadcast_meeting(session, meeting_id, "meeting.speech_updated")
    return item


@router.post(
    "/{meeting_id}/speech-queue/{speech_id}/start",
    response_model=SpeechQueueItemOut,
    summary="開始發言計時（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def start_speech(
    meeting_id: uuid.UUID,
    speech_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> MeetingSpeechQueueItem:
    meeting = await _meeting_or_404(session, meeting_id)
    item = await _speech_or_404(session, meeting_id, speech_id)
    try:
        item = await meeting_svc.start_speech(session, meeting, item)
        await meeting_svc.update_screen_state(
            session,
            meeting,
            data=ScreenStateUpdate(
                agenda_item_id=item.agenda_item_id,
                reading_mode="speaker",
                title=item.speaker_name,
                body=item.speaker_role,
            ),
            updated_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await _record_event(
        session,
        meeting,
        event_type="speech.started",
        actor=current_user,
        agenda_item_id=item.agenda_item_id,
        payload={"speech_id": str(item.id), "speaker_name": item.speaker_name},
    )
    await _broadcast_meeting(session, meeting_id, "meeting.speech_started")
    return item


@router.post(
    "/{meeting_id}/speech-queue/{speech_id}/pause",
    response_model=SpeechQueueItemOut,
    summary="暫停發言計時（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def pause_speech(
    meeting_id: uuid.UUID,
    speech_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> MeetingSpeechQueueItem:
    meeting = await _meeting_or_404(session, meeting_id)
    item = await _speech_or_404(session, meeting_id, speech_id)
    try:
        item = await meeting_svc.pause_speech(session, meeting, item)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await _record_event(
        session,
        meeting,
        event_type="speech.paused",
        actor=current_user,
        agenda_item_id=item.agenda_item_id,
        payload={"speech_id": str(item.id), "remaining_seconds": item.remaining_seconds},
    )
    await _broadcast_meeting(session, meeting_id, "meeting.speech_updated")
    return item


@router.post(
    "/{meeting_id}/speech-queue/{speech_id}/resume",
    response_model=SpeechQueueItemOut,
    summary="繼續發言計時（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def resume_speech(
    meeting_id: uuid.UUID,
    speech_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> MeetingSpeechQueueItem:
    meeting = await _meeting_or_404(session, meeting_id)
    item = await _speech_or_404(session, meeting_id, speech_id)
    item = await meeting_svc.resume_speech(session, meeting, item)
    await _record_event(
        session,
        meeting,
        event_type="speech.resumed",
        actor=current_user,
        agenda_item_id=item.agenda_item_id,
        payload={"speech_id": str(item.id)},
    )
    await _broadcast_meeting(session, meeting_id, "meeting.speech_updated")
    return item


@router.post(
    "/{meeting_id}/speech-queue/{speech_id}/finish",
    response_model=SpeechQueueItemOut,
    summary="結束發言（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def finish_speech(
    meeting_id: uuid.UUID,
    speech_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> MeetingSpeechQueueItem:
    meeting = await _meeting_or_404(session, meeting_id)
    item = await _speech_or_404(session, meeting_id, speech_id)
    item = await meeting_svc.finish_speech(session, meeting, item)
    await _record_event(
        session,
        meeting,
        event_type="speech.finished",
        actor=current_user,
        agenda_item_id=item.agenda_item_id,
        payload={"speech_id": str(item.id), "remaining_seconds": item.remaining_seconds},
    )
    await _broadcast_meeting(session, meeting_id, "meeting.speech_finished")
    return item


@router.post(
    "/{meeting_id}/speech-queue/{speech_id}/skip",
    response_model=SpeechQueueItemOut,
    summary="略過發言（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def skip_speech(
    meeting_id: uuid.UUID,
    speech_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> MeetingSpeechQueueItem:
    meeting = await _meeting_or_404(session, meeting_id)
    item = await _speech_or_404(session, meeting_id, speech_id)
    item = await meeting_svc.finish_speech(session, meeting, item, status=SpeechQueueStatus.SKIPPED)
    await _record_event(
        session,
        meeting,
        event_type="speech.skipped",
        actor=current_user,
        agenda_item_id=item.agenda_item_id,
        payload={"speech_id": str(item.id)},
    )
    await _broadcast_meeting(session, meeting_id, "meeting.speech_updated")
    return item


@router.post(
    "/{meeting_id}/speech-queue/{speech_id}/extend",
    response_model=SpeechQueueItemOut,
    summary="延長發言時間（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def extend_speech(
    meeting_id: uuid.UUID,
    speech_id: uuid.UUID,
    payload: SpeechQueueExtend,
    session: DbDep,
    current_user: CurrentUser,
) -> MeetingSpeechQueueItem:
    meeting = await _meeting_or_404(session, meeting_id)
    item = await _speech_or_404(session, meeting_id, speech_id)
    item = await meeting_svc.extend_speech(session, meeting, item, seconds=payload.seconds)
    await _record_event(
        session,
        meeting,
        event_type="speech.extended",
        actor=current_user,
        agenda_item_id=item.agenda_item_id,
        payload={"speech_id": str(item.id), "seconds": payload.seconds},
    )
    await _broadcast_meeting(session, meeting_id, "meeting.speech_updated")
    return item


@router.get(
    "/{meeting_id}/screen",
    response_model=MeetingScreenOut,
    summary="取得大屏狀態（meeting:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_MANAGE))],
)
async def get_screen(meeting_id: uuid.UUID, session: DbDep, _: CurrentUser) -> dict:
    meeting = await _meeting_or_404(session, meeting_id)
    return await meeting_svc.screen_payload(session, meeting)


@router.patch(
    "/{meeting_id}/screen-state",
    response_model=ScreenStateOut,
    summary="遙控大屏顯示狀態（meeting:chair）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_CHAIR))],
)
async def update_screen_state(
    meeting_id: uuid.UUID,
    payload: ScreenStateUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> object:
    meeting = await _meeting_or_404(session, meeting_id)
    state = await meeting_svc.update_screen_state(
        session, meeting, data=payload, updated_by=current_user.id
    )
    await _record_event(
        session,
        meeting,
        event_type="screen.pushed",
        actor=current_user,
        agenda_item_id=state.agenda_item_id,
        payload=payload.model_dump(exclude_unset=True, mode="json"),
    )
    await _broadcast_meeting(session, meeting.id, "meeting.screen_state_updated")
    return state


@router.get(
    "/{meeting_id}/events",
    response_model=list[MeetingEventOut],
    summary="取得會中事件時間軸（meeting:export）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_EXPORT))],
)
async def list_meeting_events(
    meeting_id: uuid.UUID,
    session: DbDep,
    _: CurrentUser,
    limit: int = Query(200, ge=1, le=500),
) -> list:
    await _meeting_or_404(session, meeting_id)
    return await meeting_svc.list_events(session, meeting_id, limit=limit)


@router.get(
    "/{meeting_id}/minutes",
    response_model=MeetingMinutesOut,
    summary="取得會議紀錄資料（meeting:export）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_EXPORT))],
)
async def get_minutes(meeting_id: uuid.UUID, session: DbDep, _: CurrentUser) -> dict:
    meeting = await _meeting_or_404(session, meeting_id)
    return await meeting_svc.minutes_payload(session, meeting)


@router.post(
    "/{meeting_id}/minutes/document-draft",
    response_model=MeetingDocumentDraftOut,
    summary="轉成公文紀錄草稿（meeting:export）",
    dependencies=[Depends(require_permission(PermissionCode.MEETING_EXPORT))],
)
async def create_minutes_document(
    meeting_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> dict[str, object]:
    meeting = await _meeting_or_404(session, meeting_id)
    minutes = await meeting_svc.minutes_payload(session, meeting)
    recipients = [
        RecipientCreate(
            recipient_type="main", name=record.user.display_name, email=record.user.email
        )
        for record in meeting.attendance_records
        if record.user is not None
    ]
    doc = await document_svc.create_document(
        session,
        data=DocumentCreate(
            title=f"{meeting.title}會議紀錄",
            org_id=meeting.org_id,
            category=DocumentCategory.RECORD,
            subject=f"{meeting.title}會議紀錄",
            doc_description="\n".join(item.title for item in meeting.agenda_items) or "會議紀錄",
            action_required=minutes["markdown"],
            content=minutes["markdown"],
            meeting_time=meeting.starts_at,
            meeting_location=meeting.location or "未填",
            meeting_chairperson=meeting.chair_name or "未填",
            handler_name=current_user.display_name,
            handler_email=current_user.email,
            recipients=recipients[:100],
        ),
        created_by=current_user.id,
    )
    return {"document_id": doc.id, "title": doc.title, "status": DocumentStatus.DRAFT.value}


@public_router.get("/screen/{token}", response_model=MeetingScreenOut, summary="公開大屏只讀狀態")
async def public_screen(token: str, session: DbDep) -> dict:
    meeting = await meeting_svc.get_meeting_by_screen_token(session, token)
    if meeting is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此大屏")
    return await meeting_svc.screen_payload(session, meeting)


@public_router.websocket("/screen/{token}/ws")
async def public_screen_ws(websocket: WebSocket, token: str) -> None:
    from api.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        meeting = await meeting_svc.get_meeting_by_screen_token(session, token)
        if meeting is None:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="找不到此大屏")
            return
        room = f"meeting-screen:{token}"
        await manager.connect(websocket, room)
        await websocket.send_json(
            manager.build_message(
                "meeting.screen_snapshot",
                await meeting_svc.screen_payload(session, meeting),
                room=room,
            )
        )

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, room)
