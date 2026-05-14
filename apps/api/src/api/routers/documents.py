"""
公文系統 Router
=============
RBAC 權限說明：
  - document:create  → 建立公文
  - document:approve → 審核（核准/退件）
  - document:admin   → 管理員操作（封存、不受組織限制的列表查詢）
所有讀取端點依「組織可見性」過濾（同組成員、建立者、審核人）。
BackgroundTasks 在狀態變更時非同步推送 Email 與 WebSocket 通知。
"""

from __future__ import annotations

import uuid
from contextlib import suppress
from datetime import date
from typing import Annotated
from urllib.parse import quote

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy import and_, extract, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.core.ws_manager import manager as ws_manager
from api.dependencies.auth import get_current_active_user, get_optional_user
from api.dependencies.permissions import require_permission
from api.models.document import (
    ApprovalStepStatus,
    DelegateSource,
    Document,
    DocumentApproval,
    DocumentApprovalDelegation,
    DocumentAttachment,
    DocumentCategory,
    DocumentClassification,
    DocumentStatus,
    DocumentVisibility,
)
from api.models.org import Position, UserPosition
from api.models.user import User
from api.routers.notifications import create_notification
from api.schemas.document import (
    ApproveRequest,
    AttachmentLinkCreate,
    AttachmentOut,
    BatchApproveRequest,
    BatchArchiveRequest,
    BatchDelegateRequest,
    BatchDocumentOperationOut,
    BatchDocumentResult,
    BatchRejectRequest,
    DocumentApprovalDelegationCreate,
    DocumentApprovalDelegationOut,
    DocumentApprovalDelegationUpdate,
    DocumentCreate,
    DocumentListItem,
    DocumentOut,
    DocumentTemplateCreate,
    DocumentTemplateDraftCreate,
    DocumentTemplateOut,
    DocumentTemplateUpdate,
    DocumentUpdate,
    RecallRequest,
    RecipientCreate,
    RejectMode,
    RejectRequest,
    SerialTemplateCreate,
    SerialTemplateOut,
    SerialTemplateUpdate,
    SubmitRequest,
)
from api.services import audit as audit_svc
from api.services import document as doc_svc
from api.services.mail import enqueue_email
from api.services.permission import get_user_permission_codes_for_org
from api.services.storage import get_storage

router = APIRouter(prefix="/documents", tags=["公文系統"])
serial_router = APIRouter(prefix="/document-serial-templates", tags=["字號模板（doc.issue）"])
template_router = APIRouter(prefix="/document-templates", tags=["公文範本庫"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]


# ── 輔助：取得公文或 404 ──────────────────────────────────────────────────────


async def _get_doc_or_404(doc_id: str, session: DbDep) -> Document:
    """接受 UUID 字串或字號（如 嶺代生字第1150000001號），查不到則 404。"""
    doc: Document | None = None
    with suppress(ValueError, AttributeError):
        doc = await doc_svc.get_document(session, uuid.UUID(doc_id))
    if doc is None:
        doc = await doc_svc.get_document_by_serial(session, doc_id)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此公文")
    return doc


async def _assert_access(session: AsyncSession, doc: Document, user: User) -> None:
    """組織可見性守衛：無訪問權限時拋出 403"""
    ok = await doc_svc.check_document_access(session, doc, user.id)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="您無權查看此公文（非建立者、審核人或同組織成員）",
        )


async def _get_user_positions_batch(
    session: AsyncSession,
    user_ids: list[uuid.UUID],
    org_id: uuid.UUID,
) -> dict[uuid.UUID, str]:
    """批量查詢多個用戶在組織中的最高職位（避免 N+1 查詢）"""
    if not user_ids:
        return {}

    today = date.today()
    result = await session.execute(
        select(UserPosition.user_id, Position.name)
        .join(Position, UserPosition.position_id == Position.id)
        .where(
            UserPosition.user_id.in_(user_ids),
            UserPosition.start_date <= today,
            or_(UserPosition.end_date.is_(None), UserPosition.end_date >= today),
            Position.org_id == org_id,
        )
        .order_by(UserPosition.user_id, Position.weight.desc())
    )

    # 去重：每個用戶只取第一條（weight 最高）
    user_titles = {}
    for user_id, title in result.all():
        if user_id not in user_titles:
            user_titles[user_id] = title

    return user_titles


async def _attach_approval_titles(session: AsyncSession, doc: Document) -> None:
    """為公文的審核步驟附加職位標題（批量查詢，避免 N+1）"""
    if not doc.approvals:
        return

    # 收集所有需要查詢的用戶 ID
    user_ids = set()
    for approval in doc.approvals:
        user_ids.add(approval.approver_id)
        if approval.delegate_id:
            user_ids.add(approval.delegate_id)

    # 批量查詢
    user_titles = await _get_user_positions_batch(session, list(user_ids), doc.org_id)

    # 附加到 approval 物件
    for approval in doc.approvals:
        approval.__dict__["approver_title"] = user_titles.get(approval.approver_id)
        if approval.delegate_id:
            approval.__dict__["delegate_title"] = user_titles.get(approval.delegate_id)


async def _assert_can_edit(session: AsyncSession, doc: Document, user: User) -> None:
    if user.is_superuser or doc.created_by == user.id:
        return
    codes = await get_user_permission_codes_for_org(session, user.id, doc.org_id)
    if "document:admin" in codes:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="您無權編輯此公文")


async def _can_manage_delegation_for_org(
    session: AsyncSession, user: User, org_id: uuid.UUID
) -> bool:
    if user.is_superuser:
        return True
    codes = await get_user_permission_codes_for_org(session, user.id, org_id)
    return "document:admin" in codes or "admin:all" in codes


async def _org_ids_with_document_permissions(session: AsyncSession, user: User) -> list[uuid.UUID]:
    if user.is_superuser:
        return []
    today = date.today()
    result = await session.execute(
        select(Position.org_id)
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(
            UserPosition.user_id == user.id,
            UserPosition.start_date <= today,
            or_(UserPosition.end_date.is_(None), UserPosition.end_date >= today),
        )
        .distinct()
    )
    org_ids: list[uuid.UUID] = []
    for org_id in result.scalars().all():
        codes = await get_user_permission_codes_for_org(session, user.id, org_id)
        if {"document:create", "document:admin", "admin:all"} & set(codes):
            org_ids.append(org_id)
    return org_ids


async def _require_document_template_manage(
    session: AsyncSession,
    user: User,
    org_id: uuid.UUID,
) -> None:
    if user.is_superuser:
        return
    codes = await get_user_permission_codes_for_org(session, user.id, org_id)
    if not ({"document:admin", "admin:all"} & set(codes)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="您在此組織下無管理公文範本的權限（需 document:admin）",
        )


async def _require_document_template_use(
    session: AsyncSession,
    user: User,
    org_id: uuid.UUID,
) -> None:
    if user.is_superuser:
        return
    codes = await get_user_permission_codes_for_org(session, user.id, org_id)
    if not ({"document:create", "document:admin", "admin:all"} & set(codes)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="您在此組織下無使用公文範本起稿的權限（需 document:create）",
        )


# ── 背景通知輔助 ──────────────────────────────────────────────────────────────


