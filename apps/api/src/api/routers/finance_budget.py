"""財務 預算 API。"""

from __future__ import annotations

import asyncio
import uuid
from datetime import date
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from api.core.permission_codes import PermissionCode
from api.models.finance import (
    BudgetSubmissionStatus,
    FinanceBudgetAllocation,
    FinanceBudgetAllocationEvidence,
    FinanceBudgetExpense,
    FinanceBudgetExpenseEvidence,
    FinanceBudgetSubmission,
)
from api.routers.finance_common import (
    MAX_BUDGET_IMPORT_BYTES as MAX_BUDGET_IMPORT_BYTES,
)
from api.routers.finance_common import (
    CurrentUser as CurrentUser,
)
from api.routers.finance_common import (
    DbDep as DbDep,
)
from api.routers.finance_common import (
    _budget_role_flags as _budget_role_flags,
)
from api.routers.finance_common import (
    _inline_evidence_headers as _inline_evidence_headers,
)
from api.routers.finance_common import (
    require_allocation_permission as require_allocation_permission,
)
from api.routers.finance_common import (
    require_budget_permission as require_budget_permission,
)
from api.routers.finance_common import (
    require_ledger_permission as require_ledger_permission,
)
from api.routers.finance_common import (
    require_submission_permission as require_submission_permission,
)
from api.schemas.finance import (
    BudgetAllocationCreate,
    BudgetAllocationEvidenceCreate,
    BudgetAllocationEvidenceOut,
    BudgetAllocationOut,
    BudgetAllocationUpdate,
    BudgetCouncilReviewPublicationUpdate,
    BudgetCreate,
    BudgetDetailOut,
    BudgetImportOut,
    BudgetIncomeItemOut,
    BudgetIncomeItemUpdate,
    BudgetNodeCreate,
    BudgetNodeOut,
    BudgetOut,
    BudgetPublicationUpdate,
    BudgetReview,
    BudgetSubmissionCreate,
    BudgetSubmissionOut,
    BudgetSubmissionUpdate,
    BudgetUpdate,
    FinanceBudgetExpenseCreate,
    FinanceBudgetExpenseOut,
    FinanceBudgetExpenseUpdate,
)
from api.services import audit as audit_svc
from api.services import finance as service
from api.services import finance_documents
from api.services.file_delivery import deliver_stored_file
from api.services.storage import get_storage

router = APIRouter()


@router.get(
    "/ledgers/{ledger_id}/budgets",
    response_model=list[BudgetOut],
    dependencies=[Depends(require_ledger_permission(PermissionCode.FINANCE_VIEW))],
)
async def list_budgets(ledger_id: uuid.UUID, db: DbDep, _: CurrentUser) -> list[BudgetOut]:
    return [BudgetOut.model_validate(item) for item in await service.list_budgets(db, ledger_id)]


@router.post(
    "/ledgers/{ledger_id}/budgets",
    response_model=BudgetOut,
    status_code=201,
    dependencies=[Depends(require_ledger_permission(PermissionCode.FINANCE_BUDGET))],
)
async def create_budget(
    ledger_id: uuid.UUID, body: BudgetCreate, db: DbDep, _: CurrentUser
) -> BudgetOut:
    budget = await service.create_budget(db, ledger_id, body)
    await db.commit()
    return BudgetOut.model_validate(budget)


