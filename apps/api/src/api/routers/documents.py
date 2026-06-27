"""
公文系統 Router
=============
RBAC 權限說明：
  - document:draft   → 草擬公文
  - document:create  → 發起公文流程
  - document:approve → 審核（核准/退件）
  - document:admin   → 管理員操作（封存、不受組織限制的列表查詢）
所有讀取端點依「組織可見性」過濾（同組成員、建立者、審核人）。
BackgroundTasks 在狀態變更時非同步推送 Email 與 WebSocket 通知。
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated
from urllib.parse import quote

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    status,
)
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from sqlalchemy import and_, extract, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

import json

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.core.security import redis_client
from api.core.posthog import get_posthog_client
from api.dependencies.auth import get_current_active_user, get_optional_user
from api.models.document import (
    ApprovalStepStatus,
    DelegateSource,
    Document,
    DocumentApproval,
    DocumentApprovalDelegation,
    DocumentCategory,
    DocumentClassification,
    DocumentStatus,
    DocumentVisibility,
)
from api.models.user import User
from api.routers.documents_helpers import (
    assert_access as _assert_access,
)
from api.routers.documents_helpers import (
    attach_approval_titles as _attach_approval_titles,
)
from api.routers.documents_helpers import (
    get_doc_or_404 as _get_doc_or_404,
)
from api.schemas.context import DocumentApprovalContextOut
from api.schemas.document import (
    DocumentCreate,
    DocumentListItem,
    DocumentOut,
    DocumentUpdate,
    RecipientCreate,
    RecipientDownloadVariant,
)
from api.services import activity as activity_svc
from api.services import audit as audit_svc
from api.services import context as context_svc
from api.services import document as doc_svc
from api.services.permission import (
    get_user_permission_codes,
    get_user_permission_codes_for_org,
    user_is_org_leader,
)

router = APIRouter(prefix="/documents", tags=["公文系統"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]


# ── 統計 ──────────────────────────────────────────────────────────────────────


@router.get(
    "/stats",
    summary="取得公文統計數據（草稿 / 待審 / 本月核准 / 退件 / 待我審核）",
)
async def get_document_stats(session: DbDep, current_user: CurrentUser) -> dict:
    """回傳當前使用者相關的公文計數，供儀表板顯示（計數限制以避免 full table scan）。"""
    from datetime import UTC, datetime

    cache_key = f"doc_stats:{current_user.id}"
    try:
        raw = await redis_client.get(cache_key)
        if raw:
            return json.loads(raw)
    except Exception:
        pass

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

    result = {
        "draft": draft_count,
        "pending_submitted": pending_count,
        "pending_my_approval": my_pending,
        "approved_this_month": approved_month,
        "rejected": rejected_count,
    }
    try:
        await redis_client.set(cache_key, json.dumps(result), ex=60)
    except Exception:
        pass
    return result


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
    建立草稿公文並生成字號。需在目標組織下擁有 document:draft 或 document:create 權限。
    """
    if not current_user.is_superuser:
        codes = await get_user_permission_codes_for_org(session, current_user.id, payload.org_id)
        is_activity_manager = await activity_svc.can_manage_activity_resource(
            session, current_user, payload.activity_id
        )
        if (
            not ({"document:draft", "document:create", "document:admin"} & set(codes))
            and not is_activity_manager
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="您在此組織或活動下無草擬公文的權限（需 document:draft/document:create 或活動總召）",
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

    _ph = get_posthog_client()
    if _ph:
        _ph.capture(
            distinct_id=str(current_user.id),
            event="document_created",
            properties={
                "category": doc.category.value if doc.category else None,
                "org_id": str(doc.org_id) if doc.org_id else None,
            },
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
    activity_id: uuid.UUID | None = Query(None, description="過濾活動"),
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
) -> list[DocumentListItem]:
    can_view_all = False
    if current_user is not None:
        codes = await get_user_permission_codes(session, current_user.id)
        can_view_all = current_user.is_superuser or bool(
            {
                str(PermissionCode.ADMIN_ALL),
                str(PermissionCode.DOCUMENT_VIEW_ALL),
                str(PermissionCode.DOCUMENT_ADMIN),
            }
            & set(codes)
        )

    docs = await doc_svc.list_documents(
        session,
        org_id=org_id,
        activity_id=activity_id,
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
        viewer_id=None if can_view_all else (current_user.id if current_user else None),
    )
    return await doc_svc.build_document_list_items(
        session,
        docs,
        viewer_id=current_user.id if current_user else None,
        reveal_sensitive=can_view_all,
    )


@router.get(
    "/{doc_id}/approval-context",
    response_model=DocumentApprovalContextOut,
    summary="取得公文簽核脈絡",
)
async def document_approval_context(
    doc_id: str, session: DbDep, current_user: CurrentUser
) -> DocumentApprovalContextOut:
    doc = await _get_doc_or_404(doc_id, session)
    await _assert_access(session, doc, current_user)
    return await context_svc.document_approval_context(session, doc.id)


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
        if not doc_svc.can_anonymous_access_document(doc):
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
    current_user: CurrentUser,
) -> Document:
    doc = await _get_doc_or_404(doc_id, session)
    if not current_user.is_superuser:
        codes = await get_user_permission_codes_for_org(session, current_user.id, doc.org_id)
        is_activity_manager = await activity_svc.can_manage_activity_resource(
            session, current_user, doc.activity_id
        )
        is_org_leader = await user_is_org_leader(session, current_user.id, doc.org_id)
        if not (
            (
                doc.created_by == current_user.id
                and {"document:draft", "document:edit", "document:create"} & set(codes)
            )
            or is_org_leader
            or "document:admin" in codes
            or is_activity_manager
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="只有草擬者、部門最高權限者、document:edit/document:admin 或活動總召可以編輯",
            )
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
    if not current_user.is_superuser:
        codes = await get_user_permission_codes_for_org(session, current_user.id, doc.org_id)
        is_activity_manager = await activity_svc.can_manage_activity_resource(
            session, current_user, doc.activity_id
        )
        is_org_leader = await user_is_org_leader(session, current_user.id, doc.org_id)
        if not (
            doc.created_by == current_user.id
            or is_org_leader
            or "document:delete" in codes
            or "document:admin" in codes
            or is_activity_manager
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="您無刪除此公文的權限（需建立者、部門最高權限者或 document:delete/document:admin）",
            )
    try:
        await doc_svc.delete_document(session, doc)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


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
    if not current_user.is_superuser:
        codes = await get_user_permission_codes_for_org(session, current_user.id, doc.org_id)
        is_org_leader = await user_is_org_leader(session, current_user.id, doc.org_id)
        if not (doc.created_by == current_user.id or is_org_leader or "document:admin" in codes):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="只有草擬者、部門最高權限者或 document:admin 可以修改受文者",
            )
    try:
        await doc_svc.upsert_recipients(session, doc, recipients=recipients)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e

    # 重新載入公文（含新受文者）
    return await doc_svc.get_document(session, doc.id)  # type: ignore[return-value]