def _notify_approver_bg(approver_email: str, approver_name: str, doc: Document) -> None:
    """通知下一位審核人（由 BackgroundTasks 在回應後執行）"""
    subject = f"【待審核】{doc.serial_number} {doc.title}"
    body = (
        f"<p>您好 {approver_name}，</p>"
        f"<p>公文 <strong>{doc.serial_number}</strong>「{doc.title}」已送達，請至系統審核。</p>"
        f"<p>主旨：{doc.subject or '（未填）'}</p>"
    )
    try:
        enqueue_email(approver_email, subject, body)
    except Exception as exc:
        import logging

        logging.getLogger(__name__).warning("無法發送審核通知信: %s", exc)


def _notify_creator_bg(creator_email: str, creator_name: str, doc: Document, result: str) -> None:
    """通知建立者公文狀態變更（核准/退件）"""
    subject = f"【{result}】{doc.serial_number} {doc.title}"
    body = (
        f"<p>您好 {creator_name}，</p>"
        f"<p>您的公文 <strong>{doc.serial_number}</strong>「{doc.title}」已{result}。</p>"
    )
    try:
        enqueue_email(creator_email, subject, body)
    except Exception as exc:
        import logging

        logging.getLogger(__name__).warning("無法發送狀態通知信: %s", exc)


def _ws_broadcast_bg(doc: Document) -> None:
    """向公文所屬房間廣播狀態更新（非同步 via asyncio.run_coroutine_threadsafe 替代方案）"""
    import asyncio

    msg = ws_manager.build_message(
        "document_status_changed",
        {"doc_id": str(doc.id), "serial": doc.serial_number, "status": doc.status.value},
        room=f"org:{doc.org_id}",
    )
    # BackgroundTasks 在同一事件迴圈內可直接 await；但若由 Celery 呼叫則需 asyncio.run
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(ws_manager.broadcast_to_room(f"org:{doc.org_id}", msg))
    except RuntimeError:
        pass  # 無事件迴圈時靜默略過（背景執行緒環境）


def _unique_doc_ids(document_ids: list[uuid.UUID]) -> list[uuid.UUID]:
    seen: set[uuid.UUID] = set()
    unique: list[uuid.UUID] = []
    for doc_id in document_ids:
        if doc_id in seen:
            continue
        seen.add(doc_id)
        unique.append(doc_id)
    return unique


def _batch_result(
    doc_id: uuid.UUID,
    *,
    ok: bool,
    doc: Document | None = None,
    detail: str | None = None,
) -> BatchDocumentResult:
    return BatchDocumentResult(
        document_id=doc_id,
        serial_number=doc.serial_number if doc else None,
        title=doc.title if doc else None,
        ok=ok,
        status=doc.status if doc else None,
        detail=detail,
    )


def _batch_out(results: list[BatchDocumentResult]) -> BatchDocumentOperationOut:
    succeeded = sum(1 for item in results if item.ok)
    return BatchDocumentOperationOut(
        total=len(results),
        succeeded=succeeded,
        failed=len(results) - succeeded,
        results=results,
    )


# ── 統計 ──────────────────────────────────────────────────────────────────────


@router.get(
    "/stats",
    summary="取得公文統計數據（草稿 / 待審 / 本月核准 / 退件 / 待我審核）",
)
async def get_document_stats(session: DbDep, current_user: CurrentUser) -> dict:
    """回傳當前使用者相關的公文計數，供儀表板顯示（計數限制以避免 full table scan）。"""
    from datetime import UTC, datetime

    now = datetime.now(UTC)
    base = select(Document.id).where(Document.created_by == current_user.id)
    COUNT_THRESHOLD = 100  # 限制計數至 100；超過則返回 "99+"

    async def safe_count(q) -> int | str:
        """計數至閾值；若超過，返回 "99+"""
        result = await session.execute(q.limit(COUNT_THRESHOLD + 1))
        rows = list(result.scalars().all())
        return "99+" if len(rows) > COUNT_THRESHOLD else len(rows)

    draft_count = await safe_count(base.where(Document.status == DocumentStatus.DRAFT))
    pending_count = await safe_count(base.where(Document.status == DocumentStatus.PENDING))
    rejected_count = await safe_count(base.where(Document.status == DocumentStatus.REJECTED))
    approved_month = await safe_count(
        base.where(Document.status == DocumentStatus.APPROVED)
        .where(extract("year", Document.updated_at) == now.year)
        .where(extract("month", Document.updated_at) == now.month)
    )

    # 待我審核（分配給我且尚未決定的 approval step）
    active_assignment = select(DocumentApprovalDelegation.id).where(
        DocumentApprovalDelegation.principal_user_id == DocumentApproval.approver_id,
        DocumentApprovalDelegation.delegate_user_id == current_user.id,
        DocumentApprovalDelegation.org_id == Document.org_id,
        DocumentApprovalDelegation.is_active.is_(True),
        DocumentApprovalDelegation.start_at <= now,
        or_(
            DocumentApprovalDelegation.end_at.is_(None),
            DocumentApprovalDelegation.end_at >= now,
        ),
    )
    my_pending = await safe_count(
        select(DocumentApproval.id)
        .join(Document, DocumentApproval.document_id == Document.id)
        .where(DocumentApproval.status == ApprovalStepStatus.PENDING)
        .where(
            or_(
                DocumentApproval.approver_id == current_user.id,
                and_(
                    DocumentApproval.delegate_source == DelegateSource.MANUAL,
                    DocumentApproval.delegate_id == current_user.id,
                ),
                and_(
                    DocumentApproval.delegate_source == DelegateSource.ASSIGNMENT,
                    active_assignment.exists(),
                ),
            )
        )
    )

    return {
        "draft": draft_count,
        "pending_submitted": pending_count,
        "pending_my_approval": my_pending,
        "approved_this_month": approved_month,
        "rejected": rejected_count,
    }


# ── CRUD ──────────────────────────────────────────────────────────────────────


@router.post(
    "",
    response_model=DocumentOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立草稿公文",
    responses={
        201: {"description": "公文建立成功"},
        403: {"description": "無建立權限"},
    },
)
async def create_document(
    payload: DocumentCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> Document:
    """
    建立草稿公文並生成字號。需在目標組織下擁有 document:create 權限（org-scoped）。
    """
    if not current_user.is_superuser:
        codes = await get_user_permission_codes_for_org(session, current_user.id, payload.org_id)
        if "document:create" not in codes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="您在此組織下無起草公文的權限（需 document:create）",
            )
    doc = await doc_svc.create_document(session, data=payload, created_by=current_user.id)
    await audit_svc.record(
        session,
        entity_type="document",
        entity_id=str(doc.id),
        action="create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        summary=f"建立公文「{doc.title}」字號 {doc.serial_number}",
    )
    return doc


