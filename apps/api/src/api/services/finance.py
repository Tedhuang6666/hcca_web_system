"""複式簿記服務；所有餘額均由已過帳分錄計算。"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, date, datetime

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.finance import (
    ChartAccount,
    ExpenseClaimItem,
    FinanceAccountType,
    FinanceLedger,
    FiscalPeriod,
    FundAccount,
    FundStorageType,
    JournalEntry,
    JournalLine,
    JournalStatus,
)
from api.schemas.finance import (
    ChartAccountUpdate,
    ExpenseClaimCreate,
    JournalCreate,
    TransferCreate,
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


async def get_ledger(db: AsyncSession, ledger_id: uuid.UUID) -> FinanceLedger:
    ledger = await db.get(FinanceLedger, ledger_id)
    if not ledger:
        raise HTTPException(404, "帳本不存在")
    return ledger


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


async def submit_journal(db: AsyncSession, entry: JournalEntry) -> JournalEntry:
    if entry.status not in (JournalStatus.DRAFT, JournalStatus.RETURNED):
        raise HTTPException(400, "此傳票無法送覆核")
    entry.status = JournalStatus.PENDING_REVIEW
    await db.flush()
    return entry


async def post_journal(
    db: AsyncSession, entry: JournalEntry, reviewer_id: uuid.UUID
) -> JournalEntry:
    if entry.status != JournalStatus.PENDING_REVIEW:
        raise HTTPException(400, "僅待覆核傳票可過帳")
    if entry.created_by_id == reviewer_id:
        raise HTTPException(403, "不得覆核自己登錄的傳票")
    await validate_period(db, entry.ledger_id, entry.period_id, entry.entry_date)
    lines = list(
        (await db.execute(select(JournalLine).where(JournalLine.entry_id == entry.id))).scalars()
    )
    if len(lines) < 2 or sum(x.debit for x in lines) != sum(x.credit for x in lines):
        raise HTTPException(400, "傳票借貸不平衡")
    entry.status = JournalStatus.POSTED
    entry.reviewed_by_id = reviewer_id
    entry.posted_at = datetime.now(UTC)
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
    amount = sum(item.unit_price * item.quantity for item in body.items)
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
            note=body.note,
            lines=[
                {"account_id": expense_account.id, "debit": amount},
                {"account_id": fund.chart_account_id, "credit": amount},
            ],
        ),
        user_id,
        pending=True,
    )
    db.add_all(
        [
            ExpenseClaimItem(
                journal_entry_id=entry.id,
                name=item.name,
                unit_price=item.unit_price,
                quantity=item.quantity,
            )
            for item in body.items
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
                select(JournalLine, ChartAccount.name)
                .join(ChartAccount)
                .where(JournalLine.entry_id == entry.id)
            )
        ).all()
    )
    return {
        "id": entry.id,
        "ledger_id": entry.ledger_id,
        "period_id": entry.period_id,
        "entry_date": entry.entry_date,
        "description": entry.description,
        "status": entry.status,
        "created_by_id": entry.created_by_id,
        "reviewed_by_id": entry.reviewed_by_id,
        "posted_at": entry.posted_at,
        "source_type": entry.source_type,
        "source_id": entry.source_id,
        "source_event": entry.source_event,
        "source_url": entry.source_url,
        "evidence_url": entry.evidence_url,
        "note": entry.note,
        "lines": [
            {
                "id": line.id,
                "account_id": line.account_id,
                "debit": line.debit,
                "credit": line.credit,
                "memo": line.memo,
                "account_name": account_name,
            }
            for line, account_name in lines
        ],
    }


async def export_google_sheets(
    db: AsyncSession, ledger: FinanceLedger, spreadsheet_id: str
) -> None:
    """把已過帳資料同步到使用組織已授權的 Google 試算表。"""
    from api.models.google_calendar import OrgGoogleCalendarConfig
    from api.services.google_calendar_service import get_valid_credentials

    config = await db.scalar(
        select(OrgGoogleCalendarConfig).where(OrgGoogleCalendarConfig.org_id == ledger.org_id)
    )
    if not config or not config.is_connected:
        raise HTTPException(400, "請先在行事曆設定完成 Google 授權，再重新授權以加入 Sheets 權限")
    credentials = await get_valid_credentials(db, config)
    journals = list(
        (
            await db.execute(
                select(JournalEntry)
                .where(
                    JournalEntry.ledger_id == ledger.id, JournalEntry.status == JournalStatus.POSTED
                )
                .order_by(JournalEntry.entry_date, JournalEntry.created_at)
            )
        ).scalars()
    )
    values = [["日期", "摘要", "狀態", "來源", "借方", "貸方"]]
    for entry in journals:
        for line, account_name in (
            await db.execute(
                select(JournalLine, ChartAccount.name)
                .join(ChartAccount)
                .where(JournalLine.entry_id == entry.id)
            )
        ).all():
            values.append(
                [
                    str(entry.entry_date),
                    entry.description,
                    "已過帳",
                    account_name,
                    line.debit,
                    line.credit,
                ]
            )

    def _write() -> None:
        from googleapiclient.discovery import build

        sheets = build("sheets", "v4", credentials=credentials, cache_discovery=False)
        sheets.spreadsheets().values().clear(
            spreadsheetId=spreadsheet_id, range="財務總帳!A:F", body={}
        ).execute()
        sheets.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range="財務總帳!A1",
            valueInputOption="RAW",
            body={"values": values},
        ).execute()

    await asyncio.to_thread(_write)
