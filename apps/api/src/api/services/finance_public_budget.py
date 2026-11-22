"""公開預算、支出與結算查詢。"""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy import case, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.finance import (
    BudgetSubmissionKind,
    BudgetSubmissionStatus,
    ChartAccount,
    ExpenseClaimItem,
    ExpenseClaimItemEvidence,
    ExpenseClaimStatus,
    ExpensePaymentMethod,
    ExpensePaymentStatus,
    FinanceAccountType,
    FinanceBudget,
    FinanceBudgetAllocation,
    FinanceBudgetExpense,
    FinanceBudgetExpenseEvidence,
    FinanceBudgetExpenseItem,
    FinanceBudgetNode,
    FinanceBudgetSubmission,
    FiscalPeriod,
    JournalEntry,
    JournalLine,
    JournalStatus,
)
from api.models.org import Org
from api.models.user import User
from api.services.finance_budget import budget_detail
from api.services.finance_core import _claim_item_total


async def _public_budget_claim_expense_details(
    db: AsyncSession, budget: FinanceBudget
) -> list[dict]:
    approved_node_ids = (
        select(FinanceBudgetAllocation.node_id)
        .join(FinanceBudgetSubmission)
        .where(
            FinanceBudgetSubmission.budget_id == budget.id,
            FinanceBudgetSubmission.status == BudgetSubmissionStatus.APPROVED,
        )
    )
    rows = (
        await db.execute(
            select(ExpenseClaimItem, JournalEntry, FinanceBudgetNode)
            .join(JournalEntry, JournalEntry.id == ExpenseClaimItem.journal_entry_id)
            .join(FinanceBudgetNode, FinanceBudgetNode.id == ExpenseClaimItem.budget_node_id)
            .where(
                JournalEntry.ledger_id == budget.ledger_id,
                JournalEntry.source_type == "expense_claim",
                JournalEntry.status == JournalStatus.POSTED,
                FinanceBudgetNode.budget_id == budget.id,
                FinanceBudgetNode.is_active.is_(True),
                FinanceBudgetNode.id.in_(approved_node_ids),
            )
            .order_by(
                JournalEntry.entry_date.desc(),
                JournalEntry.created_at.desc(),
                ExpenseClaimItem.created_at,
                ExpenseClaimItem.id,
            )
        )
    ).all()
    item_ids = [item.id for item, _, _ in rows]
    evidence_rows = (
        list(
            (
                await db.execute(
                    select(ExpenseClaimItemEvidence)
                    .where(ExpenseClaimItemEvidence.item_id.in_(item_ids))
                    .order_by(ExpenseClaimItemEvidence.created_at, ExpenseClaimItemEvidence.id)
                )
            ).scalars()
        )
        if item_ids
        else []
    )
    evidence_by_item: dict[uuid.UUID, list[ExpenseClaimItemEvidence]] = {}
    for receipt_record in evidence_rows:
        evidence_by_item.setdefault(receipt_record.item_id, []).append(receipt_record)

    supplemental_entries: set[uuid.UUID] = set()
    expenses = []
    for item, entry, node in rows:
        amount = _claim_item_total(item.unit_price, item.tax_rate, item.quantity)
        evidence_details = [
            {
                "id": receipt.id,
                "filename": receipt.filename,
                "url": (
                    f"/finance/public/budgets/{budget.id}/expense-claims/{entry.id}/"
                    f"evidence/{receipt.id}"
                ),
            }
            for receipt in evidence_by_item.get(item.id, [])
        ]
        if entry.evidence_url and entry.id not in supplemental_entries:
            evidence_details.append(
                {
                    "id": entry.id,
                    "filename": "報帳附件",
                    "url": (
                        f"/finance/public/budgets/{budget.id}/expense-claims/{entry.id}/"
                        f"evidence/{entry.id}"
                    ),
                }
            )
            supplemental_entries.add(entry.id)
        expenses.append(
            {
                "id": item.id,
                "entry_date": entry.entry_date,
                "created_at": entry.created_at,
                "purpose": re.sub(r"^報帳｜|（\d+ 項）$", "", entry.description),
                "allocation_node_id": node.id,
                "allocation_name": node.name,
                "total_amount": amount,
                "items": [
                    {
                        "id": item.id,
                        "name": item.name,
                        "unit_price": item.unit_price,
                        "tax_rate": item.tax_rate,
                        "quantity": item.quantity,
                        "unit": item.unit,
                        "amount": amount,
                    }
                ],
                "evidence": evidence_details,
            }
        )
    return expenses


