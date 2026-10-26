"""分錄、付款與報帳流程。"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

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
    FinanceBudgetAllocation,
    FinanceBudgetNode,
    FinanceBudgetSubmission,
    FiscalPeriod,
    FundAccount,
    JournalEntry,
    JournalLine,
    JournalStatus,
)
from api.models.user import User
from api.schemas.finance import (
    ChartAccountUpdate,
    ExpenseBudgetUpdate,
    ExpenseClaimCreate,
    ExpenseProcurementUpdate,
    ExpenseReimbursementCreate,
    JournalCreate,
    ManualJournalUpdate,
    TransferCreate,
)
from api.services.finance_core import _claim_item_total, get_budget, validate_evidence_key


async def update_chart_account(
    db: AsyncSession,
    ledger_id: uuid.UUID,
    account_id: uuid.UUID,
    body: ChartAccountUpdate,
) -> ChartAccount:
    account = await db.get(ChartAccount, account_id)
    if not account or account.ledger_id != ledger_id:
        raise HTTPException(404, "會計科目不存在")
    if body.name is not None:
        account.name = body.name
    if body.is_active is not None:
        if account.is_system and not body.is_active:
            raise HTTPException(400, "系統預設科目不可停用")
        account.is_active = body.is_active
    await db.flush()
    return account


async def validate_period(
    db: AsyncSession, ledger_id: uuid.UUID, period_id: uuid.UUID, entry_date: date
) -> FiscalPeriod:
    period = await db.get(FiscalPeriod, period_id)
    if not period or period.ledger_id != ledger_id:
        raise HTTPException(400, "會計期間不屬於此帳本")
    if period.is_closed:
        raise HTTPException(400, "會計期間已關閉")
    if not period.starts_on <= entry_date <= period.ends_on:
        raise HTTPException(400, "分錄日期不在會計期間內")
    return period


async def create_journal(
    db: AsyncSession,
    ledger_id: uuid.UUID,
    body: JournalCreate,
    user_id: uuid.UUID,
    *,
    pending: bool = False,
) -> JournalEntry:
    await validate_period(db, ledger_id, body.period_id, body.entry_date)
    validate_evidence_key(body.evidence_url, ledger_id)
    if body.source_type == "council_proposal":
        from api.models.council_proposal import CouncilProposal

        if not body.source_id or not await db.get(CouncilProposal, body.source_id):
            raise HTTPException(400, "議會提案關聯不存在")
    account_ids = {line.account_id for line in body.lines}
    count = await db.scalar(
        select(func.count())
        .select_from(ChartAccount)
        .where(
            ChartAccount.ledger_id == ledger_id,
            ChartAccount.id.in_(account_ids),
            ChartAccount.is_active,
        )
    )  # noqa: E712
    if count != len(account_ids):
        raise HTTPException(400, "分錄包含無效或停用科目")
    entry = JournalEntry(
        ledger_id=ledger_id,
        created_by_id=user_id,
        status=JournalStatus.PENDING_REVIEW if pending else JournalStatus.DRAFT,
        **body.model_dump(exclude={"lines"}),
    )
    db.add(entry)
    await db.flush()
    db.add_all([JournalLine(entry_id=entry.id, **line.model_dump()) for line in body.lines])
    await db.flush()
    return entry


async def update_manual_journal(
    db: AsyncSession,
    entry: JournalEntry,
    body: ManualJournalUpdate,
    user_id: uuid.UUID,
) -> JournalEntry:
    if entry.source_type != "manual_entry" or entry.source_event not in {"opening", "income"}:
        raise HTTPException(400, "只有期初餘額或收入傳票可以從此處修改")
    await validate_period(db, entry.ledger_id, body.period_id, body.entry_date)
    validate_evidence_key(body.evidence_url, entry.ledger_id)
    fund = await db.get(FundAccount, body.fund_account_id)
    if not fund or fund.ledger_id != entry.ledger_id or not fund.is_active:
        raise HTTPException(400, "資金保管點不存在或已停用")
    counterpart = await db.get(ChartAccount, body.counterpart_account_id)
    expected_type = (
        FinanceAccountType.EQUITY if entry.source_event == "opening" else FinanceAccountType.REVENUE
    )
    if (
        not counterpart
        or counterpart.ledger_id != entry.ledger_id
        or counterpart.account_type != expected_type
        or not counterpart.is_active
    ):
        raise HTTPException(400, "對應會計科目不存在、類型不符或已停用")

    if entry.status == JournalStatus.POSTED:
        if entry.source_event != "opening":
            raise HTTPException(400, "已過帳收入請另建調整傳票")
        pending_adjustment = await db.scalar(
            select(JournalEntry.id).where(
                JournalEntry.source_type == "manual_entry",
                JournalEntry.source_event.like("opening_adjustment:%"),
                JournalEntry.source_id == entry.id,
                JournalEntry.status.in_(
                    [JournalStatus.DRAFT, JournalStatus.PENDING_REVIEW, JournalStatus.RETURNED]
                ),
            )
        )
        if pending_adjustment:
            raise HTTPException(409, "這筆期初餘額已有待覆核調整，請先完成處理")
        posted_adjustment_ids = list(
            (
                await db.execute(
                    select(JournalEntry.id).where(
                        JournalEntry.source_type == "manual_entry",
                        JournalEntry.source_event.like("opening_adjustment:%"),
                        JournalEntry.source_id == entry.id,
                        JournalEntry.status == JournalStatus.POSTED,
                    )
                )
            ).scalars()
        )
        current_balances = {
            account_id: int(balance)
            for account_id, balance in (
                await db.execute(
                    select(
                        JournalLine.account_id,
                        func.sum(JournalLine.debit - JournalLine.credit),
                    )
                    .where(JournalLine.entry_id.in_([entry.id, *posted_adjustment_ids]))
                    .group_by(JournalLine.account_id)
                )
            ).all()
        }
        net_changes = {
            account_id: -balance for account_id, balance in current_balances.items() if balance
        }
        net_changes[fund.chart_account_id] = net_changes.get(fund.chart_account_id, 0) + body.amount
        net_changes[counterpart.id] = net_changes.get(counterpart.id, 0) - body.amount
        if all(change == 0 for change in net_changes.values()):
            raise HTTPException(400, "期初餘額沒有變更")
        return await create_journal(
            db,
            entry.ledger_id,
            JournalCreate(
                period_id=body.period_id,
                entry_date=body.entry_date,
                description=f"期初餘額調整｜{body.description.strip()}",
                lines=[
                    {
                        "account_id": account_id,
                        "debit": change if change > 0 else 0,
                        "credit": -change if change < 0 else 0,
                    }
                    for account_id, change in net_changes.items()
                    if change
                ],
                source_type="manual_entry",
                source_id=entry.id,
                source_event=f"opening_adjustment:{uuid.uuid4().hex[:12]}",
                source_url=body.source_url,
                evidence_url=body.evidence_url,
                note=body.note,
            ),
            user_id,
            pending=True,
        )
    if entry.status not in {
        JournalStatus.DRAFT,
        JournalStatus.PENDING_REVIEW,
        JournalStatus.RETURNED,
    }:
        raise HTTPException(400, "這筆傳票目前不可修改")

    entry.period_id = body.period_id
    entry.entry_date = body.entry_date
    entry.description = body.description.strip()
    entry.source_url = body.source_url
    entry.evidence_url = body.evidence_url
    entry.note = body.note
    entry.status = JournalStatus.PENDING_REVIEW
    entry.reviewed_by_id = None
    entry.posted_at = None
    await db.execute(delete(JournalLine).where(JournalLine.entry_id == entry.id))
    db.add_all(
        [
            JournalLine(entry_id=entry.id, account_id=fund.chart_account_id, debit=body.amount),
            JournalLine(entry_id=entry.id, account_id=counterpart.id, credit=body.amount),
        ]
    )
    await db.flush()
    return entry


async def submit_journal(db: AsyncSession, entry: JournalEntry) -> JournalEntry:
    if entry.status not in (JournalStatus.DRAFT, JournalStatus.RETURNED):
        raise HTTPException(400, "此傳票無法送覆核")
    entry.status = JournalStatus.PENDING_REVIEW
    if entry.source_type == "expense_claim":
        entry.claim_status = ExpenseClaimStatus.PENDING_REVIEW
    await db.flush()
    return entry


async def post_journal(
    db: AsyncSession, entry: JournalEntry, reviewer_id: uuid.UUID
) -> JournalEntry:
    # 財務過帳是不可逆的狀態轉換；鎖定傳票避免兩個覆核者同時通過檢查後重複過帳。
    locked_entry = await db.scalar(
        select(JournalEntry).where(JournalEntry.id == entry.id).with_for_update()
    )
    if locked_entry is None:
        raise HTTPException(404, "傳票不存在")
    entry = locked_entry
    if entry.status != JournalStatus.PENDING_REVIEW:
        raise HTTPException(400, "僅待覆核傳票可過帳")
    await validate_period(db, entry.ledger_id, entry.period_id, entry.entry_date)
    lines = list(
        (await db.execute(select(JournalLine).where(JournalLine.entry_id == entry.id))).scalars()
    )
    if len(lines) < 2 or sum(x.debit for x in lines) != sum(x.credit for x in lines):
        raise HTTPException(400, "傳票借貸不平衡")
    entry.status = JournalStatus.POSTED
    entry.reviewed_by_id = reviewer_id
    entry.posted_at = datetime.now(UTC)
    if entry.source_type == "expense_claim":
        entry.claim_status = ExpenseClaimStatus.APPROVED
    await db.flush()
    return entry


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


async def create_transfer(
    db: AsyncSession, ledger_id: uuid.UUID, body: TransferCreate, user_id: uuid.UUID
) -> JournalEntry:
    if body.from_fund_account_id == body.to_fund_account_id:
        raise HTTPException(400, "轉出與轉入帳戶不得相同")
    funds = list(
        (
            await db.execute(
                select(FundAccount).where(
                    FundAccount.id.in_([body.from_fund_account_id, body.to_fund_account_id]),
                    FundAccount.ledger_id == ledger_id,
                    FundAccount.is_active,
                )
            )
        ).scalars()
    )  # noqa: E712
    if len(funds) != 2:
        raise HTTPException(400, "資金帳戶不存在或不屬於此帳本")
    lookup = {fund.id: fund for fund in funds}
    return await create_journal(
        db,
        ledger_id,
        JournalCreate(
            period_id=body.period_id,
            entry_date=body.entry_date,
            description=body.description,
            note=body.note,
            source_type="fund_transfer",
            source_event="transfer",
            lines=[
                {
                    "account_id": lookup[body.to_fund_account_id].chart_account_id,
                    "debit": body.amount,
                },
                {
                    "account_id": lookup[body.from_fund_account_id].chart_account_id,
                    "credit": body.amount,
                },
            ],
        ),
        user_id,
    )


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
    for item in body.items:
        if item.budget_node_id:
            node = await db.get(FinanceBudgetNode, item.budget_node_id)
            if not node:
                raise HTTPException(400, "預算條目不存在")
            budget = await get_budget(db, node.budget_id)
            if budget.ledger_id != ledger_id or budget.period_id != body.period_id:
                raise HTTPException(400, "預算條目不屬於此帳本或會計期間")
            has_child = await db.scalar(
                select(FinanceBudgetNode.id)
                .where(FinanceBudgetNode.parent_id == node.id, FinanceBudgetNode.is_active)
                .limit(1)
            )
            if has_child:
                raise HTTPException(400, "報帳只能對應最末層預算條目")
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
    for item in body.items:
        claim_item = ExpenseClaimItem(
            journal_entry_id=entry.id,
            name=item.name,
            unit_price=item.unit_price,
            tax_rate=item.tax_rate,
            quantity=item.quantity,
            unit=item.unit,
            budget_node_id=item.budget_node_id,
            budget_exception_note=item.budget_exception_note,
        )
        db.add(claim_item)
        await db.flush()
        db.add_all(
            [
                ExpenseClaimItemEvidence(
                    item_id=claim_item.id,
                    storage_key=evidence.storage_key,
                    filename=evidence.filename,
                    content_type=evidence.content_type,
                    file_size=evidence.file_size,
                    evidence_type=evidence.evidence_type,
                    note=evidence.note,
                    uploaded_by_id=user_id,
                )
                for evidence in item.evidence
            ]
        )
    await db.flush()
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
    for item in body.items:
        if item.budget_node_id:
            node = await db.get(FinanceBudgetNode, item.budget_node_id)
            if not node:
                raise HTTPException(400, "預算條目不存在")
            budget = await get_budget(db, node.budget_id)
            if budget.ledger_id != entry.ledger_id or budget.period_id != body.period_id:
                raise HTTPException(400, "預算條目不屬於此帳本或會計期間")
            has_child = await db.scalar(
                select(FinanceBudgetNode.id)
                .where(FinanceBudgetNode.parent_id == node.id, FinanceBudgetNode.is_active)
                .limit(1)
            )
            if has_child:
                raise HTTPException(400, "報帳只能對應最末層預算條目")
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

    old_items = list(
        (
            await db.execute(
                select(ExpenseClaimItem).where(ExpenseClaimItem.journal_entry_id == entry.id)
            )
        ).scalars()
    )
    old_evidence = list(
        (
            await db.execute(
                select(ExpenseClaimItemEvidence).where(
                    ExpenseClaimItemEvidence.item_id.in_([item.id for item in old_items])
                )
            )
        ).scalars()
        if old_items
        else []
    )
    for evidence in old_evidence:
        await db.delete(evidence)
    for item in old_items:
        await db.delete(item)
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

    for item in body.items:
        claim_item = ExpenseClaimItem(
            journal_entry_id=entry.id,
            name=item.name,
            unit_price=item.unit_price,
            tax_rate=item.tax_rate,
            quantity=item.quantity,
            unit=item.unit,
            budget_node_id=item.budget_node_id,
            budget_exception_note=item.budget_exception_note,
        )
        db.add(claim_item)
        await db.flush()
        db.add_all(
            [
                ExpenseClaimItemEvidence(
                    item_id=claim_item.id,
                    storage_key=evidence.storage_key,
                    filename=evidence.filename,
                    content_type=evidence.content_type,
                    file_size=evidence.file_size,
                    evidence_type=evidence.evidence_type,
                    note=evidence.note,
                    uploaded_by_id=user_id,
                )
                for evidence in item.evidence
            ]
        )
    await db.flush()
    return entry


async def account_balances(db: AsyncSession, ledger_id: uuid.UUID) -> dict[uuid.UUID, int]:
    rows = (
        await db.execute(
            select(
                JournalLine.account_id,
                func.coalesce(func.sum(JournalLine.debit - JournalLine.credit), 0),
            )
            .join(JournalEntry)
            .where(JournalEntry.ledger_id == ledger_id, JournalEntry.status == JournalStatus.POSTED)
            .group_by(JournalLine.account_id)
        )
    ).all()
    return {row[0]: int(row[1]) for row in rows}


async def journal_with_lines(db: AsyncSession, entry: JournalEntry) -> dict:
    lines = list(
        (
            await db.execute(
                select(JournalLine, ChartAccount.name, ChartAccount.account_type)
                .join(ChartAccount)
                .where(JournalLine.entry_id == entry.id)
                .order_by(JournalLine.debit.desc(), JournalLine.created_at, JournalLine.id)
            )
        ).all()
    )
    creator_name = await db.scalar(select(User.display_name).where(User.id == entry.created_by_id))
    evidence_count = 0
    if entry.source_type == "expense_claim":
        evidence_count = int(
            await db.scalar(
                select(func.count())
                .select_from(ExpenseClaimItemEvidence)
                .join(ExpenseClaimItem)
                .where(ExpenseClaimItem.journal_entry_id == entry.id)
            )
            or 0
        )
    effective_amount = None
    if entry.source_type == "manual_entry" and entry.source_event == "opening":
        original_amount = sum(
            line.debit - line.credit
            for line, _, account_type in lines
            if account_type == FinanceAccountType.ASSET
        )
        posted_adjustments = int(
            await db.scalar(
                select(func.coalesce(func.sum(JournalLine.debit - JournalLine.credit), 0))
                .join(JournalEntry, JournalEntry.id == JournalLine.entry_id)
                .join(ChartAccount, ChartAccount.id == JournalLine.account_id)
                .where(
                    JournalEntry.source_type == "manual_entry",
                    JournalEntry.source_event.like("opening_adjustment:%"),
                    JournalEntry.source_id == entry.id,
                    JournalEntry.status == JournalStatus.POSTED,
                    ChartAccount.account_type == FinanceAccountType.ASSET,
                )
            )
            or 0
        )
        effective_amount = original_amount + posted_adjustments
    return {
        "id": entry.id,
        "reference_no": f"FIN-{entry.entry_date:%y%m%d}-{entry.id.hex[:6].upper()}",
        "ledger_id": entry.ledger_id,
        "period_id": entry.period_id,
        "entry_date": entry.entry_date,
        "description": entry.description,
        "status": entry.status,
        "created_by_id": entry.created_by_id,
        "created_by_name": creator_name or "已停用使用者",
        "reviewed_by_id": entry.reviewed_by_id,
        "posted_at": entry.posted_at,
        "source_type": entry.source_type,
        "source_id": entry.source_id,
        "source_event": entry.source_event,
        "source_url": entry.source_url,
        "evidence_url": entry.evidence_url,
        "note": entry.note,
        "claim_status": entry.claim_status,
        "procurement_status": entry.procurement_status,
        "procurement_updated_by_id": entry.procurement_updated_by_id,
        "procurement_updated_at": entry.procurement_updated_at,
        "payment_status": entry.payment_status,
        "payment_by_id": entry.payment_by_id,
        "payment_at": entry.payment_at,
        "budget_included": entry.budget_included,
        "budget_included_by_id": entry.budget_included_by_id,
        "budget_included_at": entry.budget_included_at,
        "proposing_org_id": entry.proposing_org_id,
        "advanced_by_id": entry.advanced_by_id,
        "payment_method": entry.payment_method,
        "reimbursement_entry_id": entry.reimbursement_entry_id,
        "evidence_complete": bool(entry.evidence_url) or evidence_count > 0,
        "effective_amount": effective_amount,
        "lines": [
            {
                "id": line.id,
                "account_id": line.account_id,
                "debit": line.debit,
                "credit": line.credit,
                "memo": line.memo,
                "account_name": account_name,
            }
            for line, account_name, _ in lines
        ],
    }
