"""財務 報帳與付款 API。"""

from __future__ import annotations

import asyncio
import mimetypes
import uuid
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select

from api.core.permission_codes import PermissionCode
from api.models.finance import (
    ExpenseClaimItem,
    ExpenseClaimItemEvidence,
    ExpensePaymentStatus,
    JournalEntry,
    JournalStatus,
)
from api.routers.finance_common import (
    CurrentUser as CurrentUser,
)
from api.routers.finance_common import (
    DbDep as DbDep,
)
from api.routers.finance_common import (
    _assert_ledger_permission as _assert_ledger_permission,
)
from api.routers.finance_common import (
    _inline_evidence_headers as _inline_evidence_headers,
)
from api.routers.finance_common import (
    _journal_out as _journal_out,
)
from api.routers.finance_common import (
    require_budget_permission as require_budget_permission,
)
from api.routers.finance_common import (
    require_journal_permission as require_journal_permission,
)
from api.routers.finance_common import (
    require_ledger_permission as require_ledger_permission,
)
from api.schemas.finance import (
    BudgetAdvanceReceiptCreate,
    ExpenseBudgetUpdate,
    ExpenseClaimCreate,
    ExpenseProcurementUpdate,
    ExpenseReimbursementCreate,
    ExpenseReturnCreate,
    FinanceEvidenceUploadOut,
    FinanceExpenseClaimItemOut,
    JournalOut,
)
from api.services import audit as audit_svc
from api.services import finance as service
from api.services import finance_documents
from api.services.file_delivery import deliver_stored_file
from api.services.storage import get_storage

router = APIRouter()


@router.post(
    "/ledgers/{ledger_id}/evidence",
    response_model=FinanceEvidenceUploadOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[
        Depends(
            require_ledger_permission(
                PermissionCode.FINANCE_EXPENSE_CLAIM,
                PermissionCode.FINANCE_RECORD,
                PermissionCode.FINANCE_BUDGET_PROPOSE,
                PermissionCode.FINANCE_BUDGET,
            )
        )
    ],
)
async def upload_evidence(
    ledger_id: uuid.UUID, file: UploadFile = File(...)
) -> FinanceEvidenceUploadOut:
    if Path(file.filename or "").suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp", ".pdf"}:
        raise HTTPException(422, "憑證僅支援 JPG、PNG、WebP 圖片或 PDF")
    try:
        stored = await get_storage().save(file, prefix=f"finance/evidence/{ledger_id}")
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return FinanceEvidenceUploadOut(
        storage_key=stored.storage_key,
        filename=stored.filename,
        content_type=stored.content_type,
        file_size=stored.file_size,
    )


@router.post(
    "/ledgers/{ledger_id}/expense-claims",
    response_model=JournalOut,
    status_code=201,
    dependencies=[
        Depends(
            require_ledger_permission(
                PermissionCode.FINANCE_EXPENSE_CLAIM, PermissionCode.FINANCE_RECORD
            )
        )
    ],
)
async def create_expense_claim(
    ledger_id: uuid.UUID, body: ExpenseClaimCreate, db: DbDep, user: CurrentUser
) -> JournalOut:
    entry = await service.create_expense_claim(db, ledger_id, body, user.id)
    await db.commit()
    return _journal_out(await service.journal_with_lines(db, entry))


