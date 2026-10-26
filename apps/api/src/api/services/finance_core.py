"""財務共用驗證、帳本與基礎資料操作。"""

from __future__ import annotations

import re
import uuid
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import Base
from api.models.finance import (
    ChartAccount,
    ExpenseClaimItemEvidence,
    FinanceAccountType,
    FinanceBudget,
    FinanceBudgetAllocationEvidence,
    FinanceBudgetExpenseEvidence,
    FinanceLedger,
    FiscalPeriod,
    FundAccount,
    FundStorageType,
)
from api.schemas.finance import (
    BudgetCreate,
    BudgetUpdate,
)

DEFAULT_ACCOUNTS = (
    ("1101", "零用金", FinanceAccountType.ASSET),
    ("1102", "保險箱現金", FinanceAccountType.ASSET),
    ("1103", "銀行存款", FinanceAccountType.ASSET),
    ("1201", "應收款", FinanceAccountType.ASSET),
    ("2101", "應付款", FinanceAccountType.LIABILITY),
    ("3101", "累積餘絀", FinanceAccountType.EQUITY),
    ("4101", "活動收入", FinanceAccountType.REVENUE),
    ("4102", "商品收入", FinanceAccountType.REVENUE),
    ("4103", "學餐收入", FinanceAccountType.REVENUE),
    ("5101", "活動支出", FinanceAccountType.EXPENSE),
    ("5102", "行政支出", FinanceAccountType.EXPENSE),
    ("5103", "退款支出", FinanceAccountType.EXPENSE),
)

_EVIDENCE_KEY_RE = re.compile(r"^[0-9a-f]{32}\.(?:jpg|jpeg|png|webp|pdf)$")


def validate_evidence_key(evidence_key: str | None, ledger_id: uuid.UUID) -> None:
    """僅接受由本帳本私有上傳端點建立的儲存鍵，拒絕外部 URL 與跨帳本附件。"""
    if evidence_key is None:
        return
    prefix = f"finance/evidence/{ledger_id}/"
    filename = evidence_key.removeprefix(prefix)
    if (
        not evidence_key.startswith(prefix)
        or "/" in filename
        or not _EVIDENCE_KEY_RE.fullmatch(filename)
    ):
        raise HTTPException(400, "憑證必須透過本帳本的私有上傳端點取得")


def _claim_item_total(unit_price: int, tax_rate: int, quantity: Decimal | float) -> int:
    total = Decimal(unit_price) * (Decimal(100 + tax_rate) / Decimal(100)) * Decimal(quantity)
    return int(total.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


async def clear_all_finance_data(db: AsyncSession) -> tuple[int, list[str]]:
    evidence_models = (
        FinanceBudgetAllocationEvidence,
        FinanceBudgetExpenseEvidence,
        ExpenseClaimItemEvidence,
    )
    storage_keys: list[str] = []
    for model in evidence_models:
        storage_keys.extend((await db.scalars(select(model.storage_key))).all())

    deleted_rows = 0
    for table in reversed(Base.metadata.sorted_tables):
        if not table.name.startswith("finance_"):
            continue
        result = await db.execute(delete(table))
        deleted_rows += max(result.rowcount or 0, 0)
    return deleted_rows, list(dict.fromkeys(storage_keys))


async def initialize_ledger(db: AsyncSession, org_id: uuid.UUID, name: str) -> FinanceLedger:
    existing = await db.scalar(select(FinanceLedger).where(FinanceLedger.org_id == org_id))
    if existing:
        return existing
    ledger = FinanceLedger(org_id=org_id, name=name)
    db.add(ledger)
    await db.flush()
    accounts: dict[str, ChartAccount] = {}
    for code, account_name, kind in DEFAULT_ACCOUNTS:
        account = ChartAccount(
            ledger_id=ledger.id, code=code, name=account_name, account_type=kind, is_system=True
        )
        accounts[code] = account
        db.add(account)
    await db.flush()
    for name_, storage, code in (
        ("零用金", FundStorageType.PETTY_CASH, "1101"),
        ("保險箱", FundStorageType.SAFE, "1102"),
        ("銀行帳戶", FundStorageType.BANK, "1103"),
    ):
        db.add(
            FundAccount(
                ledger_id=ledger.id,
                chart_account_id=accounts[code].id,
                name=name_,
                storage_type=storage,
            )
        )
    await db.flush()
    return ledger


async def list_ledgers(db: AsyncSession) -> list[FinanceLedger]:
    return list((await db.scalars(select(FinanceLedger).order_by(FinanceLedger.name))).all())


async def get_ledger(db: AsyncSession, ledger_id: uuid.UUID) -> FinanceLedger:
    ledger = await db.get(FinanceLedger, ledger_id)
    if not ledger:
        raise HTTPException(404, "帳本不存在")
    return ledger


async def get_budget(db: AsyncSession, budget_id: uuid.UUID) -> FinanceBudget:
    budget = await db.get(FinanceBudget, budget_id)
    if not budget:
        raise HTTPException(404, "預算不存在")
    return budget


async def create_budget(
    db: AsyncSession, ledger_id: uuid.UUID, body: BudgetCreate
) -> FinanceBudget:
    period = await db.get(FiscalPeriod, body.period_id)
    if not period or period.ledger_id != ledger_id:
        raise HTTPException(400, "會計期間不屬於此帳本")
    existing = await db.scalar(
        select(FinanceBudget).where(
            FinanceBudget.ledger_id == ledger_id, FinanceBudget.period_id == body.period_id
        )
    )
    if existing:
        raise HTTPException(409, "此會計期間已有共同預算")
    budget = FinanceBudget(ledger_id=ledger_id, **body.model_dump())
    db.add(budget)
    await db.flush()
    return budget


async def update_budget_name(
    db: AsyncSession, budget_id: uuid.UUID, body: BudgetUpdate
) -> FinanceBudget:
    budget = await get_budget(db, budget_id)
    budget.name = body.name
    await db.flush()
    return budget


async def list_budgets(db: AsyncSession, ledger_id: uuid.UUID) -> list[FinanceBudget]:
    return list(
        (
            await db.execute(
                select(FinanceBudget)
                .where(FinanceBudget.ledger_id == ledger_id)
                .order_by(FinanceBudget.created_at.desc())
            )
        ).scalars()
    )
