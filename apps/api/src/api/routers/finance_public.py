"""公開財務查詢與憑證下載 API。"""

from __future__ import annotations

import mimetypes
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.models.finance import (
    BudgetSubmissionStatus,
    ExpenseClaimItem,
    ExpenseClaimItemEvidence,
    FinanceBudget,
    FinanceBudgetAllocation,
    FinanceBudgetExpense,
    FinanceBudgetExpenseEvidence,
    FinanceBudgetNode,
    FinanceBudgetSubmission,
    JournalEntry,
)
from api.routers.finance_common import _inline_evidence_headers as _inline_evidence_headers
from api.schemas.finance import (
    BudgetNodeOut,
    PublicBudgetAllocationOut,
    PublicBudgetDetailOut,
    PublicBudgetExpenseOut,
    PublicBudgetListItem,
    PublicBudgetSubmissionOut,
    PublicExpenseClaimDetailOut,
    PublicExpenseOut,
    PublicFinanceTotalsOut,
)
from api.services import finance as service
from api.services.file_delivery import deliver_stored_file
from api.services.storage import get_storage

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.get(
    "/public/budgets/{budget_id}/expense-claims/{entry_id}",
    response_model=PublicExpenseClaimDetailOut,
)
async def get_public_expense_claim_detail(
    budget_id: uuid.UUID, entry_id: uuid.UUID, db: DbDep
) -> PublicExpenseClaimDetailOut:
    return PublicExpenseClaimDetailOut.model_validate(
        await service.public_expense_claim_detail(db, budget_id, entry_id)
    )


@router.get("/public/budgets/{budget_id}/totals", response_model=PublicFinanceTotalsOut)
async def get_public_budget_period_totals(
    budget_id: uuid.UUID, db: DbDep
) -> PublicFinanceTotalsOut:
    return PublicFinanceTotalsOut.model_validate(
        await service.public_budget_period_totals(db, budget_id)
    )


@router.get("/public/expenses", response_model=list[PublicExpenseOut])
async def list_public_expenses(
    db: DbDep, limit: int = Query(10, ge=1, le=100)
) -> list[PublicExpenseOut]:
    return [
        PublicExpenseOut.model_validate(item)
        for item in await service.list_public_expenses(db, limit)
    ]


@router.get("/public/budgets", response_model=list[PublicBudgetListItem])
async def list_public_budgets(db: DbDep) -> list[PublicBudgetListItem]:
    return [
        PublicBudgetListItem(
            id=budget.id,
            name=budget.name,
            period_name=period.name,
            visibility="council_review" if submission else "approved",
            review_submission_id=submission.id if submission else None,
            review_title=submission.title if submission else None,
        )
        for budget, period, submission in await service.list_public_budgets(db)
    ]


@router.get("/public/budgets/{budget_id}", response_model=PublicBudgetDetailOut)
async def get_public_budget_detail(
    budget_id: uuid.UUID,
    db: DbDep,
    review_submission_id: uuid.UUID | None = Query(None),
) -> PublicBudgetDetailOut:
    detail, period, review_submission = await service.public_budget_detail(
        db, budget_id, review_submission_id
    )
    approved_submissions = [item for item in detail["submissions"] if item.status == "approved"]
    visible_submissions = [review_submission] if review_submission else approved_submissions
    visible_submission_ids = (
        {item.id for item in visible_submissions}
        if review_submission
        else set(detail["current_plan"].submission_ids)
    )
    return PublicBudgetDetailOut(
        id=detail["id"],
        name=detail["name"],
        period_name=period.name,
        visibility="council_review" if review_submission else "approved",
        review_submission=(
            PublicBudgetSubmissionOut(
                id=review_submission.id,
                kind=review_submission.kind,
                status=review_submission.status,
                title=review_submission.title,
                reviewed_at=review_submission.reviewed_at,
                council_approved_on=review_submission.council_approved_on,
                review_note=review_submission.review_note,
            )
            if review_submission
            else None
        ),
        submissions=[
            PublicBudgetSubmissionOut(
                id=item.id,
                kind=item.kind,
                status=item.status,
                title=item.title,
                reviewed_at=item.reviewed_at,
                council_approved_on=item.council_approved_on,
                review_note=item.review_note,
            )
            for item in approved_submissions
        ],
        nodes=[BudgetNodeOut.model_validate(item) for item in detail["nodes"]],
        allocations=[
            PublicBudgetAllocationOut.model_validate(item)
            for item in detail["allocations"]
            if item["submission_id"] in visible_submission_ids
        ],
        expenses=(
            [PublicBudgetExpenseOut.model_validate(item) for item in detail["expenses"]]
            if review_submission is None
            else []
        ),
    )