@router.post(
    "/ledgers/{ledger_id}/budgets/import",
    response_model=BudgetImportOut,
    status_code=201,
    dependencies=[Depends(require_ledger_permission(PermissionCode.FINANCE_BUDGET))],
)
async def import_budget(
    ledger_id: uuid.UUID,
    db: DbDep,
    user: CurrentUser,
    period_id: uuid.UUID = Form(...),
    council_approved_on: date = Form(...),
    name: str = Form(..., min_length=1, max_length=160),
    title: str | None = Form(None, max_length=160),
    proposing_org_id: uuid.UUID | None = Form(None),
    budget_id: uuid.UUID | None = Form(None),
    replace_submission_id: uuid.UUID | None = Form(None),
    full_snapshot: bool = Form(True),
    file: UploadFile = File(...),
) -> BudgetImportOut:
    if Path(file.filename or "").suffix.lower() != ".xlsx":
        raise HTTPException(422, "預算匯入僅支援 xlsx 檔案")
    file_bytes = await file.read(MAX_BUDGET_IMPORT_BYTES + 1)
    if len(file_bytes) > MAX_BUDGET_IMPORT_BYTES:
        raise HTTPException(413, "預算匯入檔不可超過 10 MB")
    if not file_bytes.startswith(b"PK\x03\x04"):
        raise HTTPException(422, "檔案不是有效的 xlsx 格式")
    try:
        (
            budget,
            submission,
            categories,
            allocations,
            income_items,
            skipped,
        ) = await service.import_budget_from_xlsx(
            db,
            ledger_id,
            period_id,
            name.strip(),
            title.strip() if title else None,
            file_bytes,
            user.id,
            council_approved_on,
            proposing_org_id,
            budget_id,
            replace_submission_id,
            full_snapshot,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    await audit_svc.record(
        db,
        entity_type="finance_budget_submission",
        entity_id=str(submission.id),
        action="finance.budget_import_approve",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=(
            f"匯入並公開已核定預算案：{submission.title}；議會通過日期 "
            f"{council_approved_on.isoformat() if council_approved_on else '未填'}"
        ),
    )
    await db.commit()
    return BudgetImportOut(
        budget=BudgetOut.model_validate(budget),
        submission=BudgetSubmissionOut.model_validate(submission),
        categories_created=categories,
        allocations_created=allocations,
        income_items_created=income_items,
        skipped_rows=skipped,
    )


@router.get(
    "/budgets/{budget_id}",
    response_model=BudgetDetailOut,
    dependencies=[Depends(require_budget_permission(PermissionCode.FINANCE_VIEW))],
)
async def get_budget_detail(budget_id: uuid.UUID, db: DbDep, user: CurrentUser) -> BudgetDetailOut:
    budget = await service.get_budget(db, budget_id)
    detail = await service.budget_detail(db, budget)
    can_manage, can_propose, can_review = await _budget_role_flags(db, user, budget)
    for allocation in detail["allocations"]:
        if not (
            can_manage or can_review or (can_propose and allocation["proposed_by_id"] == user.id)
        ):
            allocation["evidence"] = []
    return BudgetDetailOut.model_validate(detail)


@router.patch(
    "/budgets/{budget_id}",
    response_model=BudgetOut,
    dependencies=[Depends(require_budget_permission(PermissionCode.FINANCE_BUDGET))],
)
async def update_budget_name(
    budget_id: uuid.UUID, body: BudgetUpdate, db: DbDep, user: CurrentUser
) -> BudgetOut:
    existing = await service.get_budget(db, budget_id)
    previous_name = existing.name
    budget = await service.update_budget_name(db, budget_id, body)
    await audit_svc.record(
        db,
        entity_type="finance_budget",
        entity_id=str(budget.id),
        action="finance.budget_update",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={"previous_name": previous_name, "next_name": budget.name},
        summary=f"修改預算名稱：{budget.name}",
    )
    await db.commit()
    return BudgetOut.model_validate(budget)


@router.post(
    "/budgets/{budget_id}/expenses",
    response_model=FinanceBudgetExpenseOut,
    status_code=201,
    dependencies=[
        Depends(
            require_budget_permission(
                PermissionCode.FINANCE_EXPENSE_CLAIM,
                PermissionCode.FINANCE_RECORD,
                PermissionCode.FINANCE_BUDGET,
            )
        )
    ],
)
async def create_budget_expense(
    budget_id: uuid.UUID,
    body: FinanceBudgetExpenseCreate,
    db: DbDep,
    user: CurrentUser,
) -> FinanceBudgetExpenseOut:
    expense = await service.create_budget_expense(db, budget_id, body, user.id)
    await audit_svc.record(
        db,
        entity_type="finance_budget_expense",
        entity_id=str(expense.id),
        action="finance.budget_expense_record",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"登錄預算核銷：{expense.purpose}／NT${expense.total_amount:,}",
    )
    await db.commit()
    detail = await service.budget_detail(db, await service.get_budget(db, budget_id))
    return FinanceBudgetExpenseOut.model_validate(
        next(item for item in detail["expenses"] if item["id"] == expense.id)
    )


@router.patch(
    "/budgets/{budget_id}/expenses/{expense_id}",
    response_model=FinanceBudgetExpenseOut,
    dependencies=[
        Depends(
            require_budget_permission(
                PermissionCode.FINANCE_EXPENSE_CLAIM,
                PermissionCode.FINANCE_RECORD,
                PermissionCode.FINANCE_BUDGET,
            )
        )
    ],
)
async def update_budget_expense(
    budget_id: uuid.UUID,
    expense_id: uuid.UUID,
    body: FinanceBudgetExpenseUpdate,
    db: DbDep,
    user: CurrentUser,
) -> FinanceBudgetExpenseOut:
    existing = await db.get(FinanceBudgetExpense, expense_id)
    if not existing or existing.budget_id != budget_id:
        raise HTTPException(404, "預算支出不存在")
    before_detail = await service.budget_detail(db, await service.get_budget(db, budget_id))
    before_data = next(item for item in before_detail["expenses"] if item["id"] == existing.id)
    previous = FinanceBudgetExpenseOut.model_validate(before_data).model_dump(
        mode="json", exclude={"evidence", "created_at"}
    )
    expense = await service.update_budget_expense(db, budget_id, expense_id, body, user.id)
    after_detail = await service.budget_detail(db, await service.get_budget(db, budget_id))
    after_data = next(item for item in after_detail["expenses"] if item["id"] == expense.id)
    next_snapshot = FinanceBudgetExpenseOut.model_validate(after_data).model_dump(
        mode="json", exclude={"evidence", "created_at"}
    )
    await audit_svc.record(
        db,
        entity_type="finance_budget_expense",
        entity_id=str(expense.id),
        action="finance.budget_expense_update",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={
            "previous": previous,
            "next": next_snapshot,
        },
        summary=(
            f"修改預算支出：{previous['purpose']} NT${previous['total_amount']:,} → "
            f"{expense.purpose} NT${expense.total_amount:,}"
        ),
    )
    await db.commit()
    return FinanceBudgetExpenseOut.model_validate(after_data)


@router.patch(
    "/budgets/{budget_id}/publication",
    response_model=BudgetOut,
    dependencies=[
        Depends(
            require_budget_permission(
                PermissionCode.FINANCE_BUDGET, PermissionCode.FINANCE_BUDGET_REVIEW
            )
        )
    ],
)
async def update_budget_publication(
    budget_id: uuid.UUID, body: BudgetPublicationUpdate, db: DbDep, user: CurrentUser
) -> BudgetOut:
    budget = await service.set_budget_publication(
        db, await service.get_budget(db, budget_id), body.is_public
    )
    await audit_svc.record(
        db,
        entity_type="finance_budget",
        entity_id=str(budget.id),
        action="finance.budget_publication",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"{'開放' if body.is_public else '停止'}議員檢視：{budget.name}",
    )
    await db.commit()
    return BudgetOut.model_validate(budget)


@router.post(
    "/budgets/{budget_id}/submissions",
    response_model=BudgetSubmissionOut,
    status_code=201,
    dependencies=[
        Depends(
            require_budget_permission(
                PermissionCode.FINANCE_BUDGET_PROPOSE, PermissionCode.FINANCE_BUDGET
            )
        )
    ],
)
async def create_budget_submission(
    budget_id: uuid.UUID, body: BudgetSubmissionCreate, db: DbDep, user: CurrentUser
) -> BudgetSubmissionOut:
    submission = await service.create_budget_submission(
        db, await service.get_budget(db, budget_id), body, user.id
    )
    await db.commit()
    return BudgetSubmissionOut.model_validate(submission)


@router.patch(
    "/budget-submissions/{submission_id}",
    response_model=BudgetSubmissionOut,
    dependencies=[
        Depends(
            require_submission_permission(
                PermissionCode.FINANCE_BUDGET_PROPOSE, PermissionCode.FINANCE_BUDGET
            )
        )
    ],
)
async def update_budget_submission(
    submission_id: uuid.UUID,
    body: BudgetSubmissionUpdate,
    db: DbDep,
    user: CurrentUser,
) -> BudgetSubmissionOut:
    submission = await db.get(FinanceBudgetSubmission, submission_id)
    if not submission:
        raise HTTPException(404, "預算案不存在")
    budget = await service.get_budget(db, submission.budget_id)
    can_manage, _, _ = await _budget_role_flags(db, user, budget)
    if not can_manage and submission.created_by_id != user.id:
        raise HTTPException(403, "只能修改自己建立的草案")
    submission = await service.update_budget_submission(db, submission_id, body)
    await db.commit()
    return BudgetSubmissionOut.model_validate(submission)


@router.delete(
    "/budget-submissions/{submission_id}",
    status_code=204,
    dependencies=[
        Depends(
            require_submission_permission(
                PermissionCode.FINANCE_BUDGET_PROPOSE, PermissionCode.FINANCE_BUDGET
            )
        )
    ],
)
async def delete_budget_submission(submission_id: uuid.UUID, db: DbDep, user: CurrentUser) -> None:
    submission = await db.get(FinanceBudgetSubmission, submission_id)
    if not submission:
        raise HTTPException(404, "預算案不存在")
    budget = await service.get_budget(db, submission.budget_id)
    can_manage, _, _ = await _budget_role_flags(db, user, budget)
    if not can_manage and submission.created_by_id != user.id:
        raise HTTPException(403, "只能刪除自己建立的草案")
    title = submission.title
    await service.delete_budget_submission(db, submission_id)
    await audit_svc.record(
        db,
        entity_type="finance_budget_submission",
        entity_id=str(submission_id),
        action="finance.budget_submission_delete",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"刪除預算草案：{title}",
    )
    await db.commit()


@router.post(
    "/budget-submissions/{submission_id}/nodes",
    response_model=BudgetNodeOut,
    status_code=201,
    dependencies=[
        Depends(
            require_submission_permission(
                PermissionCode.FINANCE_BUDGET_PROPOSE, PermissionCode.FINANCE_BUDGET
            )
        )
    ],
)
async def create_budget_node(
    submission_id: uuid.UUID, body: BudgetNodeCreate, db: DbDep, _: CurrentUser
) -> BudgetNodeOut:
    node = await service.create_budget_node(db, submission_id, body)
    await db.commit()
    return BudgetNodeOut.model_validate(node)


@router.post(
    "/budget-submissions/{submission_id}/allocations",
    response_model=BudgetAllocationOut,
    status_code=201,
    dependencies=[
        Depends(
            require_submission_permission(
                PermissionCode.FINANCE_BUDGET_PROPOSE, PermissionCode.FINANCE_BUDGET
            )
        )
    ],
)
async def create_budget_allocation(
    submission_id: uuid.UUID, body: BudgetAllocationCreate, db: DbDep, user: CurrentUser
) -> BudgetAllocationOut:
    allocation = await service.create_budget_allocation(db, submission_id, body, user.id)
    await db.commit()
    return BudgetAllocationOut.model_validate(allocation)


@router.post(
    "/budget-submissions/{submission_id}/submit",
    response_model=BudgetSubmissionOut,
    dependencies=[
        Depends(
            require_submission_permission(
                PermissionCode.FINANCE_BUDGET_PROPOSE, PermissionCode.FINANCE_BUDGET
            )
        )
    ],
)
async def submit_budget_submission(
    submission_id: uuid.UUID, db: DbDep, _: CurrentUser
) -> BudgetSubmissionOut:
    submission = await service.submit_budget_submission(db, submission_id)
    await db.commit()
    return BudgetSubmissionOut.model_validate(submission)


@router.post(
    "/budget-submissions/{submission_id}/review",
    response_model=BudgetSubmissionOut,
    dependencies=[Depends(require_submission_permission(PermissionCode.FINANCE_BUDGET_REVIEW))],
)
async def review_budget_submission(
    submission_id: uuid.UUID, body: BudgetReview, db: DbDep, user: CurrentUser
) -> BudgetSubmissionOut:
    submission = await service.review_budget_submission(db, submission_id, body, user.id)
    await db.commit()
    return BudgetSubmissionOut.model_validate(submission)


@router.patch(
    "/budget-submissions/{submission_id}/council-review-publication",
    response_model=BudgetSubmissionOut,
    dependencies=[
        Depends(
            require_submission_permission(
                PermissionCode.FINANCE_BUDGET, PermissionCode.FINANCE_BUDGET_REVIEW
            )
        )
    ],
)
async def update_council_review_publication(
    submission_id: uuid.UUID,
    body: BudgetCouncilReviewPublicationUpdate,
    db: DbDep,
    user: CurrentUser,
) -> BudgetSubmissionOut:
    submission = await db.get(FinanceBudgetSubmission, submission_id)
    if not submission:
        raise HTTPException(404, "預算案不存在")
    submission = await service.set_submission_council_review_publication(
        db, submission, body.is_public
    )
    await audit_svc.record(
        db,
        entity_type="finance_budget_submission",
        entity_id=str(submission.id),
        action="finance.budget_council_review_publication",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"{'開放' if body.is_public else '停止'}議員審理：{submission.title}",
    )
    await db.commit()
    return BudgetSubmissionOut.model_validate(submission)


@router.patch(
    "/budget-submissions/{submission_id}/allocations/{allocation_id}",
    response_model=BudgetAllocationOut,
    dependencies=[
        Depends(
            require_submission_permission(
                PermissionCode.FINANCE_BUDGET_PROPOSE, PermissionCode.FINANCE_BUDGET
            )
        )
    ],
)
async def update_budget_draft_allocation(
    submission_id: uuid.UUID,
    allocation_id: uuid.UUID,
    body: BudgetAllocationCreate,
    db: DbDep,
    user: CurrentUser,
) -> BudgetAllocationOut:
    existing = await db.get(FinanceBudgetAllocation, allocation_id)
    if not existing or existing.submission_id != submission_id:
        raise HTTPException(404, "預算配置不存在")
    submission = await db.get(FinanceBudgetSubmission, submission_id)
    if not submission:
        raise HTTPException(404, "預算案不存在")
    budget = await service.get_budget(db, submission.budget_id)
    can_manage, _, _ = await _budget_role_flags(db, user, budget)
    if not can_manage and existing.proposed_by_id != user.id:
        raise HTTPException(403, "只能修改自己提出的預算配置")
    allocation = await service.update_budget_draft_allocation(
        db, submission_id, allocation_id, body
    )
    await db.commit()
    return BudgetAllocationOut.model_validate(allocation)


@router.delete(
    "/budget-submissions/{submission_id}/allocations/{allocation_id}",
    status_code=204,
    dependencies=[
        Depends(
            require_submission_permission(
                PermissionCode.FINANCE_BUDGET_PROPOSE, PermissionCode.FINANCE_BUDGET
            )
        )
    ],
)
async def delete_budget_draft_allocation(
    submission_id: uuid.UUID,
    allocation_id: uuid.UUID,
    db: DbDep,
    user: CurrentUser,
) -> None:
    allocation = await db.get(FinanceBudgetAllocation, allocation_id)
    if not allocation or allocation.submission_id != submission_id:
        raise HTTPException(404, "預算配置不存在")
    submission = await db.get(FinanceBudgetSubmission, submission_id)
    if not submission:
        raise HTTPException(404, "預算案不存在")
    budget = await service.get_budget(db, submission.budget_id)
    can_manage, _, _ = await _budget_role_flags(db, user, budget)
    if not can_manage and allocation.proposed_by_id != user.id:
        raise HTTPException(403, "只能刪除自己提出的預算配置")
    await service.delete_budget_draft_allocation(db, submission_id, allocation_id)
    await audit_svc.record(
        db,
        entity_type="finance_budget_allocation",
        entity_id=str(allocation_id),
        action="finance.budget_allocation_delete",
        actor_id=str(user.id),
        actor_email=user.email,
        summary="刪除草案預算明細",
    )
    await db.commit()


@router.patch(
    "/budget-allocations/{allocation_id}",
    response_model=BudgetAllocationOut,
    dependencies=[Depends(require_allocation_permission(PermissionCode.FINANCE_BUDGET))],
)
async def update_budget_allocation(
    allocation_id: uuid.UUID, body: BudgetAllocationUpdate, db: DbDep, user: CurrentUser
) -> BudgetAllocationOut:
    allocation = await service.update_budget_allocation(db, allocation_id, body, user.id)
    await audit_svc.record(
        db,
        entity_type="finance_budget_allocation",
        entity_id=str(allocation.id),
        action="finance.budget_allocation_update",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"修正已核准預算明細：{body.reason}",
    )
    await db.commit()
    return BudgetAllocationOut.model_validate(allocation)


@router.post(
    "/budget-allocations/{allocation_id}/evidence",
    response_model=BudgetAllocationEvidenceOut,
    status_code=201,
    dependencies=[
        Depends(
            require_allocation_permission(
                PermissionCode.FINANCE_BUDGET_PROPOSE, PermissionCode.FINANCE_BUDGET
            )
        )
    ],
)
async def add_budget_allocation_evidence(
    allocation_id: uuid.UUID,
    body: BudgetAllocationEvidenceCreate,
    db: DbDep,
    user: CurrentUser,
) -> BudgetAllocationEvidenceOut:
    allocation = await db.get(FinanceBudgetAllocation, allocation_id)
    if not allocation:
        raise HTTPException(404, "預算配置不存在")
    submission = await db.get(FinanceBudgetSubmission, allocation.submission_id)
    if not submission:
        raise HTTPException(404, "預算案不存在")
    budget = await service.get_budget(db, submission.budget_id)
    can_manage, can_propose, _ = await _budget_role_flags(db, user, budget)
    is_editable = submission.status in {
        BudgetSubmissionStatus.DRAFT,
        BudgetSubmissionStatus.RETURNED,
    }
    if not (
        (can_manage and (is_editable or submission.status == BudgetSubmissionStatus.APPROVED))
        or (can_propose and is_editable and allocation.proposed_by_id == user.id)
    ):
        raise HTTPException(403, "只有預算管理幹部或此草案的提出人可以補充憑證")
    evidence = await service.add_budget_allocation_evidence(db, allocation_id, body, user.id)
    await audit_svc.record(
        db,
        entity_type="finance_budget_allocation",
        entity_id=str(allocation_id),
        action="finance.budget_evidence_add",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"補充預算憑證：{evidence.filename}",
    )
    await db.commit()
    return BudgetAllocationEvidenceOut(
        id=evidence.id,
        storage_key=evidence.storage_key,
        filename=evidence.filename,
        content_type=evidence.content_type,
        file_size=evidence.file_size,
        note=evidence.note,
        uploaded_at=evidence.created_at,
        url=f"/finance/budget-evidence/{evidence.id}",
    )


@router.get(
    "/budgets/{budget_id}/export.xlsx",
    response_class=Response,
    responses={
        200: {
            "content": {
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
                    "schema": {"type": "string", "format": "binary"}
                }
            }
        }
    },
    dependencies=[Depends(require_budget_permission(PermissionCode.FINANCE_VIEW))],
)
async def export_budget_workbook(budget_id: uuid.UUID, db: DbDep, _: CurrentUser) -> Response:
    budget = await service.get_budget(db, budget_id)
    detail = await service.budget_detail(db, budget)
    content = await asyncio.to_thread(finance_documents.budget_workbook, detail["current_plan"])
    return Response(
        content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(budget.name)}.xlsx",
            "Cache-Control": "no-store",
        },
    )


