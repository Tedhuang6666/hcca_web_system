"""報帳案件與付款核銷流程。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from api.models.finance import (
    BudgetSubmissionStatus,
    ChartAccount,
    ExpenseClaimItem,
    ExpenseClaimItemEvidence,
    ExpenseClaimStatus,
    ExpensePaymentMethod,
    ExpensePaymentStatus,
    ExpenseProcurementStatus,
    FinanceAccountType,
    FinanceBudget,
    FinanceBudgetAllocation,
    FinanceBudgetNode,
    FinanceBudgetSubmission,
    FundAccount,
    JournalEntry,
    JournalLine,
    JournalStatus,
)
from api.schemas.finance import (
    ExpenseBudgetUpdate,
    ExpenseClaimCreate,
    ExpenseClaimItemCreate,
    ExpenseProcurementUpdate,
    ExpenseReimbursementCreate,
    JournalCreate,
)
from api.services.finance_core import _claim_item_total, validate_evidence_key
from api.services.finance_journal import create_journal, validate_period


async def return_expense_claim(
    db: AsyncSession, entry: JournalEntry, reviewer_id: uuid.UUID, note: str
) -> JournalEntry:
    if entry.source_type != "expense_claim":
        raise HTTPException(400, "只有報帳案件可以退回")
    if entry.status != JournalStatus.PENDING_REVIEW:
        raise HTTPException(400, "僅待覆核報帳可以退回")
    entry.status = JournalStatus.RETURNED
    entry.claim_status = ExpenseClaimStatus.RETURNED
    entry.reviewed_by_id = reviewer_id
    entry.note = note
    await db.flush()
    return entry


async def update_expense_procurement(
    db: AsyncSession,
    entry: JournalEntry,
    body: ExpenseProcurementUpdate,
    user_id: uuid.UUID,
) -> JournalEntry:
    if entry.source_type != "expense_claim":
        raise HTTPException(400, "只有報帳案件可以管理校商請購")
    if entry.claim_status != ExpenseClaimStatus.APPROVED:
        raise HTTPException(400, "報帳必須先完成覆核")
    if entry.budget_included is not True:
        raise HTTPException(400, "報帳必須先列入已核准預算")
    current = ExpenseProcurementStatus(
        entry.procurement_status or ExpenseProcurementStatus.NOT_REQUIRED
    )
    allowed = {
        ExpenseProcurementStatus.NOT_REQUIRED: {
            ExpenseProcurementStatus.NOT_REQUIRED,
            ExpenseProcurementStatus.REQUESTED,
        },
        ExpenseProcurementStatus.REQUESTED: {
            ExpenseProcurementStatus.REQUESTED,
            ExpenseProcurementStatus.ORDERED,
            ExpenseProcurementStatus.NOT_REQUIRED,
        },
        ExpenseProcurementStatus.ORDERED: {
            ExpenseProcurementStatus.ORDERED,
            ExpenseProcurementStatus.RECEIVED,
        },
        ExpenseProcurementStatus.RECEIVED: {ExpenseProcurementStatus.RECEIVED},
    }
    if body.status not in allowed[current]:
        raise HTTPException(400, "校商請購狀態不可往回跳轉")
    entry.procurement_status = body.status
    entry.procurement_updated_by_id = user_id
    entry.procurement_updated_at = datetime.now(UTC)
    if body.note:
        entry.note = body.note
    await db.flush()
    return entry


async def mark_expense_paid(
    db: AsyncSession, entry: JournalEntry, payment_status: ExpensePaymentStatus, user_id: uuid.UUID
) -> JournalEntry:
    if entry.source_type != "expense_claim":
        raise HTTPException(400, "只有報帳案件可以登錄付款")
    if entry.claim_status != ExpenseClaimStatus.APPROVED or entry.status != JournalStatus.POSTED:
        raise HTTPException(400, "報帳必須先完成覆核並過帳")
    if entry.budget_included is not True:
        raise HTTPException(400, "報帳必須先列入已核准預算")
    if entry.payment_status not in (None, ExpensePaymentStatus.UNPAID):
        raise HTTPException(400, "此報帳已登錄付款，不可重複付款")
    entry.payment_status = payment_status
    entry.payment_by_id = user_id
    entry.payment_at = datetime.now(UTC)
    await db.flush()
    return entry


async def reimburse_expense_claim(
    db: AsyncSession,
    entry: JournalEntry,
    body: ExpenseReimbursementCreate,
    user_id: uuid.UUID,
) -> JournalEntry:
    if entry.source_type != "expense_claim" or entry.payment_method != ExpensePaymentMethod.ADVANCE:
        raise HTTPException(400, "只有代墊報帳可以建立償還付款")
    if entry.claim_status != ExpenseClaimStatus.APPROVED or entry.status != JournalStatus.POSTED:
        raise HTTPException(400, "代墊報帳必須先完成覆核並過帳")
    if entry.budget_included is not True:
        raise HTTPException(400, "代墊報帳必須先列入已核准預算")
    if entry.reimbursement_entry_id is not None:
        raise HTTPException(400, "此代墊報帳已完成償還")
    fund = await db.get(FundAccount, body.fund_account_id)
    if not fund or fund.ledger_id != entry.ledger_id or not fund.is_active:
        raise HTTPException(400, "付款資金保管點不存在或已停用")
    payable = await db.scalar(
        select(ChartAccount).where(
            ChartAccount.ledger_id == entry.ledger_id,
            ChartAccount.account_type == FinanceAccountType.LIABILITY,
            ChartAccount.code == "2101",
        )
    )
    if not payable:
        raise HTTPException(400, "找不到代墊應付款科目")
    amount = await db.scalar(
        select(func.coalesce(func.sum(JournalLine.credit), 0)).where(
            JournalLine.entry_id == entry.id, JournalLine.account_id == payable.id
        )
    )
    if not amount:
        raise HTTPException(400, "代墊報帳沒有可償還金額")
    reimbursement = await create_journal(
        db,
        entry.ledger_id,
        JournalCreate(
            period_id=body.period_id,
            entry_date=body.entry_date,
            description=f"代墊償還｜{entry.description}",
            source_type="expense_reimbursement",
            source_id=entry.id,
            source_event="reimbursement",
            note=body.note,
            lines=[
                {"account_id": payable.id, "debit": int(amount)},
                {"account_id": fund.chart_account_id, "credit": int(amount)},
            ],
        ),
        user_id,
    )
    reimbursement.status = JournalStatus.POSTED
    reimbursement.reviewed_by_id = user_id
    reimbursement.posted_at = datetime.now(UTC)
    entry.reimbursement_entry_id = reimbursement.id
    entry.payment_status = body.payment_status
    entry.payment_by_id = user_id
    entry.payment_at = datetime.now(UTC)
    await db.flush()
    return entry


async def update_expense_budget(
    db: AsyncSession,
    entry: JournalEntry,
    body: ExpenseBudgetUpdate,
    user_id: uuid.UUID,
) -> JournalEntry:
    if entry.source_type != "expense_claim":
        raise HTTPException(400, "只有報帳案件可以管理預算列管")
    if entry.claim_status != ExpenseClaimStatus.APPROVED:
        raise HTTPException(400, "報帳必須先完成覆核")
    if body.included:
        item_node_ids = set(
            (
                await db.execute(
                    select(ExpenseClaimItem.budget_node_id).where(
                        ExpenseClaimItem.journal_entry_id == entry.id
                    )
                )
            ).scalars()
        )
        if None in item_node_ids or not item_node_ids:
            raise HTTPException(400, "所有報帳品項都必須對應已核准的預算條目")
        approved_node_ids = set(
            (
                await db.execute(
                    select(FinanceBudgetAllocation.node_id)
                    .join(FinanceBudgetSubmission)
                    .where(
                        FinanceBudgetAllocation.node_id.in_(item_node_ids),
                        FinanceBudgetSubmission.status == BudgetSubmissionStatus.APPROVED,
                    )
                )
            ).scalars()
        )
        if not item_node_ids.issubset(approved_node_ids):
            raise HTTPException(400, "報帳只能列入已核准且已有額度的預算條目")
    entry.budget_included = body.included
    entry.budget_included_by_id = user_id
    entry.budget_included_at = datetime.now(UTC)
    if body.note:
        entry.note = body.note
    await db.flush()
    return entry


async def complete_expense_claim(db: AsyncSession, entry: JournalEntry) -> JournalEntry:
    if entry.source_type != "expense_claim":
        raise HTTPException(400, "只有報帳案件可以完成核銷")
    if entry.claim_status != ExpenseClaimStatus.APPROVED:
        raise HTTPException(400, "報帳尚未完成覆核")
    if entry.budget_included is not True:
        raise HTTPException(400, "報帳尚未列入已核准預算")
    if entry.payment_status in (None, ExpensePaymentStatus.UNPAID):
        raise HTTPException(400, "請先登錄付款或代墊償還")
    evidence_count = await db.scalar(
        select(func.count())
        .select_from(ExpenseClaimItemEvidence)
        .join(ExpenseClaimItem)
        .where(ExpenseClaimItem.journal_entry_id == entry.id)
    )
    if not entry.evidence_url and not evidence_count:
        raise HTTPException(400, "至少上傳一份憑證後才能完成核銷")
    entry.claim_status = ExpenseClaimStatus.COMPLETED
    await db.flush()
    return entry


async def _claim_budget_node_scopes(
    db: AsyncSession, node_ids: set[uuid.UUID]
) -> dict[uuid.UUID, tuple[uuid.UUID, uuid.UUID, bool]]:
    if not node_ids:
        return {}
    child = aliased(FinanceBudgetNode)
    has_child = (
        select(child.id).where(child.parent_id == FinanceBudgetNode.id, child.is_active).exists()
    )
    rows = await db.execute(
        select(
            FinanceBudgetNode.id,
            FinanceBudget.ledger_id,
            FinanceBudget.period_id,
            has_child,
        )
        .join(FinanceBudget, FinanceBudget.id == FinanceBudgetNode.budget_id)
        .where(FinanceBudgetNode.id.in_(node_ids))
    )
    return {
        node_id: (ledger_id, period_id, child_exists)
        for node_id, ledger_id, period_id, child_exists in rows
    }


def _validate_claim_budget_node(
    scope: tuple[uuid.UUID, uuid.UUID, bool] | None,
    ledger_id: uuid.UUID,
    period_id: uuid.UUID,
) -> None:
    if scope is None:
        raise HTTPException(400, "預算條目不存在")
    if scope[:2] != (ledger_id, period_id):
        raise HTTPException(400, "預算條目不屬於此帳本或會計期間")
    if scope[2]:
        raise HTTPException(400, "報帳只能對應最末層預算條目")


async def _add_claim_items(
    db: AsyncSession,
    entry_id: uuid.UUID,
    items: list[ExpenseClaimItemCreate],
    user_id: uuid.UUID,
) -> None:
    claim_items = [
        ExpenseClaimItem(
            journal_entry_id=entry_id,
            **item.model_dump(exclude={"evidence"}),
        )
        for item in items
    ]
    db.add_all(claim_items)
    await db.flush()
    db.add_all(
        [
            ExpenseClaimItemEvidence(
                item_id=claim_item.id,
                uploaded_by_id=user_id,
                **evidence.model_dump(),
            )
            for claim_item, item in zip(claim_items, items, strict=True)
            for evidence in item.evidence
        ]
    )
    await db.flush()


async def create_expense_claim(
    db: AsyncSession, ledger_id: uuid.UUID, body: ExpenseClaimCreate, user_id: uuid.UUID
) -> JournalEntry:
    fund = await db.get(FundAccount, body.fund_account_id)
    if not fund or fund.ledger_id != ledger_id or not fund.is_active:
        raise HTTPException(400, "付款資金保管點不存在或已停用")
    expense_account = await db.get(ChartAccount, body.expense_account_id)
    if (
        not expense_account
        or expense_account.ledger_id != ledger_id
        or expense_account.account_type != FinanceAccountType.EXPENSE
        or not expense_account.is_active
    ):
        raise HTTPException(400, "支出科目不存在、非支出科目或已停用")
    amount = sum(
        _claim_item_total(item.unit_price, item.tax_rate, item.quantity) for item in body.items
    )
    payment_account_id = fund.chart_account_id
    if body.payment_method == ExpensePaymentMethod.ADVANCE:
        payable = await db.scalar(
            select(ChartAccount).where(
                ChartAccount.ledger_id == ledger_id,
                ChartAccount.account_type == FinanceAccountType.LIABILITY,
                ChartAccount.code == "2101",
            )
        )
        if not payable:
            raise HTTPException(400, "找不到代墊應付款科目")
        payment_account_id = payable.id
    budget_scopes = await _claim_budget_node_scopes(
        db, {item.budget_node_id for item in body.items if item.budget_node_id is not None}
    )
    for item in body.items:
        if item.budget_node_id:
            _validate_claim_budget_node(
                budget_scopes.get(item.budget_node_id), ledger_id, body.period_id
            )
        for evidence in item.evidence:
            validate_evidence_key(evidence.storage_key, ledger_id)
    entry = await create_journal(
        db,
        ledger_id,
        JournalCreate(
            period_id=body.period_id,
            entry_date=body.entry_date,
            description=f"報帳｜{body.description}（{len(body.items)} 項）",
            source_type="expense_claim",
            source_event="expense_claim",
            evidence_url=body.evidence_url,
            source_url=body.source_url,
            note=body.note,
            lines=[
                {"account_id": expense_account.id, "debit": amount},
                {"account_id": payment_account_id, "credit": amount},
            ],
        ),
        user_id,
        pending=True,
    )
    entry.claim_status = ExpenseClaimStatus.PENDING_REVIEW
    entry.procurement_status = ExpenseProcurementStatus.NOT_REQUIRED
    entry.payment_status = ExpensePaymentStatus.UNPAID
    entry.budget_included = False
    entry.proposing_org_id = body.proposing_org_id
    entry.advanced_by_id = body.advanced_by_id
    entry.payment_method = body.payment_method
    await _add_claim_items(db, entry.id, body.items, user_id)
    return entry


async def update_expense_claim(
    db: AsyncSession,
    entry: JournalEntry,
    body: ExpenseClaimCreate,
    user_id: uuid.UUID,
) -> JournalEntry:
    if entry.source_type != "expense_claim":
        raise HTTPException(400, "只有報帳案件可以修改")
    if entry.created_by_id != user_id:
        raise HTTPException(403, "只能修改自己提出的報帳")
    budgeted_reimbursement_edit = (
        entry.status == JournalStatus.POSTED
        and entry.claim_status == ExpenseClaimStatus.APPROVED
        and entry.budget_included is True
        and entry.payment_status in (None, ExpensePaymentStatus.UNPAID)
    )
    if not budgeted_reimbursement_edit and entry.status not in (
        JournalStatus.PENDING_REVIEW,
        JournalStatus.RETURNED,
    ):
        raise HTTPException(400, "只有待覆核、退回補正或已列入預算但尚未付款的報帳可以修改")
    if budgeted_reimbursement_edit and (
        body.period_id != entry.period_id
        or body.entry_date != entry.entry_date
        or body.payment_method != entry.payment_method
    ):
        raise HTTPException(400, "核銷階段只能調整報帳品項與金額")
    approved_budget_node_ids: set[uuid.UUID] = set()
    if budgeted_reimbursement_edit:
        item_node_ids = {item.budget_node_id for item in body.items}
        if None in item_node_ids or not item_node_ids:
            raise HTTPException(400, "進入核銷階段後，所有報帳品項都必須對應預算條目")
        approved_budget_node_ids = set(
            (
                await db.execute(
                    select(FinanceBudgetAllocation.node_id)
                    .join(FinanceBudgetSubmission)
                    .where(
                        FinanceBudgetAllocation.node_id.in_(item_node_ids),
                        FinanceBudgetSubmission.status == BudgetSubmissionStatus.APPROVED,
                    )
                )
            ).scalars()
        )
        if item_node_ids != approved_budget_node_ids:
            raise HTTPException(400, "進入核銷階段後，只能修改對應已核准預算的報帳品項")
    await validate_period(db, entry.ledger_id, body.period_id, body.entry_date)
    validate_evidence_key(body.evidence_url, entry.ledger_id)

    fund = await db.get(FundAccount, body.fund_account_id)
    if not fund or fund.ledger_id != entry.ledger_id or not fund.is_active:
        raise HTTPException(400, "付款資金保管點不存在或已停用")
    expense_account = await db.get(ChartAccount, body.expense_account_id)
    if (
        not expense_account
        or expense_account.ledger_id != entry.ledger_id
        or expense_account.account_type != FinanceAccountType.EXPENSE
        or not expense_account.is_active
    ):
        raise HTTPException(400, "支出科目不存在、非支出科目或已停用")
    amount = sum(
        _claim_item_total(item.unit_price, item.tax_rate, item.quantity) for item in body.items
    )
    payment_account_id = fund.chart_account_id
    if body.payment_method == ExpensePaymentMethod.ADVANCE:
        payable = await db.scalar(
            select(ChartAccount).where(
                ChartAccount.ledger_id == entry.ledger_id,
                ChartAccount.account_type == FinanceAccountType.LIABILITY,
                ChartAccount.code == "2101",
            )
        )
        if not payable:
            raise HTTPException(400, "找不到代墊應付款科目")
        payment_account_id = payable.id
    budget_scopes = await _claim_budget_node_scopes(
        db, {item.budget_node_id for item in body.items if item.budget_node_id is not None}
    )
    for item in body.items:
        if item.budget_node_id:
            _validate_claim_budget_node(
                budget_scopes.get(item.budget_node_id), entry.ledger_id, body.period_id
            )
        for evidence in item.evidence:
            validate_evidence_key(evidence.storage_key, entry.ledger_id)

    lines = list(
        (await db.execute(select(JournalLine).where(JournalLine.entry_id == entry.id))).scalars()
    )
    if len(lines) != 2:
        raise HTTPException(400, "報帳傳票明細格式不正確，無法修改")
    debit_line, credit_line = lines
    if debit_line.debit == 0 and credit_line.debit > 0:
        debit_line, credit_line = credit_line, debit_line
    if debit_line.debit == 0 or credit_line.credit == 0:
        raise HTTPException(400, "報帳傳票借貸明細不正確，無法修改")
    if budgeted_reimbursement_edit and (
        expense_account.id != debit_line.account_id
        or (
            entry.payment_method == ExpensePaymentMethod.DIRECT
            and fund.chart_account_id != credit_line.account_id
        )
    ):
        raise HTTPException(400, "核銷階段不可變更付款或支出科目")
    debit_line.account_id = expense_account.id
    debit_line.debit = amount
    debit_line.credit = 0
    credit_line.account_id = payment_account_id
    credit_line.debit = 0
    credit_line.credit = amount

    old_item_ids = select(ExpenseClaimItem.id).where(ExpenseClaimItem.journal_entry_id == entry.id)
    await db.execute(
        delete(ExpenseClaimItemEvidence).where(ExpenseClaimItemEvidence.item_id.in_(old_item_ids))
    )
    await db.execute(delete(ExpenseClaimItem).where(ExpenseClaimItem.journal_entry_id == entry.id))
    await db.flush()

    entry.period_id = body.period_id
    entry.entry_date = body.entry_date
    entry.description = f"報帳｜{body.description}（{len(body.items)} 項）"
    entry.source_url = body.source_url
    if body.evidence_url is not None:
        entry.evidence_url = body.evidence_url
    entry.note = body.note
    entry.proposing_org_id = body.proposing_org_id
    entry.advanced_by_id = body.advanced_by_id
    entry.payment_method = body.payment_method
    if not budgeted_reimbursement_edit:
        entry.payment_status = ExpensePaymentStatus.UNPAID
        entry.procurement_status = ExpenseProcurementStatus.NOT_REQUIRED
        entry.budget_included = False
        if entry.status == JournalStatus.RETURNED:
            entry.status = JournalStatus.PENDING_REVIEW
            entry.claim_status = ExpenseClaimStatus.PENDING_REVIEW
            entry.reviewed_by_id = None

    await _add_claim_items(db, entry.id, body.items, user_id)
    return entry