# ── 列印視圖 ──────────────────────────────────────────────────────────────────


async def _is_document_admin(session: AsyncSession, doc: Document, user: User) -> bool:
    """是否為公文管理員（superuser、ADMIN_ALL、DOCUMENT_ADMIN、DOCUMENT_VIEW_ALL，
    或在發文機關下持有 document:admin）。"""
    if user.is_superuser:
        return True
    global_codes = await get_user_permission_codes(session, user.id)
    if {
        str(PermissionCode.ADMIN_ALL),
        str(PermissionCode.DOCUMENT_ADMIN),
        str(PermissionCode.DOCUMENT_VIEW_ALL),
    } & set(global_codes):
        return True
    org_codes = await get_user_permission_codes_for_org(session, user.id, doc.org_id)
    return str(PermissionCode.DOCUMENT_ADMIN) in org_codes


@router.get(
    "/{doc_id}/print",
    response_class=Response,
    summary="下載公文 PDF（管理員可指定受文者版本）",
    responses={
        200: {"description": "PDF 公文檔案"},
        403: {"description": "無查看權限或非管理員不得指定受文者"},
        404: {"description": "公文不存在或受文者不存在"},
    },
)
async def print_document(
    doc_id: str,
    session: DbDep,
    current_user: CurrentUser,
    recipient_id: uuid.UUID | None = Query(
        None,
        description="管理員指定列印某筆受文者的版本；一般使用者不可使用",
    ),
    variant: RecipientDownloadVariant | None = Query(
        None,
        description="管理員強制指定下載正本或影本；一般使用者不可使用",
    ),
) -> Response:
    """直接產生並下載中華民國公文格式 PDF。

    一般使用者：依其身份自動判定下「正本」或「影本」。
    管理員：可額外指定 recipient_id 或 variant 任意挑一份印。
    """
    from api.services.official_print import render_document_print_html, render_print_pdf

    doc = await _get_doc_or_404(doc_id, session)
    await _assert_access(session, doc, current_user)

    is_admin = await _is_document_admin(session, doc, current_user)
    if (recipient_id or variant) and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="僅公文管理員可指定受文者或版本",
        )

    addressed_recipient_name: str | None = None
    if recipient_id is not None:
        target = await doc_svc.get_recipient_for_admin(session, doc, recipient_id)
        if target is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="受文者不存在")
        addressed_recipient_name = target.name
        if variant is None:
            variant = (
                RecipientDownloadVariant.PRIMARY
                if doc_svc.is_primary_variant(target)
                else RecipientDownloadVariant.COPY
            )

    if variant is not None:
        copy_mark = "正本" if variant == RecipientDownloadVariant.PRIMARY else "影本"
    else:
        # 一般使用者：依身份判定
        if is_admin:
            copy_mark = "正本"
        else:
            matched = await doc_svc.resolve_recipient_match(session, doc, current_user.id)
            if matched is not None and doc_svc.is_primary_variant(matched):
                copy_mark = "正本"
                addressed_recipient_name = matched.name
            else:
                copy_mark = "影本"

    html_content = await render_document_print_html(
        session,
        doc,
        current_user,
        copy_mark_override=copy_mark,
        addressed_recipient_name=addressed_recipient_name,
    )
    pdf_bytes = await run_in_threadpool(render_print_pdf, html_content)
    filename_base = doc.serial_number or doc.title or "document"
    suffix = f"_{copy_mark}"
    if addressed_recipient_name:
        suffix += f"_{addressed_recipient_name}"
    filename = (
        f"{filename_base.replace('/', '_').replace(chr(92), '_')}"
        f"{suffix.replace('/', '_').replace(chr(92), '_')}.pdf"
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


# 維持 api.routers.documents 的公開匯入介面。
from api.routers.documents_approve import (  # noqa: E402, F401
    approve_document,
    archive_document,
    batch_approve_documents,
    batch_archive_documents,
    batch_delegate_documents,
    batch_reject_documents,
    create_document_delegation,
    delete_document_delegation,
    issue_document_directly,
    list_document_delegations,
    recall_document,
    reject_document,
    set_step_delegate,
    submit_document,
    update_document_delegation,
)
from api.routers.documents_attachments import (  # noqa: E402, F401
    add_link_attachment,
    delete_attachment,
    download_attachment,
    list_attachments,
    preview_attachment,
    rename_attachment,
    upload_attachment,
)
from api.routers.documents_serial import (  # noqa: E402, F401
    create_document_from_template,
    create_document_template,
    create_serial_template,
    deactivate_document_template,
    deactivate_serial_template,
    get_document_template,
    get_serial_template,
    list_document_templates,
    list_serial_templates,
    serial_router,
    template_router,
    update_document_template,
    update_serial_template,
)
