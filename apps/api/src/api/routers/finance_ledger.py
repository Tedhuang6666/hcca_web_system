"""財務 總帳與分錄 API。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from api.core.permission_codes import PermissionCode
from api.dependencies.permissions import require_any
from api.models.finance import (
    ChartAccount,
    FinanceAccountType,
    FinanceLedger,
    FiscalPeriod,
    FundAccount,
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
    _journal_out as _journal_out,
)
from api.routers.finance_common import (
    logger as logger,
)
from api.routers.finance_common import (
    require_journal_permission as require_journal_permission,
)
from api.routers.finance_common import (
    require_ledger_permission as require_ledger_permission,
)
from api.routers.finance_common import (
    require_period_permission as require_period_permission,
)
from api.schemas.finance import (
    ChartAccountCreate,
    ChartAccountOut,
    ChartAccountUpdate,
    FinanceResetOut,
    FinanceSettlementOut,
    FundAccountCreate,
    FundAccountOut,
    JournalCreate,
    JournalOut,
    LedgerCreate,
    LedgerOut,
    ManualJournalUpdate,
    PeriodCreate,
    PeriodOut,
    TransferCreate,
)
from api.services import audit as audit_svc
from api.services import finance as service
from api.services.permission import get_user_permission_codes_for_org
from api.services.storage import get_storage

router = APIRouter()


@router.post(
    "/ledgers",
    response_model=LedgerOut,
    status_code=201,
    dependencies=[Depends(require_any(PermissionCode.FINANCE_MANAGE))],
)
async def create_ledger(body: LedgerCreate, db: DbDep, user: CurrentUser) -> LedgerOut:
    candidate = FinanceLedger(org_id=body.org_id, name=body.name)
    await _assert_ledger_permission(db, user, candidate, PermissionCode.FINANCE_MANAGE)
    ledger = await service.initialize_ledger(db, body.org_id, body.name)
    await db.commit()
    return LedgerOut.model_validate(ledger)


@router.get("/ledgers", response_model=list[LedgerOut])
async def list_ledgers(db: DbDep, user: CurrentUser) -> list[LedgerOut]:
    ledgers = await service.list_ledgers(db)
    if user.is_superuser:
        return [LedgerOut.model_validate(ledger) for ledger in ledgers]

    visible: list[LedgerOut] = []
    for ledger in ledgers:
        codes = await get_user_permission_codes_for_org(db, user.id, ledger.org_id)
        if str(PermissionCode.FINANCE_VIEW) in codes:
            visible.append(LedgerOut.model_validate(ledger))
    return visible


@router.get(
    "/ledgers/{ledger_id}",
    response_model=LedgerOut,
    dependencies=[Depends(require_ledger_permission(PermissionCode.FINANCE_VIEW))],
)
async def get_ledger(ledger_id: uuid.UUID, db: DbDep, _: CurrentUser) -> LedgerOut:
    return LedgerOut.model_validate(await service.get_ledger(db, ledger_id))


@router.post(
    "/ledgers/{ledger_id}/periods",
    response_model=PeriodOut,
    status_code=201,
    dependencies=[Depends(require_ledger_permission(PermissionCode.FINANCE_MANAGE))],
)
async def create_period(
    ledger_id: uuid.UUID, body: PeriodCreate, db: DbDep, _: CurrentUser
) -> PeriodOut:
    await service.get_ledger(db, ledger_id)
    period = FiscalPeriod(ledger_id=ledger_id, **body.model_dump())
    db.add(period)
    await db.commit()
    await db.refresh(period)
    return PeriodOut.model_validate(period)


@router.post(
    "/periods/{period_id}/close",
    response_model=PeriodOut,
    dependencies=[Depends(require_period_permission(PermissionCode.FINANCE_MANAGE))],
)
async def close_period(period_id: uuid.UUID, db: DbDep, _: CurrentUser) -> PeriodOut:
    period = await db.get(FiscalPeriod, period_id)
    if not period:
        raise HTTPException(404, "會計期間不存在")
    period.is_closed = True
    await db.commit()
    await db.refresh(period)
    return PeriodOut.model_validate(period)


@router.get(
    "/ledgers/{ledger_id}/periods",
    response_model=list[PeriodOut],
    dependencies=[Depends(require_ledger_permission(PermissionCode.FINANCE_VIEW))],
)
async def list_periods(ledger_id: uuid.UUID, db: DbDep, _: CurrentUser) -> list[PeriodOut]:
    await service.get_ledger(db, ledger_id)
    rows = (
        await db.execute(
            select(FiscalPeriod)
            .where(FiscalPeriod.ledger_id == ledger_id)
            .order_by(FiscalPeriod.starts_on.desc())
        )
    ).scalars()
    return [PeriodOut.model_validate(row) for row in rows]


@router.delete("/test-reset", response_model=FinanceResetOut)
async def clear_all_finance_test_data(db: DbDep, user: CurrentUser) -> FinanceResetOut:
    if not user.is_superuser:
        raise HTTPException(status_code=403, detail="僅系統管理員可清除全部財務資料")

    deleted_rows, storage_keys = await service.clear_all_finance_data(db)
    await audit_svc.record(
        db,
        entity_type="finance_data",
        entity_id="all",
        action="finance.test_reset",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"測試用清除全部財務資料：刪除 {deleted_rows} 筆資料列",
    )
    await db.commit()

    files_deleted = 0
    files_failed = 0
    storage = get_storage()
    for storage_key in storage_keys:
        try:
            await storage.delete(storage_key)
            files_deleted += 1
        except Exception:
            files_failed += 1
            logger.exception("清除財務測試資料時無法刪除憑證檔")
    return FinanceResetOut(
        records_deleted=deleted_rows,
        evidence_files_deleted=files_deleted,
        evidence_files_failed=files_failed,
    )


@router.get(
    "/ledgers/{ledger_id}/periods/{period_id}/settlement",
    response_model=FinanceSettlementOut,
    dependencies=[Depends(require_ledger_permission(PermissionCode.FINANCE_VIEW))],
)
async def get_settlement_report(
    ledger_id: uuid.UUID, period_id: uuid.UUID, db: DbDep, _: CurrentUser
) -> FinanceSettlementOut:
    return FinanceSettlementOut.model_validate(
        await service.settlement_report(db, ledger_id, period_id)
    )


@router.get(
    "/ledgers/{ledger_id}/accounts",
    response_model=list[ChartAccountOut],
    dependencies=[Depends(require_ledger_permission(PermissionCode.FINANCE_VIEW))],
)
async def list_accounts(ledger_id: uuid.UUID, db: DbDep, _: CurrentUser) -> list[ChartAccountOut]:
    balances = await service.account_balances(db, ledger_id)
    rows = list(
        (
            await db.execute(select(ChartAccount).where(ChartAccount.ledger_id == ledger_id))
        ).scalars()
    )
    return [
        ChartAccountOut(
            id=row.id,
            ledger_id=row.ledger_id,
            code=row.code,
            name=row.name,
            account_type=row.account_type,
            is_active=row.is_active,
            is_system=row.is_system,
            balance=balances.get(row.id, 0),
        )
        for row in rows
    ]


@router.post(
    "/ledgers/{ledger_id}/accounts",
    response_model=ChartAccountOut,
    status_code=201,
    dependencies=[Depends(require_ledger_permission(PermissionCode.FINANCE_MANAGE))],
)
async def create_account(
    ledger_id: uuid.UUID, body: ChartAccountCreate, db: DbDep, _: CurrentUser
) -> ChartAccountOut:
    row = ChartAccount(ledger_id=ledger_id, **body.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return ChartAccountOut.model_validate(row)


@router.patch(
    "/ledgers/{ledger_id}/accounts/{account_id}",
    response_model=ChartAccountOut,
    dependencies=[Depends(require_ledger_permission(PermissionCode.FINANCE_MANAGE))],
)
async def update_account(
    ledger_id: uuid.UUID,
    account_id: uuid.UUID,
    body: ChartAccountUpdate,
    db: DbDep,
    _: CurrentUser,
) -> ChartAccountOut:
    row = await service.update_chart_account(db, ledger_id, account_id, body)
    await db.commit()
    await db.refresh(row)
    return ChartAccountOut.model_validate(row)


@router.get(
    "/ledgers/{ledger_id}/funds",
    response_model=list[FundAccountOut],
    dependencies=[Depends(require_ledger_permission(PermissionCode.FINANCE_VIEW))],
)
async def list_funds(ledger_id: uuid.UUID, db: DbDep, _: CurrentUser) -> list[FundAccountOut]:
    balances = await service.account_balances(db, ledger_id)
    rows = list(
        (await db.execute(select(FundAccount).where(FundAccount.ledger_id == ledger_id))).scalars()
    )
    return [
        FundAccountOut(
            id=row.id,
            ledger_id=row.ledger_id,
            name=row.name,
            storage_type=row.storage_type,
            chart_account_id=row.chart_account_id,
            bank_name=row.bank_name,
            account_last_four=row.account_last_four,
            is_active=row.is_active,
            balance=balances.get(row.chart_account_id, 0),
        )
        for row in rows
    ]


@router.post(
    "/ledgers/{ledger_id}/funds",
    response_model=FundAccountOut,
    status_code=201,
    dependencies=[Depends(require_ledger_permission(PermissionCode.FINANCE_MANAGE))],
)
async def create_fund(
    ledger_id: uuid.UUID, body: FundAccountCreate, db: DbDep, _: CurrentUser
) -> FundAccountOut:
    account = await db.get(ChartAccount, body.chart_account_id)
    if (
        not account
        or account.ledger_id != ledger_id
        or account.account_type != FinanceAccountType.ASSET
    ):
        raise HTTPException(400, "資金帳戶必須對應本帳本的資產科目")
    row = FundAccount(ledger_id=ledger_id, **body.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return FundAccountOut.model_validate(row)


@router.post(
    "/ledgers/{ledger_id}/journals",
    response_model=JournalOut,
    status_code=201,
    dependencies=[Depends(require_ledger_permission(PermissionCode.FINANCE_RECORD))],
)
async def create_journal(
    ledger_id: uuid.UUID, body: JournalCreate, db: DbDep, user: CurrentUser
) -> JournalOut:
    entry = await service.create_journal(db, ledger_id, body, user.id)
    await db.commit()
    return _journal_out(await service.journal_with_lines(db, entry))


@router.patch(
    "/journals/{entry_id}/manual-entry",
    response_model=JournalOut,
    dependencies=[Depends(require_journal_permission(PermissionCode.FINANCE_RECORD))],
)
async def update_manual_journal(
    entry_id: uuid.UUID, body: ManualJournalUpdate, db: DbDep, user: CurrentUser
) -> JournalOut:
    entry = await db.get(JournalEntry, entry_id)
    if not entry:
        raise HTTPException(404, "傳票不存在")
    updated = await service.update_manual_journal(db, entry, body, user.id)
    await audit_svc.record(
        db,
        entity_type="finance_journal",
        entity_id=str(updated.id),
        action=(
            "finance.opening_balance_adjustment"
            if updated.id != entry.id
            else "finance.manual_entry_update"
        ),
        actor_id=str(user.id),
        actor_email=user.email,
        summary=(
            f"建立期初餘額調整：{updated.description}"
            if updated.id != entry.id
            else f"修改待覆核傳票：{updated.description}"
        ),
    )
    await db.commit()
    return _journal_out(await service.journal_with_lines(db, updated))


@router.post(
    "/ledgers/{ledger_id}/transfers",
    response_model=JournalOut,
    status_code=201,
    dependencies=[Depends(require_ledger_permission(PermissionCode.FINANCE_RECORD))],
)
async def create_transfer(
    ledger_id: uuid.UUID, body: TransferCreate, db: DbDep, user: CurrentUser
) -> JournalOut:
    entry = await service.create_transfer(db, ledger_id, body, user.id)
    await db.commit()
    return _journal_out(await service.journal_with_lines(db, entry))


@router.get(
    "/ledgers/{ledger_id}/journals",
    response_model=list[JournalOut],
    dependencies=[Depends(require_ledger_permission(PermissionCode.FINANCE_VIEW))],
)
async def list_journals(
    ledger_id: uuid.UUID, db: DbDep, _: CurrentUser, status: JournalStatus | None = None
) -> list[JournalOut]:
    stmt = select(JournalEntry).where(JournalEntry.ledger_id == ledger_id)
    if status:
        stmt = stmt.where(JournalEntry.status == status)
    stmt = stmt.order_by(JournalEntry.entry_date.desc(), JournalEntry.created_at.desc())
    return [
        _journal_out(await service.journal_with_lines(db, row))
        for row in (await db.execute(stmt)).scalars()
    ]


@router.post(
    "/journals/{entry_id}/submit",
    response_model=JournalOut,
    dependencies=[
        Depends(
            require_journal_permission(
                PermissionCode.FINANCE_EXPENSE_CLAIM, PermissionCode.FINANCE_RECORD
            )
        )
    ],
)
async def submit_journal(entry_id: uuid.UUID, db: DbDep, _: CurrentUser) -> JournalOut:
    entry = await db.get(JournalEntry, entry_id)
    if not entry:
        raise HTTPException(404, "傳票不存在")
    await service.submit_journal(db, entry)
    await db.commit()
    return _journal_out(await service.journal_with_lines(db, entry))


@router.post(
    "/journals/{entry_id}/post",
    response_model=JournalOut,
    dependencies=[Depends(require_journal_permission(PermissionCode.FINANCE_REVIEW))],
)
async def post_journal(entry_id: uuid.UUID, db: DbDep, user: CurrentUser) -> JournalOut:
    entry = await db.get(JournalEntry, entry_id)
    if not entry:
        raise HTTPException(404, "傳票不存在")
    await service.post_journal(db, entry, user.id)
    await audit_svc.record(
        db,
        entity_type="finance_journal",
        entity_id=str(entry.id),
        action="finance.post",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"過帳：{entry.description}",
    )
    await db.commit()
    return _journal_out(await service.journal_with_lines(db, entry))