@router.get(
    "",
    response_model=list[DocumentListItem],
    summary="列出公文（未登入僅顯示 is_public=True 的公文）",
)
async def list_documents(
    session: DbDep,
    current_user: OptionalUser,
    org_id: uuid.UUID | None = Query(None, description="過濾組織（不填則依使用者所在組織）"),
    status_filter: DocumentStatus | None = Query(None, alias="status", description="過濾狀態"),
    category: DocumentCategory | None = Query(None, description="過濾公文類別"),
    classification: DocumentClassification | None = Query(None, description="過濾密等"),
    visibility: DocumentVisibility | None = Query(None, description="過濾可見度"),
    date_from: date | None = Query(None, description="建立日期起（YYYY-MM-DD）"),
    date_to: date | None = Query(None, description="建立日期迄（YYYY-MM-DD）"),
    issued_from: date | None = Query(None, description="發文日期起（YYYY-MM-DD）"),
    issued_to: date | None = Query(None, description="發文日期迄（YYYY-MM-DD）"),
    roc_year: int | None = Query(
        None, ge=1, le=999, description="民國年（以發文日期為準，如 115）"
    ),
    serial_prefix: str | None = Query(None, max_length=30, description="字號前綴（prefix match）"),
    handler_keyword: str | None = Query(
        None, max_length=100, description="承辦人/單位/聯絡資訊關鍵字"
    ),
    recipient_keyword: str | None = Query(None, max_length=100, description="受文者關鍵字"),
    keyword: str | None = Query(
        None, max_length=100, description="關鍵字（搜尋字號、標題、主旨、說明）"
    ),
    my_only: bool = Query(False, description="僅顯示我建立的公文"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> list[Document]:
    return await doc_svc.list_documents(
        session,
        org_id=org_id,
        status=status_filter,
        category=category,
        classification=classification,
        visibility=visibility,
        date_from=date_from,
        date_to=date_to,
        issued_from=issued_from,
        issued_to=issued_to,
        roc_year=roc_year,
        serial_prefix=serial_prefix,
        handler_keyword=handler_keyword,
        recipient_keyword=recipient_keyword,
        keyword=keyword,
        created_by=current_user.id if (my_only and current_user) else None,
        limit=limit,
        offset=offset,
        public_only=(current_user is None),  # 未登入僅顯示公開公文
        viewer_id=(current_user.id if current_user else None),
    )


@router.get(
    "/{doc_id}",
    response_model=DocumentOut,
    summary="取得公文詳細（未登入僅可查看 is_public=True 的公文）",
    responses={
        200: {"description": "公文詳細資料"},
        403: {"description": "無查看權限"},
        404: {"description": "公文不存在"},
    },
)
async def get_document(doc_id: str, session: DbDep, current_user: OptionalUser) -> Document:
    doc = await _get_doc_or_404(doc_id, session)
    if current_user is None:
        if not doc.is_public:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此公文")
        await _attach_approval_titles(session, doc)
        return doc
    await _assert_access(session, doc, current_user)
    await _attach_approval_titles(session, doc)
    return doc


@router.patch(
    "/{doc_id}",
    response_model=DocumentOut,
    summary="更新草稿公文（自動建立版本快照）",
    responses={
        200: {"description": "更新成功，版本號遞增"},
        403: {"description": "非建立者"},
        409: {"description": "非草稿狀態"},
    },
)
async def update_document(
    doc_id: str,
    payload: DocumentUpdate,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission(PermissionCode.DOCUMENT_EDIT))],
) -> Document:
    doc = await _get_doc_or_404(doc_id, session)
    if doc.created_by != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有建立者可以編輯")
    try:
        return await doc_svc.update_document(session, doc, data=payload, changed_by=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.delete(
    "/{doc_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除草稿公文",
    responses={
        204: {"description": "刪除成功"},
        403: {"description": "僅建立者或有 document:delete 權限者可刪除"},
        409: {"description": "非草稿狀態不可刪除"},
    },
)
async def delete_document(
    doc_id: str,
    session: DbDep,
    current_user: CurrentUser,
) -> None:
    doc = await _get_doc_or_404(doc_id, session)
    if not current_user.is_superuser and doc.created_by != current_user.id:
        codes = await get_user_permission_codes_for_org(session, current_user.id, doc.org_id)
        if "document:delete" not in codes and "document:admin" not in codes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="您無刪除此公文的權限（需建立者或 document:delete/document:admin）",
            )
    try:
        await doc_svc.delete_document(session, doc)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


# ── 批量操作端點 ──────────────────────────────────────────────────────────────


@router.post(
    "/batch/approve",
    response_model=BatchDocumentOperationOut,
    summary="批量核准目前待審公文",
)
async def batch_approve_documents(
    payload: BatchApproveRequest,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission(PermissionCode.DOCUMENT_APPROVE))],
    bg: BackgroundTasks,
) -> BatchDocumentOperationOut:
    results: list[BatchDocumentResult] = []
    for doc_id in _unique_doc_ids(payload.document_ids):
        doc = await doc_svc.get_document(session, doc_id)
        if doc is None:
            results.append(_batch_result(doc_id, ok=False, detail="找不到此公文"))
            continue
        try:
            updated = await doc_svc.approve_step(
                session,
                doc,
                approver_id=current_user.id,
                comment=payload.comment,
            )
            await audit_svc.record(
                session,
                entity_type="document",
                entity_id=str(updated.id),
                action="batch.approve",
                actor_id=str(current_user.id),
                actor_email=current_user.email,
                meta={"step": updated.current_step, "final": updated.status == DocumentStatus.APPROVED},
                summary=f"批量核准公文「{updated.title}」",
            )
            bg.add_task(_ws_broadcast_bg, updated)
            results.append(_batch_result(doc_id, ok=True, doc=updated))
        except (PermissionError, ValueError) as exc:
            results.append(_batch_result(doc_id, ok=False, doc=doc, detail=str(exc)))
    return _batch_out(results)


@router.post(
    "/batch/reject",
    response_model=BatchDocumentOperationOut,
    summary="批量退件目前待審公文",
)
async def batch_reject_documents(
    payload: BatchRejectRequest,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission(PermissionCode.DOCUMENT_REJECT))],
    bg: BackgroundTasks,
) -> BatchDocumentOperationOut:
    results: list[BatchDocumentResult] = []
    for doc_id in _unique_doc_ids(payload.document_ids):
        doc = await doc_svc.get_document(session, doc_id)
        if doc is None:
            results.append(_batch_result(doc_id, ok=False, detail="找不到此公文"))
            continue
        try:
            if payload.mode == RejectMode.TO_PREVIOUS:
                updated = await doc_svc.reject_to_previous_step(
                    session,
                    doc,
                    approver_id=current_user.id,
                    comment=payload.comment,
                )
            else:
                updated = await doc_svc.reject_step(
                    session,
                    doc,
                    approver_id=current_user.id,
                    comment=payload.comment,
                )
            await audit_svc.record(
                session,
                entity_type="document",
                entity_id=str(updated.id),
                action="batch.reject",
                actor_id=str(current_user.id),
                actor_email=current_user.email,
                meta={"mode": payload.mode, "comment": payload.comment},
                summary=f"批量退件公文「{updated.title}」",
            )
            bg.add_task(_ws_broadcast_bg, updated)
            results.append(_batch_result(doc_id, ok=True, doc=updated))
        except (PermissionError, ValueError) as exc:
            results.append(_batch_result(doc_id, ok=False, doc=doc, detail=str(exc)))
    return _batch_out(results)


