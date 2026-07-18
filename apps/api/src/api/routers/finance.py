"""財務總帳、資金保管與覆核 API。"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
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
from api.models.user import User
from api.schemas.finance import (
    ChartAccountCreate,
    ChartAccountOut,
    ChartAccountUpdate,
    ExpenseClaimCreate,
    FinanceEvidenceUploadOut,
    FundAccountCreate,
    FundAccountOut,
    GoogleSheetsExportIn,
    JournalCreate,
    JournalOut,
    LedgerCreate,
    LedgerOut,
    PeriodCreate,
    PeriodOut,
    TransferCreate,
)
from api.services import audit as audit_svc
from api.services import finance as service
from api.services.permission import get_user_permission_codes_for_org
from api.services.storage import get_storage

router = APIRouter(prefix="/finance", tags=["財務總帳"])
DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


def _journal_out(data: dict) -> JournalOut:
    if data["evidence_url"]:
        data["evidence_url"] = f"/finance/journals/{data['id']}/evidence"
    return JournalOut(**data)


async def _assert_ledger_permission(
    db: AsyncSession, user: User, ledger: FinanceLedger, *permissions: PermissionCode
) -> None:
    if user.is_superuser:
        return
    codes = await get_user_permission_codes_for_org(db, user.id, ledger.org_id)
    if not codes.intersection(map(str, permissions)):
        raise HTTPException(status_code=403, detail="沒有此組織的財務權限")


class LedgerPermissionChecker:
    def __init__(self, *permissions: PermissionCode) -> None:
        self.permissions = permissions

    async def __call__(self, ledger_id: uuid.UUID, db: DbDep, user: CurrentUser) -> FinanceLedger:
        ledger = await service.get_ledger(db, ledger_id)
        await _assert_ledger_permission(db, user, ledger, *self.permissions)
        return ledger


class JournalPermissionChecker:
    def __init__(self, *permissions: PermissionCode) -> None:
        self.permissions = permissions

    async def __call__(self, entry_id: uuid.UUID, db: DbDep, user: CurrentUser) -> JournalEntry:
        entry = await db.get(JournalEntry, entry_id)
        if not entry:
            raise HTTPException(404, "傳票不存在")
        ledger = await service.get_ledger(db, entry.ledger_id)
        await _assert_ledger_permission(db, user, ledger, *self.permissions)
        return entry


class PeriodPermissionChecker:
    def __init__(self, *permissions: PermissionCode) -> None:
        self.permissions = permissions

    async def __call__(self, period_id: uuid.UUID, db: DbDep, user: CurrentUser) -> None:
        period = await db.get(FiscalPeriod, period_id)
        if not period:
            raise HTTPException(404, "會計期間不存在")
        ledger = await service.get_ledger(db, period.ledger_id)
        await _assert_ledger_permission(db, user, ledger, *self.permissions)


def require_ledger_permission(*permissions: PermissionCode) -> LedgerPermissionChecker:
    return LedgerPermissionChecker(*permissions)


def require_journal_permission(*permissions: PermissionCode) -> JournalPermissionChecker:
    return JournalPermissionChecker(*permissions)


def require_period_permission(*permissions: PermissionCode) -> PeriodPermissionChecker:
    return PeriodPermissionChecker(*permissions)


@router.post(
    "/ledgers/{ledger_id}/evidence",
    response_model=FinanceEvidenceUploadOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[
        Depends(
            require_ledger_permission(
                PermissionCode.FINANCE_EXPENSE_CLAIM, PermissionCode.FINANCE_RECORD
            )
        )
    ],
)
async def upload_evidence(
    ledger_id: uuid.UUID, file: UploadFile = File(...)
) -> FinanceEvidenceUploadOut:
    if Path(file.filename or "").suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp", ".pdf"}:
        raise HTTPException(422, "憑證僅支援 JPG、PNG、WebP 圖片或 PDF")
    try:
        stored = await get_storage().save(file, prefix=f"finance/evidence/{ledger_id}")
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return FinanceEvidenceUploadOut(
        storage_key=stored.storage_key,
        filename=stored.filename,
        content_type=stored.content_type,
        file_size=stored.file_size,
    )


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


@router.post(
    "/ledgers/{ledger_id}/expense-claims",
    response_model=JournalOut,
    status_code=201,
    dependencies=[
        Depends(
            require_ledger_permission(
                PermissionCode.FINANCE_EXPENSE_CLAIM, PermissionCode.FINANCE_RECORD
            )
        )
    ],
)
async def create_expense_claim(
    ledger_id: uuid.UUID, body: ExpenseClaimCreate, db: DbDep, user: CurrentUser
) -> JournalOut:
    entry = await service.create_expense_claim(db, ledger_id, body, user.id)
    await db.commit()
    return _journal_out(await service.journal_with_lines(db, entry))


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
    dependencies=[Depends(require_journal_permission(PermissionCode.FINANCE_RECORD))],
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


@router.get(
    "/journals/{entry_id}/evidence",
    dependencies=[Depends(require_journal_permission(PermissionCode.FINANCE_VIEW))],
)
async def download_evidence(entry_id: uuid.UUID, db: DbDep, _: CurrentUser):
    entry = await db.get(JournalEntry, entry_id)
    if not entry or not entry.evidence_url:
        raise HTTPException(404, "憑證不存在")
    service.validate_evidence_key(entry.evidence_url, entry.ledger_id)
    storage = get_storage()
    local_path = storage.local_path(entry.evidence_url)
    if local_path is not None:
        if not local_path.is_file():
            raise HTTPException(404, "憑證檔案不存在")
        return FileResponse(
            local_path,
            filename=local_path.name,
            content_disposition_type="attachment",
            headers={"Cache-Control": "private, no-store"},
        )
    return RedirectResponse(
        await storage.get_url(entry.evidence_url, disposition="attachment"),
        headers={"Cache-Control": "private, no-store"},
    )


@router.post(
    "/ledgers/{ledger_id}/google-sheets/export",
    dependencies=[Depends(require_ledger_permission(PermissionCode.FINANCE_MANAGE))],
)
async def export_google_sheets(
    ledger_id: uuid.UUID, body: GoogleSheetsExportIn, db: DbDep, _: CurrentUser
) -> dict[str, str]:
    ledger = await service.get_ledger(db, ledger_id)
    await service.export_google_sheets(db, ledger, body.spreadsheet_id)
    await db.commit()
    return {"status": "synced", "spreadsheet_id": body.spreadsheet_id}