async def list_public_budgets(
    db: AsyncSession,
) -> list[tuple[FinanceBudget, FiscalPeriod, FinanceBudgetSubmission | None]]:
    approved_initial = exists().where(
        FinanceBudgetSubmission.budget_id == FinanceBudget.id,
        FinanceBudgetSubmission.kind == "initial",
        FinanceBudgetSubmission.status == BudgetSubmissionStatus.APPROVED,
    )
    approved = list(
        (
            await db.execute(
                select(FinanceBudget, FiscalPeriod)
                .join(FiscalPeriod, FiscalPeriod.id == FinanceBudget.period_id)
                .where(FinanceBudget.is_public, approved_initial)
                .order_by(FiscalPeriod.starts_on.desc(), FinanceBudget.name)
            )
        ).all()
    )
    council_review = list(
        (
            await db.execute(
                select(FinanceBudget, FiscalPeriod, FinanceBudgetSubmission)
                .join(FiscalPeriod, FiscalPeriod.id == FinanceBudget.period_id)
                .join(
                    FinanceBudgetSubmission, FinanceBudgetSubmission.budget_id == FinanceBudget.id
                )
                .where(
                    FinanceBudgetSubmission.is_council_review_public,
                    FinanceBudgetSubmission.status.in_(
                        [
                            BudgetSubmissionStatus.DRAFT,
                            BudgetSubmissionStatus.SUBMITTED,
                            BudgetSubmissionStatus.RETURNED,
                        ]
                    ),
                )
                .order_by(
                    FiscalPeriod.starts_on.desc(),
                    FinanceBudget.name,
                    FinanceBudgetSubmission.created_at,
                )
            )
        ).all()
    )
    return [
        *((budget, period, None) for budget, period in approved),
        *((budget, period, submission) for budget, period, submission in council_review),
    ]