@router.patch(
    "/budgets/{budget_id}/income-items/{income_id}",
    response_model=BudgetIncomeItemOut,
    dependencies=[Depends(require_budget_permission(PermissionCode.FINANCE_BUDGET))],
)
async def update_budget_income_item(
    budget_id: uuid.UUID,
    income_id: uuid.UUID,
    body: BudgetIncomeItemUpdate,
    db: DbDep,
    user: CurrentUser,
) -> BudgetIncomeItemOut:
    item, previous = await service.update_budget_income_item(db, budget_id, income_id, body)
    await audit_svc.record(
        db,
        entity_type="finance_budget_income_item",
        entity_id=str(item.id),
        action="finance.budget_income_update",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"修正預算收入：{item.name}；{previous} → {item.amount}",
    )
    await db.commit()
    return BudgetIncomeItemOut.model_validate(item)


@router.get(
    "/budgets/{budget_id}/expenses/{expense_id}/evidence/{evidence_id}",
    dependencies=[Depends(require_budget_permission(PermissionCode.FINANCE_VIEW))],
)
async def download_budget_expense_evidence(
    budget_id: uuid.UUID,
    expense_id: uuid.UUID,
    evidence_id: uuid.UUID,
    db: DbDep,
):
    budget = await service.get_budget(db, budget_id)
    expense = await db.get(FinanceBudgetExpense, expense_id)
    evidence = await db.get(FinanceBudgetExpenseEvidence, evidence_id)
    if (
        not expense
        or expense.budget_id != budget.id
        or not evidence
        or evidence.expense_id != expense.id
    ):
        raise HTTPException(404, "支出憑證不存在")
    service.validate_evidence_key(evidence.storage_key, budget.ledger_id)
    return await deliver_stored_file(
        get_storage(),
        evidence.storage_key,
        filename=evidence.filename,
        content_type=evidence.content_type,
        disposition="inline",
        headers=_inline_evidence_headers("private, no-store"),
        missing_detail="支出憑證檔案不存在",
    )