@router.post(
    "/batch/archive",
    response_model=BatchDocumentOperationOut,
    summary="批量封存已核准公文",
)
async def batch_archive_documents(
    payload: BatchArchiveRequest,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission(PermissionCode.DOCUMENT_ARCHIVE))],
    bg: BackgroundTasks,
) -> BatchDocumentOperationOut:
    results: list[BatchDocumentResult] = []
    for doc_id in _unique_doc_ids(payload.document_ids):
        doc = await doc_svc.get_document(session, doc_id)
        if doc is None:
            results.append(_batch_result(doc_id, ok=False, detail="找不到此公文"))
            continue
        if doc.created_by != current_user.id and not current_user.is_superuser:
            results.append(_batch_result(doc_id, ok=False, doc=doc, detail="只有建立者可以封存公文"))
            continue
        try:
            updated = await doc_svc.archive_document(session, doc, requested_by=current_user.id)
            await audit_svc.record(
                session,
                entity_type="document",
                entity_id=str(updated.id),
                action="batch.archive",
                actor_id=str(current_user.id),
                actor_email=current_user.email,
                summary=f"批量封存公文「{updated.title}」",
            )
            bg.add_task(_ws_broadcast_bg, updated)
            results.append(_batch_result(doc_id, ok=True, doc=updated))
        except ValueError as exc:
            results.append(_batch_result(doc_id, ok=False, doc=doc, detail=str(exc)))
    return _batch_out(results)


@router.post(
    "/batch/delegate",
    response_model=BatchDocumentOperationOut,
    summary="批量設定目前審核步驟代理人",
)
async def batch_delegate_documents(
    payload: BatchDelegateRequest,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission(PermissionCode.DOCUMENT_FORWARD))],
) -> BatchDocumentOperationOut:
    results: list[BatchDocumentResult] = []
    for doc_id in _unique_doc_ids(payload.document_ids):
        doc = await doc_svc.get_document(session, doc_id)
        if doc is None:
            results.append(_batch_result(doc_id, ok=False, detail="找不到此公文"))
            continue
        try:
            await doc_svc.set_delegate(
                session,
                doc,
                step_order=payload.step_order or doc.current_step,
                requesting_user_id=current_user.id,
                delegate_id=payload.delegate_id,
            )
            await audit_svc.record(
                session,
                entity_type="document",
                entity_id=str(doc.id),
                action="batch.delegate",
                actor_id=str(current_user.id),
                actor_email=current_user.email,
                meta={
                    "step_order": payload.step_order or doc.current_step,
                    "delegate_id": str(payload.delegate_id) if payload.delegate_id else None,
                },
                summary=f"批量設定公文代理「{doc.title}」",
            )
            results.append(_batch_result(doc_id, ok=True, doc=doc))
        except (PermissionError, ValueError) as exc:
            results.append(_batch_result(doc_id, ok=False, doc=doc, detail=str(exc)))
    return _batch_out(results)


# ── 狀態機端點 ────────────────────────────────────────────────────────────────


@router.post(
    "/{doc_id}/submit",
    response_model=DocumentOut,
    summary="送審公文（草稿 → 待審核）",
    responses={
        200: {"description": "送審成功，第一關審核人收到通知"},
        403: {"description": "非建立者"},
        409: {"description": "非草稿狀態"},
    },
)
async def submit_document(
    doc_id: str,
    payload: SubmitRequest,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission(PermissionCode.DOCUMENT_SUBMIT))],
    bg: BackgroundTasks,
) -> Document:
    """送審後自動以 BackgroundTasks 通知第一位審核人（Email + WebSocket）"""
    doc = await _get_doc_or_404(doc_id, session)
    if doc.created_by != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有建立者可以送審")
    try:
        updated = await doc_svc.submit_document(session, doc, approver_ids=payload.approver_ids)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e

    # 通知第一位審核人（站內 + Email）
    if updated.approvals:
        approver = updated.approvals[0].delegate or updated.approvals[0].approver
        await create_notification(
            session,
            user_id=approver.id,
            type="document_pending",
            title=f"公文待你審核：{updated.title}",
            body=f"字號：{updated.serial_number}",
            link=f"/documents/{updated.id}",
            related_id=updated.id,
        )
        bg.add_task(_notify_approver_bg, approver.email, approver.display_name, updated)
    bg.add_task(_ws_broadcast_bg, updated)
    return updated


@router.post(
    "/{doc_id}/approve",
    response_model=DocumentOut,
    summary="核准當前步驟",
    responses={
        200: {"description": "核准成功（若最後一關則公文轉為已核准）"},
        403: {"description": "非當前步驟審核人"},
        409: {"description": "公文非待審核狀態"},
    },
)
async def approve_document(
    doc_id: str,
    payload: ApproveRequest,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission(PermissionCode.DOCUMENT_APPROVE))],
    bg: BackgroundTasks,
) -> Document:
    doc = await _get_doc_or_404(doc_id, session)
    try:
        updated = await doc_svc.approve_step(
            session, doc, approver_id=current_user.id, comment=payload.comment
        )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e

    await audit_svc.record(
        session,
        entity_type="document",
        entity_id=str(doc.id),
        action="approve",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"step": updated.current_step, "final": updated.status == DocumentStatus.APPROVED},
        summary=f"核准公文「{updated.title}」步驟 {updated.current_step}",
    )

    if updated.status == DocumentStatus.APPROVED:
        # 最後一關通過：通知建立者
        await create_notification(
            session,
            user_id=updated.created_by,
            type="document_approved",
            title=f"公文已核准：{updated.title}",
            body=f"字號：{updated.serial_number}",
            link=f"/documents/{updated.id}",
            related_id=updated.id,
        )
        bg.add_task(
            _notify_creator_bg, updated.creator.email, updated.creator.display_name, updated, "核准"
        )
    else:
        # 推進下一關：通知下一位審核人
        next_step = next(
            (a for a in updated.approvals if a.step_order == updated.current_step), None
        )
        if next_step:
            recipient = next_step.delegate or next_step.approver
            await create_notification(
                session,
                user_id=recipient.id,
                type="document_pending",
                title=f"公文待你審核：{updated.title}",
                body=f"字號：{updated.serial_number}",
                link=f"/documents/{updated.id}",
                related_id=updated.id,
            )
            bg.add_task(_notify_approver_bg, recipient.email, recipient.display_name, updated)
    bg.add_task(_ws_broadcast_bg, updated)
    return updated


@router.post(
    "/{doc_id}/reject",
    response_model=DocumentOut,
    summary="退件（支援退回至承辦人 或 退回至上一關）",
    responses={
        200: {"description": "退件成功"},
        403: {"description": "非當前步驟審核人"},
        409: {"description": "狀態衝突或第一關不可退回上一關"},
    },
)
async def reject_document(
    doc_id: str,
    payload: RejectRequest,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission(PermissionCode.DOCUMENT_REJECT))],
    bg: BackgroundTasks,
) -> Document:
    """
    **mode=to_creator**（預設）：退回至承辦人，流程終止，公文轉為 `REJECTED`。\n
    **mode=to_previous**：退回至上一關核稿人，流程繼續，公文維持 `PENDING`。
    """
    doc = await _get_doc_or_404(doc_id, session)
    try:
        if payload.mode == RejectMode.TO_PREVIOUS:
            updated = await doc_svc.reject_to_previous_step(
                session, doc, approver_id=current_user.id, comment=payload.comment
            )
        else:
            updated = await doc_svc.reject_step(
                session, doc, approver_id=current_user.id, comment=payload.comment
            )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e

    await audit_svc.record(
        session,
        entity_type="document",
        entity_id=str(doc.id),
        action="reject",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"mode": payload.mode, "comment": payload.comment},
        summary=f"退件公文「{updated.title}」（{payload.mode}）",
    )

    # 通知建立者（退回至承辦人）或通知上一關審核人（退回上一關）
    if payload.mode == RejectMode.TO_CREATOR:
        await create_notification(
            session,
            user_id=updated.created_by,
            type="document_rejected",
            title=f"公文被退件：{updated.title}",
            body=f"字號：{updated.serial_number}",
            link=f"/documents/{updated.id}",
            related_id=updated.id,
        )
        bg.add_task(
            _notify_creator_bg, updated.creator.email, updated.creator.display_name, updated, "退件"
        )
    else:
        prev_step = next(
            (a for a in updated.approvals if a.step_order == updated.current_step), None
        )
        if prev_step:
            recipient = prev_step.delegate or prev_step.approver
            await create_notification(
                session,
                user_id=recipient.id,
                type="document_pending",
                title=f"公文退回待你重審：{updated.title}",
                body=f"字號：{updated.serial_number}",
                link=f"/documents/{updated.id}",
                related_id=updated.id,
            )
            bg.add_task(_notify_approver_bg, recipient.email, recipient.display_name, updated)
    bg.add_task(_ws_broadcast_bg, updated)
    return updated


