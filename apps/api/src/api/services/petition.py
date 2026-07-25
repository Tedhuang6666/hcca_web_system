"""陳情系統服務層"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import case, extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import local_today, roc_year
from api.core.config import settings
from api.core.database import advisory_xact_lock
from api.models.org import Org, Position, UserPosition
from api.models.petition import (
    PetitionAttachment,
    PetitionAttachmentVisibility,
    PetitionCase,
    PetitionCaseEvent,
    PetitionEventType,
    PetitionEventVisibility,
    PetitionPublicStatus,
    PetitionStatus,
    PetitionType,
)
from api.models.user import User
from api.schemas.petition import (
    PetitionAssignUpdate,
    PetitionCreate,
    PetitionEventUpdate,
    PetitionInternalNoteCreate,
    PetitionOrgStatsItem,
    PetitionPublicRequest,
    PetitionPublicResponse,
    PetitionReplyCreate,
    PetitionStatsOut,
    PetitionStatusUpdate,
    PetitionSupplementCreate,
    PetitionTransferUpdate,
    PetitionTypeCreate,
    PetitionTypeUpdate,
)
from api.services._base import apply_updates
from api.services.permission import active_tenure_filter

STATUS_LABELS: dict[PetitionStatus, str] = {
    PetitionStatus.SUBMITTED: "已收件",
    PetitionStatus.ASSIGNED: "已分案",
    PetitionStatus.IN_PROGRESS: "承辦中",
    PetitionStatus.NEEDS_INFO: "等待補件",
    PetitionStatus.TRANSFERRED: "已轉派",
    PetitionStatus.RESOLVED: "已回覆",
    PetitionStatus.CLOSED: "已結案",
    PetitionStatus.REJECTED: "不受理",
}

STATUS_MESSAGES: dict[PetitionStatus, str] = {
    PetitionStatus.SUBMITTED: "案件已送出，等待負責機關分案處理。",
    PetitionStatus.ASSIGNED: "案件已指派承辦人，將進入實質處理。",
    PetitionStatus.IN_PROGRESS: "承辦機關正在處理您的陳情。",
    PetitionStatus.NEEDS_INFO: "承辦機關需要您補充資料後才能繼續處理。",
    PetitionStatus.TRANSFERRED: "案件已轉派至更適合的負責機關。",
    PetitionStatus.RESOLVED: "承辦機關已回覆，請查看處理結果。",
    PetitionStatus.CLOSED: "案件已完成並結案。",
    PetitionStatus.REJECTED: "案件經審查後不予受理。",
}

PUBLIC_EVENT_EDIT_WINDOW = timedelta(hours=1)

NEXT_ACTIONS: dict[PetitionStatus, str] = {
    PetitionStatus.SUBMITTED: "請等待機關分案。",
    PetitionStatus.ASSIGNED: "請等待承辦人處理。",
    PetitionStatus.IN_PROGRESS: "請等待承辦機關回覆。",
    PetitionStatus.NEEDS_INFO: "請補充資料。",
    PetitionStatus.TRANSFERRED: "請等待新負責機關處理。",
    PetitionStatus.RESOLVED: "您可查看回覆內容；機關將視情況結案。",
    PetitionStatus.CLOSED: "無需進一步操作。",
    PetitionStatus.REJECTED: "無需進一步操作。",
}


def generate_verification_code() -> str:
    return f"{secrets.randbelow(100000):05d}"


def hash_verification_code(case_number: str, code: str) -> str:
    raw = f"{case_number}:{code}".encode()
    return hmac.new(settings.SECRET_KEY.encode(), raw, hashlib.sha256).hexdigest()


def verify_code(case: PetitionCase, code: str) -> bool:
    expected = hash_verification_code(case.case_number, code)
    return hmac.compare_digest(case.verification_code_hash, expected)


def generate_share_token() -> str:
    """產生僅顯示一次的高熵 bearer token，取代可暴力猜測的五位數分享碼。"""
    return secrets.token_urlsafe(32)


def hash_share_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


_CASE_NUMBER_LOCK_KEY = 0x7065_7463  # "petc"


async def _next_case_number(session: AsyncSession) -> str:
    year = roc_year()
    prefix = f"{year:03d}"
    # 序列化並發配發，避免讀 max → +1 撞同號（unique constraint → 500）。
    await advisory_xact_lock(session, _CASE_NUMBER_LOCK_KEY)
    result = await session.execute(
        select(PetitionCase.case_number)
        .where(PetitionCase.case_number.like(f"{prefix}%"))
        .order_by(PetitionCase.case_number.desc())
        .limit(1)
    )
    latest = result.scalar_one_or_none()
    next_counter = int(latest[3:]) + 1 if latest else 1
    if next_counter > 9999:
        raise ValueError(f"案件編號流水號已滿（{year} 年已達 9999 件），請聯絡系統管理員")
    return f"{prefix}{next_counter:04d}"


async def add_event(
    session: AsyncSession,
    case_obj: PetitionCase,
    *,
    event_type: PetitionEventType,
    title: str,
    content: str | None = None,
    actor_id: uuid.UUID | None = None,
    visibility: PetitionEventVisibility = PetitionEventVisibility.PUBLIC,
    from_org_id: uuid.UUID | None = None,
    to_org_id: uuid.UUID | None = None,
    from_status: str | None = None,
    to_status: str | None = None,
) -> PetitionCaseEvent:
    event = PetitionCaseEvent(
        case_id=case_obj.id,
        event_type=event_type,
        visibility=visibility,
        actor_id=actor_id,
        from_org_id=from_org_id,
        to_org_id=to_org_id,
        from_status=from_status,
        to_status=to_status,
        title=title,
        content=content,
    )
    session.add(event)
    await session.flush()
    return event


async def edit_public_event(
    session: AsyncSession,
    case_obj: PetitionCase,
    *,
    event_id: uuid.UUID,
    data: PetitionEventUpdate,
    actor_id: uuid.UUID,
) -> PetitionCaseEvent:
    result = await session.execute(
        select(PetitionCaseEvent).where(
            PetitionCaseEvent.id == event_id,
            PetitionCaseEvent.case_id == case_obj.id,
        )
    )
    event = result.scalar_one_or_none()
    if event is None:
        raise ValueError("找不到此處理訊息")
    if event.visibility != PetitionEventVisibility.PUBLIC:
        raise ValueError("只有使用者可見的訊息可以編輯")
    if event.actor_id != actor_id:
        raise ValueError("只能編輯自己發布的訊息")
    created_at = event.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=UTC)
    if datetime.now(UTC) - created_at > PUBLIC_EVENT_EDIT_WINDOW:
        raise ValueError("訊息建立已超過 1 小時，無法再編輯")

    changes = data.model_dump(exclude_unset=True)
    if "title" in changes:
        event.title = changes["title"]
    if "content" in changes:
        event.content = changes["content"]
        if event.event_type == PetitionEventType.REPLIED:
            case_obj.public_reply = changes["content"]
        elif event.event_type == PetitionEventType.NEEDS_INFO:
            case_obj.supplement_request = changes["content"]
        elif event.event_type == PetitionEventType.REJECTED:
            case_obj.rejection_reason = changes["content"]
    await session.flush()
    await session.refresh(case_obj, attribute_names=["events"])
    return event


async def get_type(session: AsyncSession, type_id: uuid.UUID) -> PetitionType | None:
    return await session.get(PetitionType, type_id)


async def list_types(session: AsyncSession, *, active_only: bool = True) -> list[PetitionType]:
    stmt = select(PetitionType).order_by(PetitionType.sort_order, PetitionType.name)
    if active_only:
        stmt = stmt.where(PetitionType.is_active == True)  # noqa: E712
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def create_type(session: AsyncSession, data: PetitionTypeCreate) -> PetitionType:
    petition_type = PetitionType(**data.model_dump())
    session.add(petition_type)
    await session.flush()
    return petition_type


async def update_type(
    session: AsyncSession, petition_type: PetitionType, data: PetitionTypeUpdate
) -> PetitionType:
    apply_updates(petition_type, data)
    await session.flush()
    return petition_type


async def delete_type(session: AsyncSession, petition_type: PetitionType) -> None:
    await session.delete(petition_type)
    await session.flush()


async def create_case(
    session: AsyncSession,
    *,
    data: PetitionCreate,
    submitter: User | None,
) -> tuple[PetitionCase, str, str]:
    petition_type = await get_type(session, data.type_id)
    if petition_type is None or not petition_type.is_active:
        raise ValueError("陳情類型不存在或已停用")
    if submitter is None and not data.contact_email:
        raise ValueError("訪客送件需提供聯絡 email")
    contact_name = data.contact_name
    contact_email = str(data.contact_email) if data.contact_email else None
    if submitter is not None:
        contact_name = submitter.display_name
        contact_email = submitter.email

    code = generate_verification_code()
    share_token = generate_share_token()
    case_number = await _next_case_number(session)
    case_obj = PetitionCase(
        case_number=case_number,
        verification_code_hash=hash_verification_code(case_number, code),
        share_token_hash=hash_share_token(share_token),
        type_id=data.type_id,
        is_named=data.is_named,
        submitter_id=submitter.id if submitter else None,
        contact_name=contact_name,
        contact_email=contact_email,
        title=data.title,
        content=data.content,
        current_org_id=petition_type.responsible_org_id,
        submitted_at=datetime.now(UTC),
    )
    session.add(case_obj)
    await session.flush()
    await add_event(
        session,
        case_obj,
        event_type=PetitionEventType.CREATED,
        title="案件已建立",
        content=STATUS_MESSAGES[PetitionStatus.SUBMITTED],
        actor_id=submitter.id if submitter else None,
    )
    return case_obj, code, share_token


async def get_case_by_share_token(session: AsyncSession, share_token: str) -> PetitionCase | None:
    """以雜湊後的高熵 token 查詢案件，避免資料庫保存 bearer token 明文。"""
    result = await session.execute(
        select(PetitionCase)
        .where(PetitionCase.share_token_hash == hash_share_token(share_token))
        .options(
            selectinload(PetitionCase.type),
            selectinload(PetitionCase.current_org),
            selectinload(PetitionCase.submitter),
            selectinload(PetitionCase.assigned_to),
            selectinload(PetitionCase.events),
            selectinload(PetitionCase.attachments),
        )
    )
    return result.scalar_one_or_none()


async def get_case(session: AsyncSession, case_id: uuid.UUID) -> PetitionCase | None:
    result = await session.execute(
        select(PetitionCase)
        .options(
            selectinload(PetitionCase.type),
            selectinload(PetitionCase.current_org),
            selectinload(PetitionCase.submitter),
            selectinload(PetitionCase.assigned_to),
            selectinload(PetitionCase.events),
            selectinload(PetitionCase.attachments),
        )
        .where(PetitionCase.id == case_id)
    )
    return result.scalar_one_or_none()


async def get_case_by_number(session: AsyncSession, case_number: str) -> PetitionCase | None:
    result = await session.execute(
        select(PetitionCase)
        .options(
            selectinload(PetitionCase.type),
            selectinload(PetitionCase.current_org),
            selectinload(PetitionCase.submitter),
            selectinload(PetitionCase.assigned_to),
            selectinload(PetitionCase.events),
            selectinload(PetitionCase.attachments),
        )
        .where(PetitionCase.case_number == case_number)
    )
    return result.scalar_one_or_none()


async def list_cases(
    session: AsyncSession,
    *,
    submitter_id: uuid.UUID | None = None,
    org_ids: list[uuid.UUID] | None = None,
    assigned_to_id: uuid.UUID | None = None,
    status: PetitionStatus | None = None,
    keyword: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[PetitionCase]:
    stmt = (
        select(PetitionCase)
        .options(
            selectinload(PetitionCase.type),
            selectinload(PetitionCase.current_org),
            selectinload(PetitionCase.assigned_to),
        )
        .order_by(PetitionCase.updated_at.desc(), PetitionCase.submitted_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if submitter_id:
        stmt = stmt.where(PetitionCase.submitter_id == submitter_id)
    if org_ids is not None:
        if not org_ids:
            return []
        stmt = stmt.where(PetitionCase.current_org_id.in_(org_ids))
    if assigned_to_id:
        stmt = stmt.where(PetitionCase.assigned_to_id == assigned_to_id)
    if status:
        stmt = stmt.where(PetitionCase.status == status)
    if keyword:
        pattern = f"%{keyword.strip()}%"
        stmt = stmt.where(
            PetitionCase.title.ilike(pattern) | PetitionCase.case_number.ilike(pattern)
        )
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def list_public_cases(
    session: AsyncSession, *, limit: int = 50, offset: int = 0
) -> list[PetitionCase]:
    result = await session.execute(
        select(PetitionCase)
        .where(
            PetitionCase.status == PetitionStatus.CLOSED,
            PetitionCase.public_status == PetitionPublicStatus.PUBLISHED,
        )
        .options(selectinload(PetitionCase.type), selectinload(PetitionCase.current_org))
        .order_by(PetitionCase.public_published_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all())


async def get_public_case(session: AsyncSession, case_id: uuid.UUID) -> PetitionCase | None:
    result = await session.execute(
        select(PetitionCase)
        .where(
            PetitionCase.id == case_id,
            PetitionCase.status == PetitionStatus.CLOSED,
            PetitionCase.public_status == PetitionPublicStatus.PUBLISHED,
        )
        .options(selectinload(PetitionCase.type), selectinload(PetitionCase.current_org))
    )
    return result.scalar_one_or_none()


async def assign_case(
    session: AsyncSession,
    case_obj: PetitionCase,
    *,
    data: PetitionAssignUpdate,
    actor_id: uuid.UUID,
) -> PetitionCase:
    user_in_org = await _user_in_org(session, data.assigned_to_id, case_obj.current_org_id)
    if not user_in_org:
        raise ValueError("只能指派給目前負責機關內的有效任期成員")
    previous = case_obj.status
    case_obj.assigned_to_id = data.assigned_to_id
    case_obj.assigned_at = datetime.now(UTC)
    case_obj.status = PetitionStatus.ASSIGNED
    if data.internal_note:
        case_obj.latest_internal_note = data.internal_note
    await session.flush()
    await add_event(
        session,
        case_obj,
        event_type=PetitionEventType.ASSIGNED,
        title="已指派承辦人",
        content=data.internal_note,
        actor_id=actor_id,
        visibility=PetitionEventVisibility.INTERNAL
        if data.internal_note
        else PetitionEventVisibility.PUBLIC,
        from_status=previous.value,
        to_status=case_obj.status.value,
    )
    # 通知承辦人
    try:
        from api.routers.notifications import create_notification

        await create_notification(
            session,
            user_id=data.assigned_to_id,
            type="petition_assigned",
            title=f"陳情指派：{case_obj.title}",
            body=f"案號 {case_obj.case_number}，請於系統內回覆",
            link=f"/petitions/{case_obj.case_number}",
            related_id=case_obj.id,
        )
    except Exception:
        import logging

        logging.getLogger(__name__).warning(
            "send petition_assigned notification failed", exc_info=True
        )
    return case_obj


async def transfer_case(
    session: AsyncSession,
    case_obj: PetitionCase,
    *,
    data: PetitionTransferUpdate,
    actor_id: uuid.UUID,
) -> PetitionCase:
    if await session.get(Org, data.to_org_id) is None:
        raise ValueError("目標機關不存在")
    previous_org = case_obj.current_org_id
    previous_status = case_obj.status
    case_obj.current_org_id = data.to_org_id
    case_obj.assigned_to_id = None
    case_obj.status = PetitionStatus.TRANSFERRED
    await session.flush()
    await add_event(
        session,
        case_obj,
        event_type=PetitionEventType.TRANSFERRED,
        title="案件已轉派",
        content=data.reason,
        actor_id=actor_id,
        from_org_id=previous_org,
        to_org_id=data.to_org_id,
        from_status=previous_status.value,
        to_status=case_obj.status.value,
    )
    return case_obj


async def reply_case(
    session: AsyncSession,
    case_obj: PetitionCase,
    *,
    data: PetitionReplyCreate,
    actor_id: uuid.UUID,
) -> PetitionCase:
    now = datetime.now(UTC)
    if case_obj.assigned_to_id is None:
        case_obj.assigned_to_id = actor_id
        case_obj.assigned_at = now
        previous_assignment_status = case_obj.status
        case_obj.status = PetitionStatus.ASSIGNED
        await session.flush()
        await add_event(
            session,
            case_obj,
            event_type=PetitionEventType.ASSIGNED,
            title="回覆前自動分派承辦人",
            content="案件未分派承辦人，已自動分派給回覆人員。",
            actor_id=actor_id,
            from_status=previous_assignment_status.value,
            to_status=case_obj.status.value,
        )
    previous = case_obj.status
    case_obj.public_reply = data.public_content
    if case_obj.first_response_at is None:
        case_obj.first_response_at = now
    if data.internal_note:
        case_obj.latest_internal_note = data.internal_note
    if data.close:
        case_obj.status = PetitionStatus.CLOSED
        case_obj.resolved_at = now
        case_obj.closed_at = now
    elif data.resolve:
        case_obj.status = PetitionStatus.RESOLVED
        case_obj.resolved_at = now
    else:
        case_obj.status = PetitionStatus.IN_PROGRESS
    await session.flush()
    await add_event(
        session,
        case_obj,
        event_type=PetitionEventType.REPLIED,
        title="承辦機關已回覆",
        content=data.public_content,
        actor_id=actor_id,
        from_status=previous.value,
        to_status=case_obj.status.value,
    )
    if data.internal_note:
        await add_event(
            session,
            case_obj,
            event_type=PetitionEventType.NOTE,
            title="內部備註",
            content=data.internal_note,
            actor_id=actor_id,
            visibility=PetitionEventVisibility.INTERNAL,
        )
    return case_obj


async def request_public(
    session: AsyncSession,
    case_obj: PetitionCase,
    *,
    data: PetitionPublicRequest,
    actor_id: uuid.UUID,
) -> PetitionCase:
    if case_obj.status != PetitionStatus.CLOSED:
        raise ValueError("案件結案後才能提出公開申請")
    if case_obj.public_status in {
        PetitionPublicStatus.PENDING_USER,
        PetitionPublicStatus.PENDING_HANDLER,
        PetitionPublicStatus.PUBLISHED,
    }:
        raise ValueError("此案件已有進行中的公開流程")
    case_obj.public_title = data.title or case_obj.title
    case_obj.public_content = data.content or case_obj.content
    case_obj.public_status = PetitionPublicStatus.PENDING_USER
    case_obj.public_requested_at = datetime.now(UTC)
    case_obj.public_user_responded_at = None
    case_obj.public_published_at = None
    await session.flush()
    await add_event(
        session,
        case_obj,
        event_type=PetitionEventType.PUBLIC_REQUESTED,
        title="已提出公開陳情申請",
        content="請陳情人確認公開標題與內容。",
        actor_id=actor_id,
        visibility=PetitionEventVisibility.PUBLIC,
    )
    return case_obj


async def respond_public(
    session: AsyncSession,
    case_obj: PetitionCase,
    *,
    data: PetitionPublicResponse,
    actor_id: uuid.UUID | None,
) -> PetitionCase:
    if case_obj.public_status != PetitionPublicStatus.PENDING_USER:
        raise ValueError("此案件目前沒有待確認的公開申請")
    now = datetime.now(UTC)
    case_obj.public_user_responded_at = now
    if data.decision == "reject":
        case_obj.public_status = PetitionPublicStatus.DECLINED
        event_type = PetitionEventType.PUBLIC_DECLINED
        title = "陳情人拒絕公開"
        content = "陳情人拒絕公開此案件。"
    elif data.decision == "approve_with_changes":
        case_obj.public_title = data.title
        case_obj.public_content = data.content
        case_obj.public_status = PetitionPublicStatus.PENDING_HANDLER
        event_type = PetitionEventType.PUBLIC_RESPONDED
        title = "陳情人修改公開內容，待承辦確認"
        content = "陳情人已修改公開標題或內容，請承辦確認差異後發布。"
    else:
        case_obj.public_status = PetitionPublicStatus.PUBLISHED
        case_obj.public_published_at = now
        event_type = PetitionEventType.PUBLIC_CONFIRMED
        title = "陳情人同意公開"
        content = "陳情人同意以目前草案公開此案件。"
    await session.flush()
    await add_event(
        session,
        case_obj,
        event_type=event_type,
        title=title,
        content=content,
        actor_id=actor_id,
        visibility=PetitionEventVisibility.PUBLIC,
    )
    return case_obj


async def confirm_public(
    session: AsyncSession,
    case_obj: PetitionCase,
    *,
    actor_id: uuid.UUID,
) -> PetitionCase:
    if case_obj.public_status != PetitionPublicStatus.PENDING_HANDLER:
        raise ValueError("此案件目前沒有待承辦確認的公開修改")
    case_obj.public_status = PetitionPublicStatus.PUBLISHED
    case_obj.public_published_at = datetime.now(UTC)
    await session.flush()
    await add_event(
        session,
        case_obj,
        event_type=PetitionEventType.PUBLIC_CONFIRMED,
        title="承辦確認公開內容並發布",
        content="已確認陳情人修改後的公開標題與內容。",
        actor_id=actor_id,
        visibility=PetitionEventVisibility.PUBLIC,
    )
    return case_obj


async def update_status(
    session: AsyncSession,
    case_obj: PetitionCase,
    *,
    data: PetitionStatusUpdate,
    actor_id: uuid.UUID,
) -> PetitionCase:
    previous = case_obj.status
    if data.status == PetitionStatus.NEEDS_INFO and not data.public_message:
        raise ValueError("退回補件需填寫補件原因")
    if data.status == PetitionStatus.REJECTED and not data.public_message:
        raise ValueError("不受理需填寫原因")

    now = datetime.now(UTC)
    case_obj.status = data.status
    if data.status == PetitionStatus.IN_PROGRESS and case_obj.first_response_at is None:
        pass
    if data.status == PetitionStatus.NEEDS_INFO:
        case_obj.supplement_request = data.public_message
    if data.status == PetitionStatus.REJECTED:
        case_obj.rejection_reason = data.public_message
    if data.status == PetitionStatus.RESOLVED:
        case_obj.resolved_at = case_obj.resolved_at or now
    if data.status == PetitionStatus.CLOSED:
        case_obj.closed_at = now
    if data.internal_note:
        case_obj.latest_internal_note = data.internal_note
    await session.flush()

    event_type = PetitionEventType.STATUS_CHANGED
    if data.status == PetitionStatus.NEEDS_INFO:
        event_type = PetitionEventType.NEEDS_INFO
    elif data.status == PetitionStatus.CLOSED:
        event_type = PetitionEventType.CLOSED
    elif data.status == PetitionStatus.REJECTED:
        event_type = PetitionEventType.REJECTED

    await add_event(
        session,
        case_obj,
        event_type=event_type,
        title=f"狀態更新為{STATUS_LABELS[data.status]}",
        content=data.public_message or STATUS_MESSAGES[data.status],
        actor_id=actor_id,
        from_status=previous.value,
        to_status=data.status.value,
    )
    if data.internal_note:
        await add_event(
            session,
            case_obj,
            event_type=PetitionEventType.NOTE,
            title="內部備註",
            content=data.internal_note,
            actor_id=actor_id,
            visibility=PetitionEventVisibility.INTERNAL,
        )
    return case_obj


async def supplement_case(
    session: AsyncSession,
    case_obj: PetitionCase,
    *,
    data: PetitionSupplementCreate,
    actor_id: uuid.UUID | None,
) -> PetitionCase:
    previous = case_obj.status
    case_obj.status = PetitionStatus.IN_PROGRESS
    case_obj.supplement_request = None
    await session.flush()
    await add_event(
        session,
        case_obj,
        event_type=PetitionEventType.SUPPLEMENTED,
        title="已補充資料",
        content=data.content,
        actor_id=actor_id,
        from_status=previous.value,
        to_status=case_obj.status.value,
    )
    return case_obj


async def add_internal_note(
    session: AsyncSession,
    case_obj: PetitionCase,
    *,
    data: PetitionInternalNoteCreate,
    actor_id: uuid.UUID,
) -> PetitionCase:
    case_obj.latest_internal_note = data.content
    await session.flush()
    await add_event(
        session,
        case_obj,
        event_type=PetitionEventType.NOTE,
        title="內部備註",
        content=data.content,
        actor_id=actor_id,
        visibility=PetitionEventVisibility.INTERNAL,
    )
    return case_obj


async def add_attachment(
    session: AsyncSession,
    case_obj: PetitionCase,
    *,
    filename: str,
    storage_key: str,
    content_type: str | None,
    file_size: int | None,
    visibility: PetitionAttachmentVisibility,
    uploaded_by: uuid.UUID | None,
) -> PetitionAttachment:
    attachment = PetitionAttachment(
        case_id=case_obj.id,
        filename=filename,
        storage_key=storage_key,
        content_type=content_type,
        file_size=file_size,
        visibility=visibility,
        uploaded_by=uploaded_by,
    )
    session.add(attachment)
    await session.flush()
    await add_event(
        session,
        case_obj,
        event_type=PetitionEventType.ATTACHMENT_ADDED,
        title="新增附件",
        content=filename,
        actor_id=uploaded_by,
        visibility=(
            PetitionEventVisibility.INTERNAL
            if visibility == PetitionAttachmentVisibility.INTERNAL
            else PetitionEventVisibility.PUBLIC
        ),
    )
    return attachment


async def _user_in_org(session: AsyncSession, user_id: uuid.UUID, org_id: uuid.UUID) -> bool:
    today = local_today()
    result = await session.execute(
        select(UserPosition.id)
        .join(Position, UserPosition.position_id == Position.id)
        .where(
            UserPosition.user_id == user_id,
            Position.org_id == org_id,
            *active_tenure_filter(today),
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


async def stats(
    session: AsyncSession,
    *,
    org_ids: list[uuid.UUID] | None,
    user_id: uuid.UUID,
    include_by_org: bool,
) -> PetitionStatsOut:
    if org_ids is not None and not org_ids:
        return PetitionStatsOut(
            total=0,
            pending_assignment=0,
            my_assigned=0,
            needs_info=0,
            in_progress=0,
            resolved=0,
            closed_this_month=0,
        )

    now = datetime.now(UTC)
    base_filter = []
    if org_ids is not None:
        base_filter.append(PetitionCase.current_org_id.in_(org_ids))

    stmt = select(
        func.count().label("total"),
        func.sum(
            case(
                (
                    (PetitionCase.assigned_to_id.is_(None))
                    & (PetitionCase.status == PetitionStatus.SUBMITTED),
                    1,
                ),
                else_=0,
            )
        ).label("pending_assignment"),
        func.sum(case((PetitionCase.assigned_to_id == user_id, 1), else_=0)).label("my_assigned"),
        func.sum(case((PetitionCase.status == PetitionStatus.NEEDS_INFO, 1), else_=0)).label(
            "needs_info"
        ),
        func.sum(case((PetitionCase.status == PetitionStatus.IN_PROGRESS, 1), else_=0)).label(
            "in_progress"
        ),
        func.sum(case((PetitionCase.status == PetitionStatus.RESOLVED, 1), else_=0)).label(
            "resolved"
        ),
        func.sum(
            case(
                (
                    (PetitionCase.closed_at.isnot(None))
                    & (extract("year", PetitionCase.closed_at) == now.year)
                    & (extract("month", PetitionCase.closed_at) == now.month),
                    1,
                ),
                else_=0,
            )
        ).label("closed_this_month"),
    ).where(*base_filter)

    row = (await session.execute(stmt)).one()
    out = PetitionStatsOut(
        total=int(row.total or 0),
        pending_assignment=int(row.pending_assignment or 0),
        my_assigned=int(row.my_assigned or 0),
        needs_info=int(row.needs_info or 0),
        in_progress=int(row.in_progress or 0),
        resolved=int(row.resolved or 0),
        closed_this_month=int(row.closed_this_month or 0),
    )
    if include_by_org:
        out.by_org = await org_stats(session, org_ids=org_ids)
    return out


async def org_stats(
    session: AsyncSession, *, org_ids: list[uuid.UUID] | None
) -> list[PetitionOrgStatsItem]:
    stmt = (
        select(
            Org.id,
            Org.name,
            func.count(PetitionCase.id),
            func.sum(case((PetitionCase.status == PetitionStatus.SUBMITTED, 1), else_=0)),
            func.sum(case((PetitionCase.status == PetitionStatus.ASSIGNED, 1), else_=0)),
            func.sum(case((PetitionCase.status == PetitionStatus.IN_PROGRESS, 1), else_=0)),
            func.sum(case((PetitionCase.status == PetitionStatus.NEEDS_INFO, 1), else_=0)),
            func.sum(case((PetitionCase.status == PetitionStatus.TRANSFERRED, 1), else_=0)),
            func.sum(case((PetitionCase.status == PetitionStatus.RESOLVED, 1), else_=0)),
            func.sum(case((PetitionCase.status == PetitionStatus.CLOSED, 1), else_=0)),
            func.sum(case((PetitionCase.status == PetitionStatus.REJECTED, 1), else_=0)),
            func.avg(
                extract("epoch", PetitionCase.first_response_at - PetitionCase.submitted_at) / 3600
            ),
            func.avg(extract("epoch", PetitionCase.closed_at - PetitionCase.submitted_at) / 3600),
        )
        .join(PetitionCase, PetitionCase.current_org_id == Org.id)
        .group_by(Org.id, Org.name)
        .order_by(Org.name)
    )
    if org_ids is not None:
        if not org_ids:
            return []
        stmt = stmt.where(PetitionCase.current_org_id.in_(org_ids))
    result = await session.execute(stmt)
    rows = result.all()
    return [
        PetitionOrgStatsItem(
            org_id=row[0],
            org_name=row[1],
            total=int(row[2] or 0),
            submitted=int(row[3] or 0),
            assigned=int(row[4] or 0),
            in_progress=int(row[5] or 0),
            needs_info=int(row[6] or 0),
            transferred=int(row[7] or 0),
            resolved=int(row[8] or 0),
            closed=int(row[9] or 0),
            rejected=int(row[10] or 0),
            completed=int(row[8] or 0) + int(row[9] or 0),
            average_first_response_hours=float(row[11]) if row[11] is not None else None,
            average_completion_hours=float(row[12]) if row[12] is not None else None,
        )
        for row in rows
    ]