@router.patch(
    "/journals/{entry_id}/expense-claim",
    response_model=JournalOut,
    dependencies=[
        Depends(
            require_journal_permission(
                PermissionCode.FINANCE_EXPENSE_CLAIM, PermissionCode.FINANCE_RECORD
            )
        )
    ],
)
async def update_expense_claim(
    entry_id: uuid.UUID, body: ExpenseClaimCreate, db: DbDep, user: CurrentUser
) -> JournalOut:
    entry = await db.get(JournalEntry, entry_id)
    if not entry:
        raise HTTPException(404, "傳票不存在")
    budgeted_reimbursement_edit = (
        entry.status == JournalStatus.POSTED
        and entry.claim_status == "approved"
        and entry.budget_included is True
        and entry.payment_status in (None, ExpensePaymentStatus.UNPAID)
    )
    await service.update_expense_claim(db, entry, body, user.id)
    await audit_svc.record(
        db,
        entity_type="finance_journal",
        entity_id=str(entry.id),
        action=(
            "finance.expense_reimbursement_update"
            if budgeted_reimbursement_edit
            else "finance.expense_update"
        ),
        actor_id=str(user.id),
        actor_email=user.email,
        summary=(
            f"核銷階段修改報帳金額：{entry.description}"
            if budgeted_reimbursement_edit
            else f"修改報帳：{entry.description}"
        ),
    )
    await db.commit()
    return _journal_out(await service.journal_with_lines(db, entry))


@router.post(
    "/journals/{entry_id}/return",
    response_model=JournalOut,
    dependencies=[Depends(require_journal_permission(PermissionCode.FINANCE_REVIEW))],
)
async def return_expense_claim(
    entry_id: uuid.UUID, body: ExpenseReturnCreate, db: DbDep, user: CurrentUser
) -> JournalOut:
    entry = await db.get(JournalEntry, entry_id)
    if not entry:
        raise HTTPException(404, "傳票不存在")
    await service.return_expense_claim(db, entry, user.id, body.note)
    await audit_svc.record(
        db,
        entity_type="finance_journal",
        entity_id=str(entry.id),
        action="finance.expense_return",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"退回報帳：{entry.description}",
    )
    await db.commit()
    return _journal_out(await service.journal_with_lines(db, entry))


@router.patch(
    "/journals/{entry_id}/procurement",
    response_model=JournalOut,
    dependencies=[Depends(require_journal_permission(PermissionCode.FINANCE_PROCUREMENT))],
)
async def update_expense_procurement(
    entry_id: uuid.UUID, body: ExpenseProcurementUpdate, db: DbDep, user: CurrentUser
) -> JournalOut:
    entry = await db.get(JournalEntry, entry_id)
    if not entry:
        raise HTTPException(404, "傳票不存在")
    await service.update_expense_procurement(db, entry, body, user.id)
    await audit_svc.record(
        db,
        entity_type="finance_journal",
        entity_id=str(entry.id),
        action="finance.expense_procurement",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"更新校商請購：{entry.description}／{body.status}",
    )
    await db.commit()
    return _journal_out(await service.journal_with_lines(db, entry))


@router.post(
    "/journals/{entry_id}/school-payment",
    response_model=JournalOut,
    dependencies=[Depends(require_journal_permission(PermissionCode.FINANCE_SCHOOL_PAYMENT))],
)
async def mark_school_payment(entry_id: uuid.UUID, db: DbDep, user: CurrentUser) -> JournalOut:
    entry = await db.get(JournalEntry, entry_id)
    if not entry:
        raise HTTPException(404, "傳票不存在")
    await service.mark_expense_paid(db, entry, ExpensePaymentStatus.SCHOOL_PAID, user.id)
    await audit_svc.record(
        db,
        entity_type="finance_journal",
        entity_id=str(entry.id),
        action="finance.school_payment",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"登錄校方付款：{entry.description}",
    )
    await db.commit()
    return _journal_out(await service.journal_with_lines(db, entry))


@router.post(
    "/journals/{entry_id}/dues-payment",
    response_model=JournalOut,
    dependencies=[Depends(require_journal_permission(PermissionCode.FINANCE_DUES_PAYMENT))],
)
async def mark_dues_payment(entry_id: uuid.UUID, db: DbDep, user: CurrentUser) -> JournalOut:
    entry = await db.get(JournalEntry, entry_id)
    if not entry:
        raise HTTPException(404, "傳票不存在")
    await service.mark_expense_paid(db, entry, ExpensePaymentStatus.DUES_PAID, user.id)
    await audit_svc.record(
        db,
        entity_type="finance_journal",
        entity_id=str(entry.id),
        action="finance.dues_payment",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"登錄會費付款：{entry.description}",
    )
    await db.commit()
    return _journal_out(await service.journal_with_lines(db, entry))


