"""預算項目下直接登記實際收入。"""

from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.finance import (
    BudgetSubmissionStatus,
    ChartAccount,
    FinanceAccountType,
    FinanceBudgetIncomeItem,
    FinanceBudgetIncomeRecord,
    FinanceBudgetSubmission,
    FiscalPeriod,
    JournalEntry,
    JournalLine,
    JournalStatus,
)
from api.schemas.finance import BudgetIncomeRecordCreate, BudgetIncomeRecordUpdate
from api.services.finance_budget_plan import ApprovedBudgetPlan
from api.services.finance_core import get_budget


async def income_records(db: AsyncSession, budget_id: uuid.UUID) -> list[dict]:
    rows = await db.execute(
        select(FinanceBudgetIncomeRecord, FinanceBudgetIncomeItem)
        .join(FinanceBudgetIncomeItem)
        .where(FinanceBudgetIncomeRecord.budget_id == budget_id)
        .order_by(
            FinanceBudgetIncomeRecord.entry_date.desc(), FinanceBudgetIncomeRecord.created_at.desc()
        )
    )
    records = [
        {
            "id": record.id,
            "income_item_id": item.id,
            "category": item.category,
            "name": item.name,
            "amount": record.amount,
            "entry_date": record.entry_date,
            "note": record.note,
        }
        for record, item in rows
    ]
    # The former income button created posted manual journals with this exact
    # description. Keep those receipts visible without moving or copying money.
    budget = await get_budget(db, budget_id)
    items = await db.scalars(
        select(FinanceBudgetIncomeItem)
        .join(FinanceBudgetSubmission)
        .where(
            FinanceBudgetSubmission.budget_id == budget_id,
            FinanceBudgetSubmission.status == BudgetSubmissionStatus.APPROVED,
        )
    )
    by_description = {f"收入｜{item.category}｜{item.name}": item for item in items}
    if by_description:
        legacy = await db.execute(
            select(JournalEntry, func.sum(JournalLine.credit - JournalLine.debit))
            .join(JournalLine, JournalLine.entry_id == JournalEntry.id)
            .join(ChartAccount, ChartAccount.id == JournalLine.account_id)
            .where(
                JournalEntry.ledger_id == budget.ledger_id,
                JournalEntry.period_id == budget.period_id,
                JournalEntry.status == JournalStatus.POSTED,
                JournalEntry.source_type == "manual_entry",
                JournalEntry.source_event == "income",
                JournalEntry.description.in_(by_description),
                ChartAccount.account_type == FinanceAccountType.REVENUE,
            )
            .group_by(JournalEntry.id)
        )
        for entry, amount in legacy:
            item = by_description[entry.description]
            records.append(
                {
                    "id": entry.id,
                    "income_item_id": item.id,
                    "category": item.category,
                    "name": item.name,
                    "amount": int(amount or 0),
                    "entry_date": entry.entry_date,
                    "note": entry.note,
                    "is_legacy": True,
                }
            )
    return sorted(records, key=lambda item: item["entry_date"], reverse=True)


async def save_income_record(
    db: AsyncSession,
    budget_id: uuid.UUID,
    body: BudgetIncomeRecordCreate | BudgetIncomeRecordUpdate,
    user_id: uuid.UUID,
    record_id: uuid.UUID | None = None,
) -> FinanceBudgetIncomeRecord:
    budget = await get_budget(db, budget_id)
    period = await db.get(FiscalPeriod, budget.period_id)
    if not period or period.is_closed:
        raise HTTPException(400, "會計期間已關閉，無法更新收入")
    if not period.starts_on <= body.entry_date <= period.ends_on:
        raise HTTPException(400, "收款日期必須在預算所屬會計期間內")
    if record_id:
        record = await db.get(FinanceBudgetIncomeRecord, record_id)
        if not record or record.budget_id != budget.id:
            raise HTTPException(404, "收款紀錄不存在")
        record.amount = body.amount
        record.entry_date = body.entry_date
        if "note" in body.model_fields_set:
            record.note = body.note
    else:
        assert isinstance(body, BudgetIncomeRecordCreate)
        item = await db.get(FinanceBudgetIncomeItem, body.income_item_id)
        submission = await db.get(FinanceBudgetSubmission, item.submission_id) if item else None
        if not item or not submission or submission.budget_id != budget.id:
            raise HTTPException(404, "預算收入不存在")
        plan = await ApprovedBudgetPlan.load(db, budget.id)
        if item.submission_id not in plan.submission_ids:
            raise HTTPException(400, "請選擇目前總表的收入項目")
        record = FinanceBudgetIncomeRecord(
            budget_id=budget.id,
            recorded_by_id=user_id,
            **body.model_dump(),
        )
        db.add(record)
    await db.flush()
    return record