async def list_public_expenses(db: AsyncSession, limit: int = 10) -> list[dict]:
    """公開預算的逐項支出紀錄，不回傳承辦人或內部備註。"""
    approved_initial = (
        exists()
        .where(
            FinanceBudgetSubmission.budget_id == FinanceBudget.id,
            FinanceBudgetSubmission.kind == BudgetSubmissionKind.INITIAL,
            FinanceBudgetSubmission.status == BudgetSubmissionStatus.APPROVED,
        )
        .correlate(FinanceBudget)
    )
    rows = (
        await db.execute(
            select(ExpenseClaimItem, JournalEntry, FinanceBudget, FinanceBudgetNode)
            .join(JournalEntry, JournalEntry.id == ExpenseClaimItem.journal_entry_id)
            .join(FinanceBudgetNode, FinanceBudgetNode.id == ExpenseClaimItem.budget_node_id)
            .join(FinanceBudget, FinanceBudget.id == FinanceBudgetNode.budget_id)
            .where(
                JournalEntry.source_type == "expense_claim",
                JournalEntry.status == JournalStatus.POSTED,
                JournalEntry.claim_status.in_(
                    [ExpenseClaimStatus.APPROVED, ExpenseClaimStatus.COMPLETED]
                ),
                FinanceBudget.is_public.is_(True),
                FinanceBudget.ledger_id == JournalEntry.ledger_id,
                approved_initial,
            )
            .order_by(JournalEntry.entry_date.desc(), JournalEntry.created_at.desc())
            .limit(limit)
        )
    ).all()

    public_expenses: list[tuple[date, datetime, dict]] = []
    for item, entry, budget, node in rows:
        if entry.claim_status == ExpenseClaimStatus.COMPLETED:
            public_status = "spent"
        elif (
            entry.payment_method == ExpensePaymentMethod.ADVANCE
            and entry.payment_status != ExpensePaymentStatus.ADVANCE_REIMBURSED
        ):
            public_status = "awaiting_reimbursement"
        else:
            public_status = "pending"
        public_expenses.append(
            (
                entry.entry_date,
                entry.created_at,
                {
                    "id": item.id,
                    "claim_id": entry.id,
                    "budget_id": budget.id,
                    "entry_date": entry.entry_date,
                    "purpose": re.sub(r"^報帳｜|（\d+ 項）$", "", entry.description),
                    "item_name": item.name,
                    "amount": _claim_item_total(item.unit_price, item.tax_rate, item.quantity),
                    "quantity": item.quantity,
                    "unit": item.unit,
                    "unit_price": item.unit_price,
                    "budget_name": budget.name,
                    "budget_item": node.name,
                    "payment_method": entry.payment_method,
                    "status": public_status,
                    "evidence": [],
                },
            )
        )

    direct_rows = (
        await db.execute(
            select(
                FinanceBudgetExpense,
                FinanceBudgetExpenseItem,
                FinanceBudget,
                FinanceBudgetAllocation,
                FinanceBudgetNode,
            )
            .join(
                FinanceBudgetExpenseItem,
                FinanceBudgetExpenseItem.expense_id == FinanceBudgetExpense.id,
            )
            .join(FinanceBudget, FinanceBudget.id == FinanceBudgetExpense.budget_id)
            .join(
                FinanceBudgetAllocation,
                FinanceBudgetAllocation.id == FinanceBudgetExpense.allocation_id,
            )
            .join(FinanceBudgetNode, FinanceBudgetNode.id == FinanceBudgetAllocation.node_id)
            .join(
                FinanceBudgetSubmission,
                FinanceBudgetSubmission.id == FinanceBudgetAllocation.submission_id,
            )
            .where(
                FinanceBudget.is_public.is_(True),
                FinanceBudgetSubmission.status == BudgetSubmissionStatus.APPROVED,
                approved_initial,
            )
            .order_by(
                FinanceBudgetExpense.entry_date.desc(),
                FinanceBudgetExpense.created_at.desc(),
                FinanceBudgetExpenseItem.sort_order,
            )
            .limit(limit)
        )
    ).all()
    direct_expense_ids = list({expense.id for expense, _, _, _, _ in direct_rows})
    direct_evidence_rows = (
        list(
            (
                await db.execute(
                    select(FinanceBudgetExpenseEvidence)
                    .where(FinanceBudgetExpenseEvidence.expense_id.in_(direct_expense_ids))
                    .order_by(FinanceBudgetExpenseEvidence.created_at)
                )
            ).scalars()
        )
        if direct_expense_ids
        else []
    )
    evidence_by_expense: dict[uuid.UUID, list[FinanceBudgetExpenseEvidence]] = {}
    for evidence in direct_evidence_rows:
        evidence_by_expense.setdefault(evidence.expense_id, []).append(evidence)
    for expense, item, budget, _, node in direct_rows:
        public_expenses.append(
            (
                expense.entry_date,
                expense.created_at,
                {
                    "id": item.id,
                    "budget_id": budget.id,
                    "entry_date": expense.entry_date,
                    "purpose": expense.purpose,
                    "item_name": item.name,
                    "amount": _claim_item_total(item.unit_price, item.tax_rate, item.quantity),
                    "quantity": item.quantity,
                    "unit": item.unit,
                    "unit_price": item.unit_price,
                    "budget_name": budget.name,
                    "budget_item": node.name,
                    "payment_method": ExpensePaymentMethod.DIRECT,
                    "status": "spent",
                    "evidence": [
                        {
                            "id": evidence.id,
                            "filename": evidence.filename,
                            "url": (
                                f"/finance/public/budgets/{budget.id}/expenses/{expense.id}/"
                                f"evidence/{evidence.id}"
                            ),
                        }
                        for evidence in evidence_by_expense.get(expense.id, [])
                    ],
                },
            )
        )
    public_expenses.sort(key=lambda row: (row[0], row[1]), reverse=True)
    return [row[2] for row in public_expenses[:limit]]