@router.put(
    "/{doc_id}/approvals/{step_order}/delegate",
    response_model=DocumentOut,
    summary="設定/清除審核步驟的代理人",
    responses={
        200: {"description": "代理人設定成功"},
        403: {"description": "您不是此步驟的原始審核人"},
        404: {"description": "公文不存在"},
        409: {"description": "步驟已完成，無法變更"},
    },
)
async def set_step_delegate(
    doc_id: str,
    step_order: int,
    payload: dict,
    session: DbDep,
    current_user: CurrentUser,
) -> Document:
    """
    由主審核人為自己的審核步驟設定代理人。
    Body: `{"delegate_id": "uuid-string"}` 或 `{"delegate_id": null}` 清除代理人。
    """
    doc = await _get_doc_or_404(doc_id, session)
    raw_delegate = payload.get("delegate_id")
    delegate_id: uuid.UUID | None = uuid.UUID(raw_delegate) if raw_delegate else None
    try:
        await doc_svc.set_delegate(
            session,
            doc,
            step_order=step_order,
            requesting_user_id=current_user.id,
            delegate_id=delegate_id,
        )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    return await doc_svc.get_document(session, doc_id)  # type: ignore[return-value]


@router.get(
    "/management/delegations",
    response_model=list[DocumentApprovalDelegationOut],
    summary="列出公文簽核代理授權",
)
async def list_document_delegations(
    session: DbDep,
    current_user: CurrentUser,
    org_id: uuid.UUID | None = Query(None),
    principal_user_id: uuid.UUID | None = Query(None),
    include_inactive: bool = Query(False),
) -> list[DocumentApprovalDelegationOut]:
    target_principal = principal_user_id or current_user.id
    if target_principal != current_user.id and (
        org_id is None or not await _can_manage_delegation_for_org(session, current_user, org_id)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="您無權查看他人的代理授權"
        )
    return await doc_svc.list_approval_delegations(
        session,
        principal_user_id=target_principal,
        org_id=org_id,
        active_only=not include_inactive,
    )


