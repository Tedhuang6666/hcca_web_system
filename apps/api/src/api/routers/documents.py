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
from typing import Annotated

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
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.ws_manager import manager as ws_manager
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.models.document import (
    Document,
    DocumentAttachment,
    DocumentCategory,
    DocumentStatus,
)
from api.models.user import User
from api.schemas.document import (
    ApproveRequest,
    AttachmentOut,
    DocumentCreate,
    DocumentListItem,
    DocumentOut,
    DocumentUpdate,
    RecallRequest,
    RecipientCreate,
    RejectMode,
    RejectRequest,
    SerialTemplateCreate,
    SerialTemplateOut,
    SubmitRequest,
)
from api.services import document as doc_svc
from api.services.mail import enqueue_email
from api.services.storage import get_storage

router = APIRouter(prefix="/documents", tags=["公文系統"])
serial_router = APIRouter(prefix="/document-serial-templates", tags=["字號模板（doc.issue）"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


# ── 輔助：取得公文或 404 ──────────────────────────────────────────────────────

async def _get_doc_or_404(doc_id: uuid.UUID, session: DbDep) -> Document:
    doc = await doc_svc.get_document(session, doc_id)
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
    current_user: Annotated[User, Depends(require_permission("document:create"))],
) -> Document:
    """
    建立草稿公文並生成字號。支援速別、密等、主旨、說明、辦法、承辦人、受文者等完整公文格式欄位。
    """
    return await doc_svc.create_document(session, data=payload, created_by=current_user.id)


@router.get(
    "",
    response_model=list[DocumentListItem],
    summary="列出公文（支援全文搜尋與組織過濾）",
)
async def list_documents(
    session: DbDep,
    current_user: CurrentUser,
    org_id: uuid.UUID | None = Query(None, description="過濾組織（不填則依使用者所在組織）"),
    status_filter: DocumentStatus | None = Query(None, alias="status", description="過濾狀態"),
    category: DocumentCategory | None = Query(None, description="過濾公文類別"),
    keyword: str | None = Query(None, max_length=100, description="關鍵字（搜尋標題、主旨、說明）"),
    my_only: bool = Query(False, description="僅顯示我建立的公文"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> list[Document]:
    return await doc_svc.list_documents(
        session,
        org_id=org_id,
        status=status_filter,
        category=category,
        keyword=keyword,
        created_by=current_user.id if my_only else None,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{doc_id}",
    response_model=DocumentOut,
    summary="取得公文詳細（含版本、審核步驟、附件、受文者）",
    responses={
        200: {"description": "公文詳細資料"},
        403: {"description": "無查看權限"},
        404: {"description": "公文不存在"},
    },
)
async def get_document(doc_id: uuid.UUID, session: DbDep, current_user: CurrentUser) -> Document:
    doc = await _get_doc_or_404(doc_id, session)
    await _assert_access(session, doc, current_user)
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
    doc_id: uuid.UUID,
    payload: DocumentUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> Document:
    doc = await _get_doc_or_404(doc_id, session)
    if doc.created_by != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有建立者可以編輯")
    try:
        return await doc_svc.update_document(session, doc, data=payload, changed_by=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


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
    doc_id: uuid.UUID,
    payload: SubmitRequest,
    session: DbDep,
    current_user: CurrentUser,
    bg: BackgroundTasks,
) -> Document:
    """送審後自動以 BackgroundTasks 通知第一位審核人（Email + WebSocket）"""
    doc = await _get_doc_or_404(doc_id, session)
    if doc.created_by != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有建立者可以送審")
    try:
        updated = await doc_svc.submit_document(session, doc, approver_ids=payload.approver_ids)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e

    # 通知第一位審核人
    if updated.approvals:
        first_approval = updated.approvals[0]
        approver = first_approval.approver
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
    doc_id: uuid.UUID,
    payload: ApproveRequest,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission("document:approve"))],
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

    if updated.status == DocumentStatus.APPROVED:
        # 最後一關通過：通知建立者
        bg.add_task(_notify_creator_bg, updated.creator.email, updated.creator.display_name, updated, "核准")
    else:
        # 推進下一關：通知下一位審核人
        next_step = next((a for a in updated.approvals if a.step_order == updated.current_step), None)
        if next_step:
            bg.add_task(_notify_approver_bg, next_step.approver.email, next_step.approver.display_name, updated)
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
    doc_id: uuid.UUID,
    payload: RejectRequest,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission("document:approve"))],
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

    # 通知建立者（退回至承辦人）或通知上一關審核人（退回上一關）
    if payload.mode == RejectMode.TO_CREATOR:
        bg.add_task(_notify_creator_bg, updated.creator.email, updated.creator.display_name, updated, "退件")
    else:
        prev_step = next((a for a in updated.approvals if a.step_order == updated.current_step), None)
        if prev_step:
            bg.add_task(_notify_approver_bg, prev_step.approver.email, prev_step.approver.display_name, updated)
    bg.add_task(_ws_broadcast_bg, updated)
    return updated


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
    doc_id: uuid.UUID,
    _payload: RecallRequest,
    session: DbDep,
    current_user: CurrentUser,
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
    doc_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
    bg: BackgroundTasks,
) -> Document:
    doc = await _get_doc_or_404(doc_id, session)
    if doc.created_by != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有建立者可以封存公文")
    try:
        updated = await doc_svc.archive_document(session, doc, requested_by=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e

    bg.add_task(_ws_broadcast_bg, updated)
    return updated


# ── 附件管理 ──────────────────────────────────────────────────────────────────

@router.get(
    "/{doc_id}/attachments",
    response_model=list[AttachmentOut],
    summary="列出附件",
)
async def list_attachments(
    doc_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> list[DocumentAttachment]:
    doc = await _get_doc_or_404(doc_id, session)
    await _assert_access(session, doc, current_user)
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
    doc_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
    file: UploadFile = File(..., description="附件檔案（PDF / 圖片 / Office 文件 / ZIP）"),
) -> DocumentAttachment:
    doc = await _get_doc_or_404(doc_id, session)
    await _assert_access(session, doc, current_user)

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
    doc_id: uuid.UUID,
    att_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> None:
    result = await session.execute(
        select(DocumentAttachment).where(
            DocumentAttachment.id == att_id,
            DocumentAttachment.document_id == doc_id,
        )
    )
    att = result.scalar_one_or_none()
    if att is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此附件")
    if att.uploaded_by != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有上傳者可以刪除")

    storage = get_storage()
    await storage.delete(att.storage_key)
    await session.delete(att)


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
    doc_id: uuid.UUID,
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
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有建立者可以修改受文者")
    try:
        await doc_svc.upsert_recipients(session, doc, recipients=recipients)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e

    # 重新載入公文（含新受文者）
    return await doc_svc.get_document(session, doc.id)  # type: ignore[return-value]


# ── 字號模板管理（需 doc.issue 權限）────────────────────────────────────────────

@serial_router.post(
    "",
    response_model=SerialTemplateOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立字號模板（需 doc.issue 權限）",
    responses={
        201: {"description": "字號模板建立成功，字號格式如：嶺代生字第 1150000001 號"},
        403: {"description": "需要 doc.issue 權限（僅限機關最高長官）"},
        409: {"description": "相同 org_prefix + category_char 組合已存在"},
    },
)
async def create_serial_template(
    payload: SerialTemplateCreate,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission("doc.issue"))],
) -> object:
    """
    由擁有 `doc.issue` 權限的機關長官建立字號模板。
    一個 org_prefix + category_char 組合只能建立一個模板（UniqueConstraint）。
    建立後，同組織成員可選擇此模板發文。
    """
    from sqlalchemy.exc import IntegrityError
    try:
        template = await doc_svc.create_serial_template(
            session, data=payload, created_by=current_user.id
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
    summary="停用字號模板（需 doc.issue 權限）",
    responses={
        204: {"description": "停用成功"},
        403: {"description": "需要 doc.issue 權限"},
        404: {"description": "模板不存在"},
    },
)
async def deactivate_serial_template(
    template_id: uuid.UUID,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission("doc.issue"))],
) -> None:
    """停用字號模板（is_active=False），停用後的模板不可再用於發文。"""
    template = await doc_svc.get_serial_template(session, template_id)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此字號模板")
    # 建立者或同組織的 doc.issue 持有者可操作
    if template.created_by != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有字號模板建立者可以停用此模板",
        )
    await doc_svc.deactivate_serial_template(session, template)