async def public_expense_claim_detail(
    db: AsyncSession, budget_id: uuid.UUID, entry_id: uuid.UUID
) -> dict:
    budget = await db.get(FinanceBudget, budget_id)
    if not budget or not budget.is_public:
        raise HTTPException(404, "公開支出不存在")

    approved_initial = await db.scalar(
        select(FinanceBudgetSubmission.id).where(
            FinanceBudgetSubmission.budget_id == budget.id,
            FinanceBudgetSubmission.kind == BudgetSubmissionKind.INITIAL,
            FinanceBudgetSubmission.status == BudgetSubmissionStatus.APPROVED,
        )
    )
    if not approved_initial:
        raise HTTPException(404, "公開支出不存在")

    entry = await db.scalar(
        select(JournalEntry).where(
            JournalEntry.id == entry_id,
            JournalEntry.ledger_id == budget.ledger_id,
            JournalEntry.source_type == "expense_claim",
            JournalEntry.status == JournalStatus.POSTED,
            JournalEntry.claim_status == ExpenseClaimStatus.COMPLETED,
            JournalEntry.budget_included.is_(True),
        )
    )
    if not entry:
        raise HTTPException(404, "公開支出不存在")

    item_rows = (
        await db.execute(
            select(ExpenseClaimItem, FinanceBudgetNode)
            .join(FinanceBudgetNode, FinanceBudgetNode.id == ExpenseClaimItem.budget_node_id)
            .where(
                ExpenseClaimItem.journal_entry_id == entry.id,
                FinanceBudgetNode.budget_id == budget.id,
                FinanceBudgetNode.is_active.is_(True),
            )
            .order_by(ExpenseClaimItem.created_at, ExpenseClaimItem.id)
        )
    ).all()
    if not item_rows:
        raise HTTPException(404, "公開支出不存在")

    item_node_ids = {node.id for _, node in item_rows}
    approved_node_ids = set(
        (
            await db.execute(
                select(FinanceBudgetAllocation.node_id)
                .join(FinanceBudgetSubmission)
                .where(
                    FinanceBudgetAllocation.node_id.in_(item_node_ids),
                    FinanceBudgetSubmission.budget_id == budget.id,
                    FinanceBudgetSubmission.status == BudgetSubmissionStatus.APPROVED,
                )
            )
        ).scalars()
    )
    item_rows = [(item, node) for item, node in item_rows if node.id in approved_node_ids]
    if not item_rows:
        raise HTTPException(404, "公開支出不存在")

    item_ids = [item.id for item, _ in item_rows]
    evidence_rows = list(
        (
            await db.execute(
                select(ExpenseClaimItemEvidence)
                .where(ExpenseClaimItemEvidence.item_id.in_(item_ids))
                .order_by(ExpenseClaimItemEvidence.created_at, ExpenseClaimItemEvidence.id)
            )
        ).scalars()
    )
    evidence_by_item: dict[uuid.UUID, list[ExpenseClaimItemEvidence]] = {}
    for evidence in evidence_rows:
        evidence_by_item.setdefault(evidence.item_id, []).append(evidence)

    reporter_name = await db.scalar(select(User.display_name).where(User.id == entry.created_by_id))
    department_name = (
        await db.scalar(select(Org.name).where(Org.id == entry.proposing_org_id))
        if entry.proposing_org_id
        else None
    )
    items = [
        {
            "id": item.id,
            "name": item.name,
            "unit_price": item.unit_price,
            "tax_rate": item.tax_rate,
            "quantity": item.quantity,
            "unit": item.unit,
            "budget_item": node.name,
            "amount": _claim_item_total(item.unit_price, item.tax_rate, item.quantity),
            "evidence": [
                {
                    "id": evidence.id,
                    "filename": evidence.filename,
                    "url": (
                        f"/finance/public/budgets/{budget.id}/expense-claims/{entry.id}/"
                        f"evidence/{evidence.id}"
                    ),
                }
                for evidence in evidence_by_item.get(item.id, [])
            ],
        }
        for item, node in item_rows
    ]
    supplemental_evidence = (
        [
            {
                "id": entry.id,
                "filename": "報帳附件",
                "url": (
                    f"/finance/public/budgets/{budget.id}/expense-claims/{entry.id}/"
                    f"evidence/{entry.id}"
                ),
            }
        ]
        if entry.evidence_url
        else []
    )
    return {
        "id": entry.id,
        "budget_id": budget.id,
        "budget_name": budget.name,
        "entry_date": entry.entry_date,
        "purpose": re.sub(r"^報帳｜|（\d+ 項）$", "", entry.description),
        "department_name": department_name,
        "reporter_name": reporter_name or "已停用使用者",
        "reported_at": entry.created_at,
        "paid_at": entry.payment_at,
        "payment_method": entry.payment_method,
        "total_amount": sum(item["amount"] for item in items),
        "items": items,
        "supplemental_evidence": supplemental_evidence,
    }


