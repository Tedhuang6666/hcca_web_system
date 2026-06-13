"""公文 workflow 端點 — 送審 / 簽核 / 退件 / 撤回 / 封存 / 直接發文 / 代理授權 / 批次。

從 [routers/documents.py](apps/api/src/api/routers/documents.py) 提取。URL 前綴
與主 router 一致 (`/documents`)，由
[api/__init__.py](apps/api/src/api/__init__.py) 同步掛載。共用
[documents_helpers.py](apps/api/src/api/routers/documents_helpers.py)。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Query,
    Response,
    status,
)
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.core.posthog import get_posthog_client
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.models.document import Document, DocumentStatus
from api.models.user import User
from api.routers.documents_helpers import (
    batch_out,
    batch_result,
    can_manage_delegation_for_org,
    get_doc_or_404,
    unique_doc_ids,
    ws_broadcast_bg,
)
from api.routers.notifications import create_notification
from api.schemas.document import (
    ApproveRequest,
    BatchApproveRequest,
    BatchArchiveRequest,
    BatchDelegateRequest,
    BatchDocumentOperationOut,
    BatchDocumentResult,
    BatchRejectRequest,
    DocumentApprovalDelegationCreate,
    DocumentApprovalDelegationOut,
    DocumentApprovalDelegationUpdate,
    DocumentOut,
    RecallRequest,
    RejectMode,
    RejectRequest,
    SubmitRequest,
)
from api.services import activity as activity_svc
from api.services import audit as audit_svc
from api.services import document as doc_svc
from api.services.discord_bot import emit_public_document_notice
from api.services.permission import get_user_permission_codes_for_org, user_is_org_leader

router = APIRouter(prefix="/documents", tags=["公文系統"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


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
    for doc_id in unique_doc_ids(payload.document_ids):
        doc = await doc_svc.get_document(session, doc_id)
        if doc is None:
            results.append(batch_result(doc_id, ok=False, detail="找不到此公文"))
            continue
        if doc.status != DocumentStatus.PENDING:
            results.append(
                batch_result(doc_id, ok=False, doc=doc, detail="只有待審核公文可以批量核准")
            )
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
                meta={
                    "step": updated.current_step,
                    "final": updated.status == DocumentStatus.APPROVED,
                },
                summary=f"批量核准公文「{updated.title}」",
            )
            if updated.status == DocumentStatus.APPROVED:
                await emit_public_document_notice(session, updated)
            bg.add_task(ws_broadcast_bg, updated)
            results.append(batch_result(doc_id, ok=True, doc=updated))
        except (PermissionError, ValueError) as exc:
            results.append(batch_result(doc_id, ok=False, doc=doc, detail=str(exc)))
    return batch_out(results)


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
    for doc_id in unique_doc_ids(payload.document_ids):
        doc = await doc_svc.get_document(session, doc_id)
        if doc is None:
            results.append(batch_result(doc_id, ok=False, detail="找不到此公文"))
            continue
        if doc.status != DocumentStatus.PENDING:
            results.append(
                batch_result(doc_id, ok=False, doc=doc, detail="只有待審核公文可以批量退件")
            )
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
            bg.add_task(ws_broadcast_bg, updated)
            results.append(batch_result(doc_id, ok=True, doc=updated))
        except (PermissionError, ValueError) as exc:
            results.append(batch_result(doc_id, ok=False, doc=doc, detail=str(exc)))
    return batch_out(results)


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
    for doc_id in unique_doc_ids(payload.document_ids):
        doc = await doc_svc.get_document(session, doc_id)
        if doc is None:
            results.append(batch_result(doc_id, ok=False, detail="找不到此公文"))
            continue
        if doc.created_by != current_user.id and not current_user.is_superuser:
            results.append(batch_result(doc_id, ok=False, doc=doc, detail="只有建立者可以封存公文"))
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
            bg.add_task(ws_broadcast_bg, updated)
            results.append(batch_result(doc_id, ok=True, doc=updated))
        except ValueError as exc:
            results.append(batch_result(doc_id, ok=False, doc=doc, detail=str(exc)))
    return batch_out(results)


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
    for doc_id in unique_doc_ids(payload.document_ids):
        doc = await doc_svc.get_document(session, doc_id)
        if doc is None:
            results.append(batch_result(doc_id, ok=False, detail="找不到此公文"))
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
            results.append(batch_result(doc_id, ok=True, doc=doc))
        except (PermissionError, ValueError) as exc:
            results.append(batch_result(doc_id, ok=False, doc=doc, detail=str(exc)))
    return batch_out(results)


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
    current_user: CurrentUser,
    bg: BackgroundTasks,
) -> Document:
    """送審後自動以 BackgroundTasks 通知第一位審核人（Email + WebSocket）"""
    doc = await get_doc_or_404(doc_id, session)
    if not current_user.is_superuser:
        codes = await get_user_permission_codes_for_org(session, current_user.id, doc.org_id)
        is_activity_manager = await activity_svc.can_manage_activity_resource(
            session, current_user, doc.activity_id
        )
        is_org_leader = await user_is_org_leader(session, current_user.id, doc.org_id)
        if not (
            (doc.created_by == current_user.id and "document:submit" in codes)
            or is_org_leader
            or "document:admin" in codes
            or is_activity_manager
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="只有部門最高權限者、建立者 + document:submit、document:admin 或活動總召可以送審",
            )
    try:
        updated = await doc_svc.submit_document(session, doc, approver_ids=payload.approver_ids)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e

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
    _ph = get_posthog_client()
    if _ph:
        _ph.capture(
            distinct_id=str(current_user.id),
            event="document_submitted_for_approval",
            properties={"approver_count": len(updated.approvals)},
        )

    bg.add_task(ws_broadcast_bg, updated)
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
    doc = await get_doc_or_404(doc_id, session)
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
        await create_notification(
            session,
            user_id=updated.created_by,
            type="document_approved",
            title=f"公文已核准：{updated.title}",
            body=f"字號：{updated.serial_number}",
            link=f"/documents/{updated.id}",
            related_id=updated.id,
        )
        await emit_public_document_notice(session, updated)
    else:
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

    _ph = get_posthog_client()
    if _ph and updated.status == DocumentStatus.APPROVED:
        _ph.capture(
            distinct_id=str(current_user.id),
            event="document_approved",
            properties={"total_steps": updated.current_step},
        )

    bg.add_task(ws_broadcast_bg, updated)
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
    doc = await get_doc_or_404(doc_id, session)
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
    bg.add_task(ws_broadcast_bg, updated)
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
    doc = await get_doc_or_404(doc_id, session)
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


# ── 簽核代理授權 (management/delegations) ─────────────────────────────────────


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
        org_id is None or not await can_manage_delegation_for_org(session, current_user, org_id)
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
    if delegation.principal_user_id != current_user.id and not await can_manage_delegation_for_org(
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
    if delegation.principal_user_id != current_user.id and not await can_manage_delegation_for_org(
        session, current_user, delegation.org_id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="您無權停用此代理授權")
    await doc_svc.deactivate_approval_delegation(session, delegation)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── 撤回 / 封存 / 直接發文 ──────────────────────────────────────────────────


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
    doc = await get_doc_or_404(doc_id, session)
    try:
        updated = await doc_svc.recall_document(session, doc, requested_by=current_user.id)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e

    bg.add_task(ws_broadcast_bg, updated)
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
    doc = await get_doc_or_404(doc_id, session)
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
    bg.add_task(ws_broadcast_bg, updated)
    return updated


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
    doc = await get_doc_or_404(doc_id, session)
    if doc.created_by != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有建立者可直接發文")
    try:
        updated = await doc_svc.issue_document_directly(
            session, doc, issued_by=current_user.id, comment=payload.comment
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e

    loaded = await doc_svc.get_document(session, updated.id)
    assert loaded is not None  # nosec B101

    await create_notification(
        session,
        user_id=loaded.created_by,
        type="document_approved",
        title=f"公文已直接發文：{loaded.title}",
        body=f"字號：{loaded.serial_number}",
        link=f"/documents/{loaded.id}",
        related_id=loaded.id,
    )
    await emit_public_document_notice(session, loaded)
    bg.add_task(ws_broadcast_bg, loaded)
    return loaded
