"""分錄、付款與報帳流程。"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.finance import (
    ChartAccount,
    ExpenseClaimItem,
    ExpenseClaimItemEvidence,
    ExpenseClaimStatus,
    FinanceAccountType,
    FiscalPeriod,
    FundAccount,
    JournalEntry,
    JournalLine,
    JournalStatus,
)
from api.models.user import User
from api.schemas.finance import (
    ChartAccountUpdate,
    JournalCreate,
    ManualJournalUpdate,
    TransferCreate,
)
from api.services.finance_core import validate_evidence_key


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


async def journals_with_lines(db: AsyncSession, entries: list[JournalEntry]) -> list[dict]:
    """批次讀取傳票明細，每 500 筆分批以限制 IN 參數及關聯查詢大小。"""
    result: list[dict] = []
    for start in range(0, len(entries), 500):
        result.extend(await _journal_batch(db, entries[start : start + 500]))
    return result


async def _journal_batch(db: AsyncSession, entries: list[JournalEntry]) -> list[dict]:
    entry_ids = [entry.id for entry in entries]
    line_rows = await db.execute(
        select(JournalLine, ChartAccount.name, ChartAccount.account_type)
        .join(ChartAccount)
        .where(JournalLine.entry_id.in_(entry_ids))
        .order_by(JournalLine.debit.desc(), JournalLine.created_at, JournalLine.id)
    )
    lines_by_entry: dict[uuid.UUID, list[tuple[JournalLine, str, str]]] = {}
    for line, account_name, account_type in line_rows:
        lines_by_entry.setdefault(line.entry_id, []).append((line, account_name, account_type))
    creator_names = dict(
        (
            await db.execute(
                select(User.id, User.display_name).where(
                    User.id.in_({entry.created_by_id for entry in entries})
                )
            )
        ).all()
    )
    claim_ids = [entry.id for entry in entries if entry.source_type == "expense_claim"]
    evidence_counts: dict[uuid.UUID, int] = {}
    if claim_ids:
        evidence_counts = dict(
            (
                await db.execute(
                    select(ExpenseClaimItem.journal_entry_id, func.count())
                    .join(ExpenseClaimItemEvidence)
                    .where(ExpenseClaimItem.journal_entry_id.in_(claim_ids))
                    .group_by(ExpenseClaimItem.journal_entry_id)
                )
            ).all()
        )
    opening_ids = {
        entry.id
        for entry in entries
        if entry.source_type == "manual_entry" and entry.source_event == "opening"
    }
    adjustments: dict[uuid.UUID, int] = {}
    if opening_ids:
        adjustments = dict(
            (
                await db.execute(
                    select(JournalEntry.source_id, func.sum(JournalLine.debit - JournalLine.credit))
                    .join(JournalLine, JournalLine.entry_id == JournalEntry.id)
                    .join(ChartAccount, ChartAccount.id == JournalLine.account_id)
                    .where(
                        JournalEntry.source_type == "manual_entry",
                        JournalEntry.source_event.like("opening_adjustment:%"),
                        JournalEntry.source_id.in_(opening_ids),
                        JournalEntry.status == JournalStatus.POSTED,
                        ChartAccount.account_type == FinanceAccountType.ASSET,
                    )
                    .group_by(JournalEntry.source_id)
                )
            ).all()
        )
    rows = []
    for entry in entries:
        lines = lines_by_entry.get(entry.id, [])
        effective_amount = None
        if entry.id in opening_ids:
            effective_amount = sum(
                line.debit - line.credit
                for line, _, account_type in lines
                if account_type == FinanceAccountType.ASSET
            ) + adjustments.get(entry.id, 0)
        rows.append(
            _journal_payload(
                entry,
                lines,
                creator_names.get(entry.created_by_id),
                evidence_counts.get(entry.id, 0),
                effective_amount,
            )
        )
    return rows


async def journal_with_lines(db: AsyncSession, entry: JournalEntry) -> dict:
    return (await journals_with_lines(db, [entry]))[0]


def _journal_payload(
    entry: JournalEntry,
    lines: list[tuple[JournalLine, str, str]],
    creator_name: str | None,
    evidence_count: int,
    effective_amount: int | None,
) -> dict:
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


_MOVED_CLAIM_SYMBOLS = {
    "_add_claim_items",
    "_claim_budget_node_scopes",
    "_validate_claim_budget_node",
    "complete_expense_claim",
    "create_expense_claim",
    "mark_expense_paid",
    "reimburse_expense_claim",
    "return_expense_claim",
    "update_expense_budget",
    "update_expense_claim",
    "update_expense_procurement",
}


def __getattr__(name: str):
    """Keep the former journal-module imports working after the claim split."""
    if name not in _MOVED_CLAIM_SYMBOLS:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

    from api.services import finance_claims

    return getattr(finance_claims, name)