async def public_budget_period_totals(db: AsyncSession, budget_id: uuid.UUID) -> dict:
    """分開回傳預算明細與正式會計分錄總額，兩者可能重疊。"""
    budget = await db.get(FinanceBudget, budget_id)
    if not budget or not budget.is_public:
        raise HTTPException(404, "公開預算不存在")
    detail, _, _ = await public_budget_detail(db, budget.id)

    accounting_income, accounting_expenses = (
        await db.execute(
            select(
                func.coalesce(
                    func.sum(
                        case(
                            (
                                ChartAccount.account_type == FinanceAccountType.REVENUE,
                                JournalLine.credit - JournalLine.debit,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ),
                func.coalesce(
                    func.sum(
                        case(
                            (
                                ChartAccount.account_type == FinanceAccountType.EXPENSE,
                                JournalLine.debit - JournalLine.credit,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ),
            )
            .select_from(JournalLine)
            .join(ChartAccount, ChartAccount.id == JournalLine.account_id)
            .join(JournalEntry, JournalEntry.id == JournalLine.entry_id)
            .where(
                JournalEntry.ledger_id == budget.ledger_id,
                JournalEntry.period_id == budget.period_id,
                JournalEntry.status == JournalStatus.POSTED,
            )
        )
    ).one()
    budget_income = sum(int(record["amount"]) for record in detail["income_records"])
    budget_expenses = sum(int(expense["total_amount"]) for expense in detail["expenses"])
    return {
        "budget_income_total": budget_income,
        "budget_expense_total": budget_expenses,
        "accounting_income_total": int(accounting_income),
        "accounting_expense_total": int(accounting_expenses),
    }


async def public_budget_detail(
    db: AsyncSession, budget_id: uuid.UUID, review_submission_id: uuid.UUID | None = None
) -> tuple[dict, FiscalPeriod, FinanceBudgetSubmission | None]:
    budget = await db.get(FinanceBudget, budget_id)
    if not budget:
        raise HTTPException(404, "公開預算不存在")
    period = await db.get(FiscalPeriod, budget.period_id)
    if not period:
        raise HTTPException(404, "會計期間不存在")
    if review_submission_id:
        submission = await db.scalar(
            select(FinanceBudgetSubmission).where(
                FinanceBudgetSubmission.id == review_submission_id,
                FinanceBudgetSubmission.budget_id == budget.id,
                FinanceBudgetSubmission.is_council_review_public,
                FinanceBudgetSubmission.status.in_(
                    [
                        BudgetSubmissionStatus.DRAFT,
                        BudgetSubmissionStatus.SUBMITTED,
                        BudgetSubmissionStatus.RETURNED,
                    ]
                ),
            )
        )
        if not submission:
            raise HTTPException(404, "公開預算不存在")
        return await budget_detail(db, budget), period, submission

    if not budget.is_public:
        raise HTTPException(404, "公開預算不存在")
    approved_initial = await db.scalar(
        select(FinanceBudgetSubmission.id).where(
            FinanceBudgetSubmission.budget_id == budget.id,
            FinanceBudgetSubmission.kind == "initial",
            FinanceBudgetSubmission.status == BudgetSubmissionStatus.APPROVED,
        )
    )
    if not approved_initial:
        raise HTTPException(404, "公開預算不存在")
    detail = await budget_detail(db, budget)
    approved_submission_ids = {
        submission.id
        for submission in detail["submissions"]
        if submission.status == BudgetSubmissionStatus.APPROVED
    }
    approved_allocation_ids = {
        allocation["id"]
        for allocation in detail["allocations"]
        if allocation["submission_id"] in approved_submission_ids
    }
    active_node_ids = {node["id"] for node in detail["nodes"]}
    direct_expenses = [
        expense
        for expense in detail["expenses"]
        if expense["allocation_id"] in approved_allocation_ids
        and expense["allocation_node_id"] in active_node_ids
    ]
    for expense in direct_expenses:
        for evidence in expense["evidence"]:
            evidence["url"] = (
                f"/finance/public/budgets/{budget.id}/expenses/{expense['id']}/"
                f"evidence/{evidence['id']}"
            )
    claim_expenses = await _public_budget_claim_expense_details(db, budget)
    detail["expenses"] = sorted(
        [*direct_expenses, *claim_expenses],
        key=lambda expense: (expense["entry_date"], expense["created_at"]),
        reverse=True,
    )
    used_by_node: dict[uuid.UUID, int] = {}
    for expense in detail["expenses"]:
        node_id = expense["allocation_node_id"]
        used_by_node[node_id] = used_by_node.get(node_id, 0) + expense["total_amount"]
    for node in detail["nodes"]:
        node["used_amount"] = used_by_node.get(node["id"], 0)
        node["remaining_amount"] = node["allocated_amount"] - node["used_amount"]
    return detail, period, None


async def settlement_report(db: AsyncSession, ledger_id: uuid.UUID, period_id: uuid.UUID) -> dict:
    period = await db.get(FiscalPeriod, period_id)
    if not period or period.ledger_id != ledger_id:
        raise HTTPException(404, "會計期間不存在")
    budget = await db.scalar(
        select(FinanceBudget).where(
            FinanceBudget.ledger_id == ledger_id, FinanceBudget.period_id == period_id
        )
    )
    if not budget:
        return {
            "period_id": period.id,
            "period_name": period.name,
            "budgeted_total": 0,
            "settled_total": 0,
            "unsettled_claim_count": 0,
            "lines": [],
        }
    detail = await budget_detail(db, budget)
    settled_rows = (
        await db.execute(
            select(
                ExpenseClaimItem.budget_node_id,
                func.coalesce(
                    func.sum(
                        func.round(
                            ExpenseClaimItem.unit_price
                            * ((100 + ExpenseClaimItem.tax_rate) / 100)
                            * ExpenseClaimItem.quantity
                        )
                    ),
                    0,
                ),
            )
            .join(JournalEntry, JournalEntry.id == ExpenseClaimItem.journal_entry_id)
            .where(
                ExpenseClaimItem.budget_node_id.is_not(None),
                JournalEntry.ledger_id == ledger_id,
                JournalEntry.period_id == period_id,
                JournalEntry.status == JournalStatus.POSTED,
                JournalEntry.claim_status == ExpenseClaimStatus.COMPLETED,
            )
            .group_by(ExpenseClaimItem.budget_node_id)
        )
    ).all()
    settled = {row[0]: int(row[1]) for row in settled_rows if row[0] is not None}
    direct_settled_rows = (
        await db.execute(
            select(FinanceBudgetAllocation.node_id, func.sum(FinanceBudgetExpense.total_amount))
            .join(
                FinanceBudgetExpense,
                FinanceBudgetExpense.allocation_id == FinanceBudgetAllocation.id,
            )
            .join(
                FinanceBudgetSubmission,
                FinanceBudgetSubmission.id == FinanceBudgetAllocation.submission_id,
            )
            .where(
                FinanceBudgetExpense.budget_id == budget.id,
                FinanceBudgetSubmission.status == BudgetSubmissionStatus.APPROVED,
            )
            .group_by(FinanceBudgetAllocation.node_id)
        )
    ).all()
    for node_id, amount in direct_settled_rows:
        settled[node_id] = settled.get(node_id, 0) + int(amount or 0)
    unsettled_claim_count = await db.scalar(
        select(func.count())
        .select_from(JournalEntry)
        .where(
            JournalEntry.ledger_id == ledger_id,
            JournalEntry.period_id == period_id,
            JournalEntry.source_type == "expense_claim",
            JournalEntry.status == JournalStatus.POSTED,
            JournalEntry.claim_status != ExpenseClaimStatus.COMPLETED,
        )
    )
    lines = [
        {
            "node_id": node["id"],
            "name": node["name"],
            "budgeted_amount": node["allocated_amount"],
            "settled_amount": settled.get(node["id"], 0),
            "difference_amount": node["allocated_amount"] - settled.get(node["id"], 0),
        }
        for node in detail["nodes"]
        if not any(child["parent_id"] == node["id"] for child in detail["nodes"])
    ]
    return {
        "period_id": period.id,
        "period_name": period.name,
        "budgeted_total": sum(line["budgeted_amount"] for line in lines),
        "settled_total": sum(line["settled_amount"] for line in lines),
        "unsettled_claim_count": int(unsettled_claim_count or 0),
        "lines": lines,
    }