@router.post(
    "/journals/{entry_id}/reimburse-advance",
    response_model=JournalOut,
    dependencies=[
        Depends(
            require_journal_permission(
                PermissionCode.FINANCE_SCHOOL_PAYMENT, PermissionCode.FINANCE_DUES_PAYMENT
            )
        )
    ],
)
async def reimburse_advance(
    entry_id: uuid.UUID, body: ExpenseReimbursementCreate, db: DbDep, user: CurrentUser
) -> JournalOut:
    entry = await db.get(JournalEntry, entry_id)
    if not entry:
        raise HTTPException(404, "傳票不存在")
    await service.reimburse_expense_claim(db, entry, body, user.id)
    await audit_svc.record(
        db,
        entity_type="finance_journal",
        entity_id=str(entry.id),
        action="finance.advance_reimbursement",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"完成代墊償還：{entry.description}",
    )
    await db.commit()
    return _journal_out(await service.journal_with_lines(db, entry))


@router.patch(
    "/journals/{entry_id}/budget",
    response_model=JournalOut,
    dependencies=[Depends(require_journal_permission(PermissionCode.FINANCE_BUDGET))],
)
async def update_expense_budget(
    entry_id: uuid.UUID, body: ExpenseBudgetUpdate, db: DbDep, user: CurrentUser
) -> JournalOut:
    entry = await db.get(JournalEntry, entry_id)
    if not entry:
        raise HTTPException(404, "傳票不存在")
    await service.update_expense_budget(db, entry, body, user.id)
    await audit_svc.record(
        db,
        entity_type="finance_journal",
        entity_id=str(entry.id),
        action="finance.budget",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"更新預算列管：{entry.description}／{body.included}",
    )
    await db.commit()
    return _journal_out(await service.journal_with_lines(db, entry))


@router.post(
    "/journals/{entry_id}/complete",
    response_model=JournalOut,
    dependencies=[
        Depends(
            require_journal_permission(
                PermissionCode.FINANCE_EXPENSE_CLAIM, PermissionCode.FINANCE_REVIEW
            )
        )
    ],
)
async def complete_expense_claim(entry_id: uuid.UUID, db: DbDep, user: CurrentUser) -> JournalOut:
    entry = await db.get(JournalEntry, entry_id)
    if not entry:
        raise HTTPException(404, "傳票不存在")
    await service.complete_expense_claim(db, entry)
    await audit_svc.record(
        db,
        entity_type="finance_journal",
        entity_id=str(entry.id),
        action="finance.expense_complete",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"完成核銷：{entry.description}",
    )
    await db.commit()
    return _journal_out(await service.journal_with_lines(db, entry))


@router.get(
    "/journals/{entry_id}/evidence",
    dependencies=[Depends(require_journal_permission(PermissionCode.FINANCE_VIEW))],
)
async def download_evidence(entry_id: uuid.UUID, db: DbDep, _: CurrentUser):
    entry = await db.get(JournalEntry, entry_id)
    if not entry or not entry.evidence_url:
        raise HTTPException(404, "憑證不存在")
    service.validate_evidence_key(entry.evidence_url, entry.ledger_id)
    return await deliver_stored_file(
        get_storage(),
        entry.evidence_url,
        filename=entry.evidence_url.rsplit("/", 1)[-1],
        content_type=mimetypes.guess_type(entry.evidence_url)[0] or "application/octet-stream",
        disposition="inline",
        headers=_inline_evidence_headers("private, no-store"),
        missing_detail="憑證檔案不存在",
    )