@router.post(
    "/management/delegations",
    response_model=DocumentApprovalDelegationOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立公文簽核代理授權",
)
async def create_document_delegation(
    payload: DocumentApprovalDelegationCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> DocumentApprovalDelegationOut:
    try:
        return await doc_svc.create_approval_delegation(
            session,
            principal_user_id=current_user.id,
            created_by=current_user.id,
            data=payload,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.patch(
    "/management/delegations/{delegation_id}",
    response_model=DocumentApprovalDelegationOut,
    summary="更新公文簽核代理授權",
)
async def update_document_delegation(
    delegation_id: uuid.UUID,
    payload: DocumentApprovalDelegationUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> DocumentApprovalDelegationOut:
    delegation = await doc_svc.get_approval_delegation(session, delegation_id)
    if delegation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此代理授權")
    if delegation.principal_user_id != current_user.id and not await _can_manage_delegation_for_org(
        session, current_user, delegation.org_id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="您無權修改此代理授權")
    try:
        return await doc_svc.update_approval_delegation(session, delegation, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.delete(
    "/management/delegations/{delegation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="停用公文簽核代理授權",
)
async def delete_document_delegation(
    delegation_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> Response:
    delegation = await doc_svc.get_approval_delegation(session, delegation_id)
    if delegation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此代理授權")
    if delegation.principal_user_id != current_user.id and not await _can_manage_delegation_for_org(
        session, current_user, delegation.org_id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="您無權停用此代理授權")
    await doc_svc.deactivate_approval_delegation(session, delegation)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{doc_id}/recall",
    response_model=DocumentOut,
    summary="撤回送審（回到草稿）",
    responses={
        200: {"description": "撤回成功，公文回到草稿"},
        403: {"description": "非建立者，或第一關已開始審核"},
        409: {"description": "非待審核狀態"},
    },
)
async def recall_document(
    doc_id: str,
    _payload: RecallRequest,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission(PermissionCode.DOCUMENT_RECALL))],
    bg: BackgroundTasks,
) -> Document:
    doc = await _get_doc_or_404(doc_id, session)
    try:
        updated = await doc_svc.recall_document(session, doc, requested_by=current_user.id)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e

    bg.add_task(_ws_broadcast_bg, updated)
    return updated


@router.post(
    "/{doc_id}/archive",
    response_model=DocumentOut,
    summary="封存公文（已核准 → 封存終態）",
    responses={
        200: {"description": "封存成功"},
        403: {"description": "非建立者或管理員"},
        409: {"description": "公文非已核准狀態"},
    },
)
async def archive_document(
    doc_id: str,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission(PermissionCode.DOCUMENT_ARCHIVE))],
    bg: BackgroundTasks,
) -> Document:
    doc = await _get_doc_or_404(doc_id, session)
    if doc.created_by != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有建立者可以封存公文")
    try:
        updated = await doc_svc.archive_document(session, doc, requested_by=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e

    await audit_svc.record(
        session,
        entity_type="document",
        entity_id=str(doc.id),
        action="archive",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        summary=f"封存公文「{updated.title}」",
    )
    bg.add_task(_ws_broadcast_bg, updated)
    return updated


# ── 直接發文（跳過審核）─────────────────────────────────────────────────────────


class IssuedDirectRequest(BaseModel):
    comment: str | None = None


@router.post(
    "/{doc_id}/issue-direct",
    response_model=DocumentOut,
    summary="直接發文（跳過審核，需 document:issue_direct 權限）",
    responses={
        200: {"description": "發文成功，公文狀態變為已核准"},
        403: {"description": "無直接發文權限"},
        409: {"description": "公文非草稿狀態"},
    },
)
async def issue_document_directly(
    doc_id: str,
    payload: IssuedDirectRequest,
    session: DbDep,
    current_user: Annotated[
        User, Depends(require_permission(PermissionCode.DOCUMENT_ISSUE_DIRECT))
    ],
    bg: BackgroundTasks,
) -> Document:
    """
    擁有 document:issue_direct 權限者（如機關首長）可直接將草稿發布為已核准，
    跳過所有審核步驟。仍會記錄一筆審計軌跡（step_order=1, status=approved）。
    """
    doc = await _get_doc_or_404(doc_id, session)
    if doc.created_by != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有建立者可直接發文")
    try:
        updated = await doc_svc.issue_document_directly(
            session, doc, issued_by=current_user.id, comment=payload.comment
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e

    # 重新查詢含完整關聯的物件（避免 Lazy Loading）
    loaded = await doc_svc.get_document(session, updated.id)
    assert loaded is not None

    # 通知建立者（若非自己）
    await create_notification(
        session,
        user_id=loaded.created_by,
        type="document_approved",
        title=f"公文已直接發文：{loaded.title}",
        body=f"字號：{loaded.serial_number}",
        link=f"/documents/{loaded.id}",
        related_id=loaded.id,
    )
    bg.add_task(_ws_broadcast_bg, loaded)
    return loaded


@router.get(
    "/{doc_id}/suggest-approvers",
    summary="建議審核人（依公文組織，擁有 document:approve 權限的現任成員）",
    response_model=list[dict],
)
async def suggest_approvers(
    doc_id: str,
    session: DbDep,
    current_user: CurrentUser,
) -> list[dict]:
    """回傳建議審核人列表，供前端在送審面板自動預帶。"""
    doc = await _get_doc_or_404(doc_id, session)
    await _assert_access(session, doc, current_user)
    users = await doc_svc.suggest_approvers(session, doc.org_id)
    return [{"id": str(u.id), "display_name": u.display_name, "email": u.email} for u in users]


# ── 附件管理 ──────────────────────────────────────────────────────────────────


@router.get(
    "/{doc_id}/attachments",
    response_model=list[AttachmentOut],
    summary="列出附件",
)
async def list_attachments(
    doc_id: str, session: DbDep, current_user: OptionalUser
) -> list[DocumentAttachment]:
    doc = await _get_doc_or_404(doc_id, session)
    if current_user is None:
        if not doc.is_public:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此公文")
    else:
        await _assert_access(session, doc, current_user)
    storage = get_storage()
    for att in doc.attachments:
        if att.storage_key:
            att.__dict__["url"] = await storage.get_url(att.storage_key)
        else:
            att.__dict__["url"] = ""
    return doc.attachments


@router.post(
    "/{doc_id}/attachments",
    response_model=AttachmentOut,
    status_code=status.HTTP_201_CREATED,
    summary="上傳附件（支援 PDF / JPG / ZIP，最大 20MB）",
    responses={
        201: {"description": "上傳成功"},
        403: {"description": "無查看權限"},
        422: {"description": "檔案類型或大小不符規定"},
    },
)
async def upload_attachment(
    doc_id: str,
    session: DbDep,
    current_user: CurrentUser,
    file: UploadFile = File(..., description="附件檔案（PDF / 圖片 / Office 文件 / ZIP）"),
) -> DocumentAttachment:
    doc = await _get_doc_or_404(doc_id, session)
    await _assert_access(session, doc, current_user)
    await _assert_can_edit(session, doc, current_user)

    storage = get_storage()
    try:
        stored = await storage.save(file, prefix=str(doc_id))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e

    attachment = DocumentAttachment(
        document_id=doc.id,
        filename=stored.filename,
        storage_key=stored.storage_key,
        content_type=stored.content_type,
        file_size=stored.file_size,
        uploaded_by=current_user.id,
    )
    session.add(attachment)
    await session.flush()
    attachment.__dict__["url"] = stored.url
    return attachment


@router.post(
    "/{doc_id}/attachments/link",
    response_model=AttachmentOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增外部連結附件",
)
async def add_link_attachment(
    doc_id: str,
    body: AttachmentLinkCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> DocumentAttachment:
    doc = await _get_doc_or_404(doc_id, session)
    await _assert_access(session, doc, current_user)
    await _assert_can_edit(session, doc, current_user)
    display = (
        body.display_text.strip() if body.display_text and body.display_text.strip() else body.url
    )
    attachment = DocumentAttachment(
        document_id=doc.id,
        filename=display,
        link_url=str(body.url),
        uploaded_by=current_user.id,
    )
    session.add(attachment)
    await session.flush()
    attachment.__dict__["url"] = ""
    return attachment


@router.delete(
    "/{doc_id}/attachments/{att_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除附件（上傳者或管理員）",
    responses={
        204: {"description": "刪除成功"},
        403: {"description": "非上傳者"},
        404: {"description": "附件不存在"},
    },
)
async def delete_attachment(
    doc_id: str,
    att_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> None:
    doc = await _get_doc_or_404(doc_id, session)
    await _assert_access(session, doc, current_user)
    result = await session.execute(
        select(DocumentAttachment).where(
            DocumentAttachment.id == att_id,
            DocumentAttachment.document_id == doc.id,
        )
    )
    att = result.scalar_one_or_none()
    if att is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此附件")
    if att.uploaded_by != current_user.id and doc.created_by != current_user.id:
        await _assert_can_edit(session, doc, current_user)

    storage = get_storage()
    await storage.delete(att.storage_key)
    await session.delete(att)


class AttachmentRenameRequest(BaseModel):
    filename: str


@router.patch(
    "/{doc_id}/attachments/{att_id}",
    response_model=AttachmentOut,
    summary="重新命名附件",
)
async def rename_attachment(
    doc_id: str,
    att_id: uuid.UUID,
    payload: AttachmentRenameRequest,
    session: DbDep,
    current_user: CurrentUser,
) -> DocumentAttachment:
    doc = await _get_doc_or_404(doc_id, session)
    await _assert_access(session, doc, current_user)
    await _assert_can_edit(session, doc, current_user)
    result = await session.execute(
        select(DocumentAttachment).where(
            DocumentAttachment.id == att_id,
            DocumentAttachment.document_id == doc.id,
        )
    )
    att = result.scalar_one_or_none()
    if att is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此附件")
    new_name = payload.filename.strip()
    if not new_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="附件名稱不可為空"
        )
    att.display_name = new_name
    await session.flush()
    storage = get_storage()
    att.__dict__["url"] = await storage.get_url(att.storage_key) if att.storage_key else ""
    return att


@router.get(
    "/{doc_id}/attachments/{att_id}/download",
    summary="下載附件（公開公文可匿名下載）",
)
async def download_attachment(
    doc_id: str,
    att_id: uuid.UUID,
    session: DbDep,
    current_user: OptionalUser,
) -> FileResponse:
    doc = await _get_doc_or_404(doc_id, session)
    if current_user is None:
        if not doc.is_public:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此公文")
    else:
        await _assert_access(session, doc, current_user)
    result = await session.execute(
        select(DocumentAttachment).where(
            DocumentAttachment.id == att_id,
            DocumentAttachment.document_id == doc.id,
        )
    )
    att = result.scalar_one_or_none()
    if att is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此附件")
    if not att.storage_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="此附件為外部連結，無法直接下載"
        )
    import os

    file_path = os.path.join("uploads", att.storage_key)
    filename = att.display_name or att.filename
    encoded_filename = quote(filename.encode("utf-8"))
    return FileResponse(
        path=file_path,
        filename=filename,
        media_type=att.content_type,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"},
    )


@router.get(
    "/{doc_id}/attachments/{att_id}/preview",
    summary="預覽附件（inline；避免瀏覽器自動下載）",
)
async def preview_attachment(
    doc_id: str,
    att_id: uuid.UUID,
    session: DbDep,
    current_user: OptionalUser,
) -> FileResponse:
    doc = await _get_doc_or_404(doc_id, session)
    if current_user is None:
        if not doc.is_public:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此公文")
    else:
        await _assert_access(session, doc, current_user)
    result = await session.execute(
        select(DocumentAttachment).where(
            DocumentAttachment.id == att_id,
            DocumentAttachment.document_id == doc.id,
        )
    )
    att = result.scalar_one_or_none()
    if att is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此附件")
    if not att.storage_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="此附件為外部連結，無法直接預覽"
        )
    import os

    file_path = os.path.join("uploads", att.storage_key)
    filename = att.display_name or att.filename
    encoded_filename = quote(filename.encode("utf-8"))
    return FileResponse(
        path=file_path,
        media_type=att.content_type,
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{encoded_filename}"},
    )


# ── 受文者管理 ────────────────────────────────────────────────────────────────


@router.put(
    "/{doc_id}/recipients",
    response_model=DocumentOut,
    summary="整批更新受文者清單（正本 / 副本 / 主旨對象）",
    responses={
        200: {"description": "受文者更新成功"},
        403: {"description": "非建立者"},
        409: {"description": "非草稿狀態"},
    },
)
async def update_recipients(
    doc_id: str,
    recipients: list[RecipientCreate],
    session: DbDep,
    current_user: CurrentUser,
) -> Document:
    """
    整批更新受文者（先刪除舊有，再建立新的）。
    公文規格：受文者 = 主旨對象；正本 = 需執行單位；副本 = 知悉備查單位。
    """
    doc = await _get_doc_or_404(doc_id, session)
    if doc.created_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="只有建立者可以修改受文者"
        )
    try:
        await doc_svc.upsert_recipients(session, doc, recipients=recipients)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e

    # 重新載入公文（含新受文者）
    return await doc_svc.get_document(session, doc.id)  # type: ignore[return-value]