@router.get("/public/budgets/{budget_id}/expenses/{expense_id}/evidence/{evidence_id}")
async def download_public_budget_expense_evidence(
    budget_id: uuid.UUID,
    expense_id: uuid.UUID,
    evidence_id: uuid.UUID,
    db: DbDep,
):
    budget = await db.get(FinanceBudget, budget_id)
    expense = await db.get(FinanceBudgetExpense, expense_id)
    evidence = await db.get(FinanceBudgetExpenseEvidence, evidence_id)
    if (
        not budget
        or not budget.is_public
        or not expense
        or expense.budget_id != budget.id
        or not evidence
        or evidence.expense_id != expense.id
    ):
        raise HTTPException(404, "公開憑證不存在")
    approved_initial = await db.scalar(
        select(FinanceBudgetSubmission.id).where(
            FinanceBudgetSubmission.budget_id == budget.id,
            FinanceBudgetSubmission.kind == "initial",
            FinanceBudgetSubmission.status == BudgetSubmissionStatus.APPROVED,
        )
    )
    if not approved_initial:
        raise HTTPException(404, "公開憑證不存在")
    approved_allocation = await db.scalar(
        select(FinanceBudgetAllocation.id)
        .join(FinanceBudgetSubmission)
        .where(
            FinanceBudgetAllocation.id == expense.allocation_id,
            FinanceBudgetSubmission.status == BudgetSubmissionStatus.APPROVED,
        )
    )
    if not approved_allocation:
        raise HTTPException(404, "公開憑證不存在")
    service.validate_evidence_key(evidence.storage_key, budget.ledger_id)
    return await deliver_stored_file(
        get_storage(),
        evidence.storage_key,
        filename=evidence.filename,
        content_type=evidence.content_type,
        disposition="inline",
        headers=_inline_evidence_headers("public, max-age=300"),
        missing_detail="公開憑證檔案不存在",
    )


@router.get("/public/budgets/{budget_id}/expense-claims/{entry_id}/evidence/{evidence_id}")
async def download_public_expense_claim_evidence(
    budget_id: uuid.UUID,
    entry_id: uuid.UUID,
    evidence_id: uuid.UUID,
    db: DbDep,
):
    claim_detail = await service.public_expense_claim_detail(db, budget_id, entry_id)
    visible_evidence_ids = {
        evidence["id"] for item in claim_detail["items"] for evidence in item["evidence"]
    }
    if evidence_id == entry_id:
        if not claim_detail["supplemental_evidence"]:
            raise HTTPException(404, "公開憑證不存在")
    elif evidence_id not in visible_evidence_ids:
        raise HTTPException(404, "公開憑證不存在")

    entry = await db.get(JournalEntry, entry_id)
    budget = await db.get(FinanceBudget, budget_id)
    if not entry or not budget:
        raise HTTPException(404, "公開憑證不存在")

    evidence = await db.get(ExpenseClaimItemEvidence, evidence_id)
    if evidence:
        item = await db.get(ExpenseClaimItem, evidence.item_id)
        node = await db.get(FinanceBudgetNode, item.budget_node_id) if item else None
        approved_allocation = (
            await db.scalar(
                select(FinanceBudgetAllocation.id)
                .join(FinanceBudgetSubmission)
                .where(
                    FinanceBudgetAllocation.node_id == node.id,
                    FinanceBudgetSubmission.budget_id == budget.id,
                    FinanceBudgetSubmission.status == BudgetSubmissionStatus.APPROVED,
                )
            )
            if node
            else None
        )
        if (
            not item
            or item.journal_entry_id != entry.id
            or not node
            or node.budget_id != budget.id
            or not approved_allocation
        ):
            raise HTTPException(404, "公開憑證不存在")
        storage_key = evidence.storage_key
        filename = evidence.filename
        content_type = evidence.content_type
    elif evidence_id == entry.id and entry.evidence_url:
        storage_key = entry.evidence_url
        filename = "報帳附件"
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    else:
        raise HTTPException(404, "公開憑證不存在")

    service.validate_evidence_key(storage_key, budget.ledger_id)
    return await deliver_stored_file(
        get_storage(),
        storage_key,
        filename=filename,
        content_type=content_type,
        disposition="inline",
        headers=_inline_evidence_headers("public, max-age=300"),
        missing_detail="公開憑證檔案不存在",
    )