@router.get("/budget-evidence/{evidence_id}")
async def download_budget_evidence(evidence_id: uuid.UUID, db: DbDep, user: CurrentUser):
    evidence = await db.get(FinanceBudgetAllocationEvidence, evidence_id)
    if not evidence:
        raise HTTPException(404, "預算憑證不存在")
    allocation = await db.get(FinanceBudgetAllocation, evidence.allocation_id)
    if not allocation:
        raise HTTPException(404, "預算明細不存在")
    submission = await db.get(FinanceBudgetSubmission, allocation.submission_id)
    if not submission:
        raise HTTPException(404, "預算案不存在")
    budget = await service.get_budget(db, submission.budget_id)
    can_manage, can_propose, can_review = await _budget_role_flags(db, user, budget)
    if not (can_manage or can_review or (can_propose and allocation.proposed_by_id == user.id)):
        raise HTTPException(403, "沒有檢視這份內部預算憑證的權限")
    service.validate_evidence_key(evidence.storage_key, budget.ledger_id)
    return await deliver_stored_file(
        get_storage(),
        evidence.storage_key,
        filename=evidence.filename,
        content_type=evidence.content_type,
        disposition="inline",
        headers=_inline_evidence_headers("private, no-store"),
        missing_detail="預算憑證檔案不存在",
    )