@router.get(
    "/journals/{entry_id}/claim-items",
    response_model=list[FinanceExpenseClaimItemOut],
    dependencies=[Depends(require_journal_permission(PermissionCode.FINANCE_VIEW))],
)
async def list_claim_items(entry_id: uuid.UUID, db: DbDep, _: CurrentUser) -> list[dict]:
    items = list(
        (
            await db.execute(
                select(ExpenseClaimItem).where(ExpenseClaimItem.journal_entry_id == entry_id)
            )
        ).scalars()
    )
    evidence_rows = (
        list(
            (
                await db.execute(
                    select(ExpenseClaimItemEvidence).where(
                        ExpenseClaimItemEvidence.item_id.in_([item.id for item in items])
                    )
                )
            ).scalars()
        )
        if items
        else []
    )
    by_item: dict[uuid.UUID, list[ExpenseClaimItemEvidence]] = {}
    for evidence in evidence_rows:
        by_item.setdefault(evidence.item_id, []).append(evidence)
    return [
        {
            "id": item.id,
            "name": item.name,
            "unit_price": item.unit_price,
            "tax_rate": item.tax_rate,
            "quantity": item.quantity,
            "unit": item.unit,
            "budget_node_id": item.budget_node_id,
            "budget_exception_note": item.budget_exception_note,
            "evidence": [
                {
                    "id": evidence.id,
                    "storage_key": evidence.storage_key,
                    "filename": evidence.filename,
                    "content_type": evidence.content_type,
                    "file_size": evidence.file_size,
                    "evidence_type": evidence.evidence_type,
                    "note": evidence.note,
                    "url": f"/finance/expense-evidence/{evidence.id}",
                }
                for evidence in by_item.get(item.id, [])
            ],
        }
        for item in items
    ]


@router.post(
    "/budgets/{budget_id}/advance-receipt.docx",
    response_class=Response,
    responses={
        200: {
            "content": {
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
                    "schema": {"type": "string", "format": "binary"}
                }
            }
        }
    },
    dependencies=[Depends(require_budget_permission(PermissionCode.FINANCE_VIEW))],
)
async def export_advance_receipt(
    budget_id: uuid.UUID, body: BudgetAdvanceReceiptCreate, db: DbDep, _: CurrentUser
) -> Response:
    budget = await service.get_budget(db, budget_id)
    selected = await service.budget_advance_receipt_expenses(db, budget.id, body.expense_ids)
    content = await asyncio.to_thread(finance_documents.advance_receipt, budget.name, selected)
    return Response(
        content,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": "attachment; filename*=UTF-8''" + quote("預先代墊簽收單.docx"),
            "Cache-Control": "no-store",
        },
    )


@router.get("/expense-evidence/{evidence_id}")
async def download_item_evidence(evidence_id: uuid.UUID, db: DbDep, user: CurrentUser):
    evidence = await db.get(ExpenseClaimItemEvidence, evidence_id)
    if not evidence:
        raise HTTPException(404, "憑證不存在")
    item = await db.get(ExpenseClaimItem, evidence.item_id)
    if not item:
        raise HTTPException(404, "報帳品項不存在")
    entry = await db.get(JournalEntry, item.journal_entry_id)
    if not entry:
        raise HTTPException(404, "報帳不存在")
    if entry.created_by_id != user.id and entry.advanced_by_id != user.id:
        ledger = await service.get_ledger(db, entry.ledger_id)
        await _assert_ledger_permission(
            db,
            user,
            ledger,
            PermissionCode.FINANCE_EXPENSE_CLAIM,
            PermissionCode.FINANCE_REVIEW,
            PermissionCode.FINANCE_SCHOOL_PAYMENT,
            PermissionCode.FINANCE_DUES_PAYMENT,
            PermissionCode.FINANCE_BUDGET,
        )
    service.validate_evidence_key(evidence.storage_key, entry.ledger_id)
    return await deliver_stored_file(
        get_storage(),
        evidence.storage_key,
        filename=evidence.filename,
        content_type=evidence.content_type or mimetypes.guess_type(evidence.filename)[0],
        disposition="inline",
        headers=_inline_evidence_headers("private, no-store"),
        missing_detail="憑證檔案不存在",
    )