# ── 列印視圖 ──────────────────────────────────────────────────────────────────


@router.get(
    "/{doc_id}/print",
    response_class=Response,
    summary="下載公文 PDF",
    responses={
        200: {"description": "PDF 公文檔案"},
        403: {"description": "無查看權限"},
        404: {"description": "公文不存在"},
    },
)
async def print_document(doc_id: str, session: DbDep, current_user: CurrentUser) -> Response:
    """直接產生並下載中華民國公文格式 PDF。"""
    from api.services.official_print import render_document_print_html, render_print_pdf

    doc = await _get_doc_or_404(doc_id, session)
    await _assert_access(session, doc, current_user)
    html_content = await render_document_print_html(session, doc, current_user)
    pdf_bytes = await run_in_threadpool(render_print_pdf, html_content)
    filename_base = doc.serial_number or doc.title or "document"
    filename = f"{filename_base.replace('/', '_').replace('\\', '_')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


# ── 公文範本庫 ────────────────────────────────────────────────────────────────


@template_router.get("", response_model=list[DocumentTemplateOut], summary="列出公文內容範本")
async def list_document_templates(
    session: DbDep,
    current_user: CurrentUser,
    org_id: uuid.UUID | None = Query(None, description="過濾組織"),
    category: DocumentCategory | None = Query(None, description="過濾公文類別"),
    active_only: bool = Query(True, description="僅顯示有效範本"),
    keyword: str | None = Query(None, max_length=100, description="搜尋名稱、說明、主旨"),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[object]:
    if org_id is not None:
        await _require_document_template_use(session, current_user, org_id)
        org_ids = None
    elif current_user.is_superuser:
        org_ids = None
    else:
        org_ids = await _org_ids_with_document_permissions(session, current_user)
    return await doc_svc.list_document_templates(
        session,
        org_id=org_id,
        org_ids=org_ids,
        category=category,
        active_only=active_only,
        keyword=keyword,
        limit=limit,
        offset=offset,
    )


@template_router.post(
    "",
    response_model=DocumentTemplateOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立公文內容範本",
)
async def create_document_template(
    payload: DocumentTemplateCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> object:
    await _require_document_template_manage(session, current_user, payload.org_id)
    from sqlalchemy.exc import IntegrityError

    try:
        template = await doc_svc.create_document_template(
            session,
            data=payload,
            created_by=current_user.id,
        )
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="同組織內已有同名同版本公文範本",
        ) from exc
    await audit_svc.record(
        session,
        entity_type="document_template",
        entity_id=str(template.id),
        action="document_template.create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"org_id": str(template.org_id), "category": template.category.value},
        summary=f"建立公文範本「{template.name}」",
    )
    return template


@template_router.get("/{template_id}", response_model=DocumentTemplateOut, summary="取得公文內容範本")
async def get_document_template(
    template_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> object:
    template = await doc_svc.get_document_template(session, template_id)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此公文範本")
    await _require_document_template_use(session, current_user, template.org_id)
    return template


@template_router.patch(
    "/{template_id}",
    response_model=DocumentTemplateOut,
    summary="更新公文內容範本",
)
async def update_document_template(
    template_id: uuid.UUID,
    payload: DocumentTemplateUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> object:
    template = await doc_svc.get_document_template(session, template_id)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此公文範本")
    await _require_document_template_manage(session, current_user, template.org_id)
    before = {
        "name": template.name,
        "version": template.version,
        "is_active": template.is_active,
        "category": template.category.value,
    }
    template = await doc_svc.update_document_template(
        session,
        template,
        data=payload,
        updated_by=current_user.id,
    )
    await audit_svc.record(
        session,
        entity_type="document_template",
        entity_id=str(template.id),
        action="document_template.update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "before": before,
            "after": {
                "name": template.name,
                "version": template.version,
                "is_active": template.is_active,
                "category": template.category.value,
            },
        },
        summary=f"更新公文範本「{template.name}」",
    )
    return template


@template_router.delete(
    "/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="停用公文內容範本",
)
async def deactivate_document_template(
    template_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> None:
    template = await doc_svc.get_document_template(session, template_id)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此公文範本")
    await _require_document_template_manage(session, current_user, template.org_id)
    await doc_svc.deactivate_document_template(session, template, updated_by=current_user.id)
    await audit_svc.record(
        session,
        entity_type="document_template",
        entity_id=str(template.id),
        action="document_template.deactivate",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"org_id": str(template.org_id), "version": template.version},
        summary=f"停用公文範本「{template.name}」",
    )


@template_router.post(
    "/{template_id}/draft",
    response_model=DocumentOut,
    status_code=status.HTTP_201_CREATED,
    summary="從公文範本建立草稿",
)
async def create_document_from_template(
    template_id: uuid.UUID,
    payload: DocumentTemplateDraftCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> Document:
    template = await doc_svc.get_document_template(session, template_id)
    if template is None or not template.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此可用公文範本")
    await _require_document_template_use(session, current_user, template.org_id)
    try:
        doc = await doc_svc.create_document_from_template(
            session,
            template=template,
            data=payload,
            created_by=current_user.id,
        )
    except (PermissionError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    await audit_svc.record(
        session,
        entity_type="document",
        entity_id=str(doc.id),
        action="document.create_from_template",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"template_id": str(template.id), "template_name": template.name},
        summary=f"由範本「{template.name}」建立公文「{doc.title}」",
    )
    return doc


@serial_router.post(
    "",
    response_model=SerialTemplateOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立字號模板（需 serial:create，限本組織）",
    responses={
        201: {"description": "字號模板建立成功，字號格式如：嶺代生字第 1150000001 號"},
        403: {"description": "需要 serial:create 權限（限本組織）"},
        409: {"description": "相同 org_prefix + category_char 組合已存在"},
    },
)
async def create_serial_template(
    payload: SerialTemplateCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> object:
    """
    在本組織下建立字號模板，需擁有 `serial:create` 權限（org-scoped）。
    一個 org_prefix + category_char 組合只能建立一個模板（UniqueConstraint）。
    """
    if not current_user.is_superuser:
        codes = await get_user_permission_codes_for_org(session, current_user.id, payload.org_id)
        if "serial:create" not in codes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="您在此組織下無新增字號模板的權限（需 serial:create）",
            )
    from sqlalchemy.exc import IntegrityError

    try:
        template = await doc_svc.create_serial_template(
            session, data=payload, created_by=current_user.id
        )
        await audit_svc.record(
            session,
            entity_type="serial_template",
            entity_id=str(template.id),
            action="serial.create",
            actor_id=str(current_user.id),
            actor_email=current_user.email,
            meta={
                "org_id": str(template.org_id),
                "org_prefix": template.org_prefix,
                "category_char": template.category_char,
                "year_mode": template.year_mode.value,
                "is_default": template.is_default,
                "is_default_president_publish": template.is_default_president_publish,
            },
            summary=f"建立字號模板「{template.org_prefix}{template.category_char}字」",
        )
        if template.is_default:
            await audit_svc.record(
                session,
                entity_type="serial_template",
                entity_id=str(template.id),
                action="serial.set_default",
                actor_id=str(current_user.id),
                actor_email=current_user.email,
                meta={"org_id": str(template.org_id), "default_type": "global"},
                summary=f"設為一般預設字號模板「{template.org_prefix}{template.category_char}字」",
            )
        if template.is_default_president_publish:
            await audit_svc.record(
                session,
                entity_type="serial_template",
                entity_id=str(template.id),
                action="serial.set_president_default",
                actor_id=str(current_user.id),
                actor_email=current_user.email,
                meta={"org_id": str(template.org_id), "default_type": "president_publish"},
                summary=f"設為主席公告預設字號模板「{template.org_prefix}{template.category_char}字」",
            )
        return SerialTemplateOut.from_orm_with_preview(template)
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="相同的字號前綴組合（org_prefix + category_char）已存在於此組織",
        ) from exc


@serial_router.get(
    "",
    response_model=list[SerialTemplateOut],
    summary="列出字號模板（依組織過濾）",
)
async def list_serial_templates(
    session: DbDep,
    current_user: CurrentUser,
    org_id: uuid.UUID | None = Query(None, description="過濾組織（不填則顯示所有）"),
    active_only: bool = Query(True, description="僅顯示有效模板"),
) -> list[object]:
    """列出可供選擇的字號模板，進入公文起稿頁面時呼叫此 API 取得下拉選單。"""
    templates = await doc_svc.list_serial_templates(session, org_id=org_id, active_only=active_only)
    return [SerialTemplateOut.from_orm_with_preview(t) for t in templates]


@serial_router.get(
    "/{template_id}",
    response_model=SerialTemplateOut,
    summary="取得字號模板詳細",
    responses={404: {"description": "模板不存在"}},
)
async def get_serial_template(
    template_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> object:
    template = await doc_svc.get_serial_template(session, template_id)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此字號模板")
    return SerialTemplateOut.from_orm_with_preview(template)


@serial_router.delete(
    "/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="停用字號模板（需 serial:delete，限本組織）",
    responses={
        204: {"description": "停用成功"},
        403: {"description": "需要 serial:delete 權限"},
        404: {"description": "模板不存在"},
    },
)
async def deactivate_serial_template(
    template_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> None:
    """停用字號模板（is_active=False），需在該模板所屬組織下擁有 serial:delete 權限。"""
    template = await doc_svc.get_serial_template(session, template_id)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此字號模板")
    if not current_user.is_superuser:
        codes = await get_user_permission_codes_for_org(session, current_user.id, template.org_id)
        if "serial:delete" not in codes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="您在此組織下無停用字號模板的權限（需 serial:delete）",
            )
    before = {
        "is_active": template.is_active,
        "is_default": template.is_default,
        "is_default_president_publish": template.is_default_president_publish,
    }
    await doc_svc.deactivate_serial_template(session, template)
    await audit_svc.record(
        session,
        entity_type="serial_template",
        entity_id=str(template.id),
        action="serial.deactivate",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "before": before,
            "after": {
                "is_active": template.is_active,
                "is_default": template.is_default,
                "is_default_president_publish": template.is_default_president_publish,
            },
            "org_id": str(template.org_id),
            "org_prefix": template.org_prefix,
            "category_char": template.category_char,
        },
        summary=f"停用字號模板「{template.org_prefix}{template.category_char}字」",
    )


@serial_router.patch(
    "/{template_id}",
    response_model=SerialTemplateOut,
    summary="更新字號模板（需 serial:create，限本組織）",
    responses={
        403: {"description": "需要 serial:create 權限"},
        404: {"description": "模板不存在"},
    },
)
async def update_serial_template(
    template_id: uuid.UUID,
    payload: SerialTemplateUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> object:
    """更新字號模板的描述、年份制度或重置設定。"""
    template = await doc_svc.get_serial_template(session, template_id)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此字號模板")
    if not current_user.is_superuser:
        codes = await get_user_permission_codes_for_org(session, current_user.id, template.org_id)
        if "serial:create" not in codes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="您在此組織下無修改字號模板的權限（需 serial:create）",
            )
    before = {
        "description": template.description,
        "year_mode": template.year_mode.value,
        "reset_on_new_year": template.reset_on_new_year,
        "is_active": template.is_active,
        "is_default": template.is_default,
        "is_default_president_publish": template.is_default_president_publish,
    }
    template = await doc_svc.update_serial_template(
        session,
        template,
        updates=payload.model_dump(exclude_none=True),
    )
    after = {
        "description": template.description,
        "year_mode": template.year_mode.value,
        "reset_on_new_year": template.reset_on_new_year,
        "is_active": template.is_active,
        "is_default": template.is_default,
        "is_default_president_publish": template.is_default_president_publish,
    }
    await audit_svc.record(
        session,
        entity_type="serial_template",
        entity_id=str(template.id),
        action="serial.update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "before": before,
            "after": after,
            "org_id": str(template.org_id),
            "org_prefix": template.org_prefix,
            "category_char": template.category_char,
        },
        summary=f"更新字號模板「{template.org_prefix}{template.category_char}字」",
    )
    if not before["is_default"] and template.is_default:
        await audit_svc.record(
            session,
            entity_type="serial_template",
            entity_id=str(template.id),
            action="serial.set_default",
            actor_id=str(current_user.id),
            actor_email=current_user.email,
            meta={"org_id": str(template.org_id), "default_type": "global"},
            summary=f"設為一般預設字號模板「{template.org_prefix}{template.category_char}字」",
        )
    if not before["is_default_president_publish"] and template.is_default_president_publish:
        await audit_svc.record(
            session,
            entity_type="serial_template",
            entity_id=str(template.id),
            action="serial.set_president_default",
            actor_id=str(current_user.id),
            actor_email=current_user.email,
            meta={"org_id": str(template.org_id), "default_type": "president_publish"},
            summary=f"設為主席公告預設字號模板「{template.org_prefix}{template.category_char}字」",
        )
    return SerialTemplateOut.from_orm_with_preview(template)
