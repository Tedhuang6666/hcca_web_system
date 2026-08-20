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
    ExpenseClaimItem,
    ExpenseClaimItemEvidence,
    ExpensePaymentStatus,
    FinanceAccountType,
    FinanceBudget,
    FinanceBudgetAllocation,
    FinanceBudgetSubmission,
    FinanceLedger,
    FiscalPeriod,
    FundAccount,
    JournalEntry,
    JournalStatus,
)
from api.models.user import User
from api.schemas.finance import (
    BudgetAllocationCreate,
    BudgetAllocationOut,
    BudgetAllocationUpdate,
    BudgetCreate,
    BudgetDetailOut,
    BudgetNodeCreate,
    BudgetNodeOut,
    BudgetOut,
    BudgetReview,
    BudgetSubmissionCreate,
    BudgetSubmissionOut,
    ChartAccountCreate,
    ChartAccountOut,
    ChartAccountUpdate,
    ExpenseBudgetUpdate,
    ExpenseClaimCreate,
    ExpenseProcurementUpdate,
    ExpenseReimbursementCreate,
    ExpenseReturnCreate,
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


class BudgetPermissionChecker:
    def __init__(self, *permissions: PermissionCode) -> None:
        self.permissions = permissions

    async def __call__(self, budget_id: uuid.UUID, db: DbDep, user: CurrentUser) -> FinanceBudget:
        budget = await service.get_budget(db, budget_id)
        await _assert_ledger_permission(
            db, user, await service.get_ledger(db, budget.ledger_id), *self.permissions
        )
        return budget


class SubmissionPermissionChecker:
    def __init__(self, *permissions: PermissionCode) -> None:
        self.permissions = permissions

    async def __call__(
        self, submission_id: uuid.UUID, db: DbDep, user: CurrentUser
    ) -> FinanceBudgetSubmission:
        submission = await db.get(FinanceBudgetSubmission, submission_id)
        if not submission:
            raise HTTPException(404, "預算案不存在")
        budget = await service.get_budget(db, submission.budget_id)
        await _assert_ledger_permission(
            db, user, await service.get_ledger(db, budget.ledger_id), *self.permissions
        )
        return submission


class AllocationPermissionChecker:
    def __init__(self, *permissions: PermissionCode) -> None:
        self.permissions = permissions

    async def __call__(
        self, allocation_id: uuid.UUID, db: DbDep, user: CurrentUser
    ) -> FinanceBudgetAllocation:
        allocation = await db.get(FinanceBudgetAllocation, allocation_id)
        if not allocation:
            raise HTTPException(404, "預算配置不存在")
        submission = await db.get(FinanceBudgetSubmission, allocation.submission_id)
        if not submission:
            raise HTTPException(404, "預算案不存在")
        budget = await service.get_budget(db, submission.budget_id)
        await _assert_ledger_permission(
            db, user, await service.get_ledger(db, budget.ledger_id), *self.permissions
        )
        return allocation


def require_budget_permission(*permissions: PermissionCode) -> BudgetPermissionChecker:
    return BudgetPermissionChecker(*permissions)


def require_submission_permission(*permissions: PermissionCode) -> SubmissionPermissionChecker:
    return SubmissionPermissionChecker(*permissions)


def require_allocation_permission(*permissions: PermissionCode) -> AllocationPermissionChecker:
    return AllocationPermissionChecker(*permissions)


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
    "/ledgers/{ledger_id}/budgets",
    response_model=list[BudgetOut],
    dependencies=[Depends(require_ledger_permission(PermissionCode.FINANCE_VIEW))],
)
async def list_budgets(ledger_id: uuid.UUID, db: DbDep, _: CurrentUser) -> list[BudgetOut]:
    return [BudgetOut.model_validate(item) for item in await service.list_budgets(db, ledger_id)]


@router.post(
    "/ledgers/{ledger_id}/budgets",
    response_model=BudgetOut,
    status_code=201,
    dependencies=[Depends(require_ledger_permission(PermissionCode.FINANCE_BUDGET))],
)
async def create_budget(
    ledger_id: uuid.UUID, body: BudgetCreate, db: DbDep, _: CurrentUser
) -> BudgetOut:
    budget = await service.create_budget(db, ledger_id, body)
    await db.commit()
    return BudgetOut.model_validate(budget)


@router.get(
    "/budgets/{budget_id}",
    response_model=BudgetDetailOut,
    dependencies=[Depends(require_budget_permission(PermissionCode.FINANCE_VIEW))],
)
async def get_budget_detail(budget_id: uuid.UUID, db: DbDep, _: CurrentUser) -> BudgetDetailOut:
    return BudgetDetailOut.model_validate(
        await service.budget_detail(db, await service.get_budget(db, budget_id))
    )


@router.post(
    "/budgets/{budget_id}/submissions",
    response_model=BudgetSubmissionOut,
    status_code=201,
    dependencies=[Depends(require_budget_permission(PermissionCode.FINANCE_BUDGET))],
)
async def create_budget_submission(
    budget_id: uuid.UUID, body: BudgetSubmissionCreate, db: DbDep, user: CurrentUser
) -> BudgetSubmissionOut:
    submission = await service.create_budget_submission(
        db, await service.get_budget(db, budget_id), body, user.id
    )
    await db.commit()
    return BudgetSubmissionOut.model_validate(submission)


@router.post(
    "/budget-submissions/{submission_id}/nodes",
    response_model=BudgetNodeOut,
    status_code=201,
    dependencies=[
        Depends(
            require_submission_permission(
                PermissionCode.FINANCE_BUDGET_PROPOSE, PermissionCode.FINANCE_BUDGET
            )
        )
    ],
)
async def create_budget_node(
    submission_id: uuid.UUID, body: BudgetNodeCreate, db: DbDep, _: CurrentUser
) -> BudgetNodeOut:
    node = await service.create_budget_node(db, submission_id, body)
    await db.commit()
    return BudgetNodeOut.model_validate(node)


@router.post(
    "/budget-submissions/{submission_id}/allocations",
    response_model=BudgetAllocationOut,
    status_code=201,
    dependencies=[
        Depends(
            require_submission_permission(
                PermissionCode.FINANCE_BUDGET_PROPOSE, PermissionCode.FINANCE_BUDGET
            )
        )
    ],
)
async def create_budget_allocation(
    submission_id: uuid.UUID, body: BudgetAllocationCreate, db: DbDep, user: CurrentUser
) -> BudgetAllocationOut:
    allocation = await service.create_budget_allocation(db, submission_id, body, user.id)
    await db.commit()
    return BudgetAllocationOut.model_validate(allocation)


@router.post(
    "/budget-submissions/{submission_id}/submit",
    response_model=BudgetSubmissionOut,
    dependencies=[Depends(require_submission_permission(PermissionCode.FINANCE_BUDGET))],
)
async def submit_budget_submission(
    submission_id: uuid.UUID, db: DbDep, _: CurrentUser
) -> BudgetSubmissionOut:
    submission = await service.submit_budget_submission(db, submission_id)
    await db.commit()
    return BudgetSubmissionOut.model_validate(submission)


@router.post(
    "/budget-submissions/{submission_id}/review",
    response_model=BudgetSubmissionOut,
    dependencies=[Depends(require_submission_permission(PermissionCode.FINANCE_BUDGET_REVIEW))],
)
async def review_budget_submission(
    submission_id: uuid.UUID, body: BudgetReview, db: DbDep, user: CurrentUser
) -> BudgetSubmissionOut:
    submission = await service.review_budget_submission(db, submission_id, body, user.id)
    await db.commit()
    return BudgetSubmissionOut.model_validate(submission)


@router.patch(
    "/budget-allocations/{allocation_id}",
    response_model=BudgetAllocationOut,
    dependencies=[Depends(require_allocation_permission(PermissionCode.FINANCE_BUDGET))],
)
async def update_budget_allocation(
    allocation_id: uuid.UUID, body: BudgetAllocationUpdate, db: DbDep, user: CurrentUser
) -> BudgetAllocationOut:
    allocation = await service.update_budget_allocation(db, allocation_id, body, user.id)
    await db.commit()
    return BudgetAllocationOut.model_validate(allocation)


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


@router.post(
    "/journals/{entry_id}/return",
    response_model=JournalOut,
    dependencies=[Depends(require_journal_permission(PermissionCode.FINANCE_REVIEW))],
)
async def return_expense_claim(
    entry_id: uuid.UUID, body: ExpenseReturnCreate, db: DbDep, user: CurrentUser
) -> JournalOut:
    entry = await db.get(JournalEntry, entry_id)
    if not entry:
        raise HTTPException(404, "傳票不存在")
    await service.return_expense_claim(db, entry, user.id, body.note)
    await audit_svc.record(
        db,
        entity_type="finance_journal",
        entity_id=str(entry.id),
        action="finance.expense_return",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"退回報帳：{entry.description}",
    )
    await db.commit()
    return _journal_out(await service.journal_with_lines(db, entry))


@router.patch(
    "/journals/{entry_id}/procurement",
    response_model=JournalOut,
    dependencies=[Depends(require_journal_permission(PermissionCode.FINANCE_PROCUREMENT))],
)
async def update_expense_procurement(
    entry_id: uuid.UUID, body: ExpenseProcurementUpdate, db: DbDep, user: CurrentUser
) -> JournalOut:
    entry = await db.get(JournalEntry, entry_id)
    if not entry:
        raise HTTPException(404, "傳票不存在")
    await service.update_expense_procurement(db, entry, body, user.id)
    await audit_svc.record(
        db,
        entity_type="finance_journal",
        entity_id=str(entry.id),
        action="finance.expense_procurement",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"更新校商請購：{entry.description}／{body.status}",
    )
    await db.commit()
    return _journal_out(await service.journal_with_lines(db, entry))


@router.post(
    "/journals/{entry_id}/school-payment",
    response_model=JournalOut,
    dependencies=[Depends(require_journal_permission(PermissionCode.FINANCE_SCHOOL_PAYMENT))],
)
async def mark_school_payment(entry_id: uuid.UUID, db: DbDep, user: CurrentUser) -> JournalOut:
    entry = await db.get(JournalEntry, entry_id)
    if not entry:
        raise HTTPException(404, "傳票不存在")
    await service.mark_expense_paid(db, entry, ExpensePaymentStatus.SCHOOL_PAID, user.id)
    await audit_svc.record(
        db,
        entity_type="finance_journal",
        entity_id=str(entry.id),
        action="finance.school_payment",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"登錄校方付款：{entry.description}",
    )
    await db.commit()
    return _journal_out(await service.journal_with_lines(db, entry))


@router.post(
    "/journals/{entry_id}/dues-payment",
    response_model=JournalOut,
    dependencies=[Depends(require_journal_permission(PermissionCode.FINANCE_DUES_PAYMENT))],
)
async def mark_dues_payment(entry_id: uuid.UUID, db: DbDep, user: CurrentUser) -> JournalOut:
    entry = await db.get(JournalEntry, entry_id)
    if not entry:
        raise HTTPException(404, "傳票不存在")
    await service.mark_expense_paid(db, entry, ExpensePaymentStatus.DUES_PAID, user.id)
    await audit_svc.record(
        db,
        entity_type="finance_journal",
        entity_id=str(entry.id),
        action="finance.dues_payment",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"登錄會費付款：{entry.description}",
    )
    await db.commit()
    return _journal_out(await service.journal_with_lines(db, entry))


@router.post(
    "/journals/{entry_id}/reimburse-advance",
    response_model=JournalOut,
    dependencies=[
        Depends(
            require_journal_permission(
                PermissionCode.FINANCE_SCHOOL_PAYMENT, PermissionCode.FINANCE_DUES_PAYMENT
            )
        )
    ],
)
async def reimburse_advance(
    entry_id: uuid.UUID, body: ExpenseReimbursementCreate, db: DbDep, user: CurrentUser
) -> JournalOut:
    entry = await db.get(JournalEntry, entry_id)
    if not entry:
        raise HTTPException(404, "傳票不存在")
    await service.reimburse_expense_claim(db, entry, body, user.id)
    await audit_svc.record(
        db,
        entity_type="finance_journal",
        entity_id=str(entry.id),
        action="finance.advance_reimbursement",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"完成代墊償還：{entry.description}",
    )
    await db.commit()
    return _journal_out(await service.journal_with_lines(db, entry))


@router.patch(
    "/journals/{entry_id}/budget",
    response_model=JournalOut,
    dependencies=[Depends(require_journal_permission(PermissionCode.FINANCE_BUDGET))],
)
async def update_expense_budget(
    entry_id: uuid.UUID, body: ExpenseBudgetUpdate, db: DbDep, user: CurrentUser
) -> JournalOut:
    entry = await db.get(JournalEntry, entry_id)
    if not entry:
        raise HTTPException(404, "傳票不存在")
    await service.update_expense_budget(db, entry, body, user.id)
    await audit_svc.record(
        db,
        entity_type="finance_journal",
        entity_id=str(entry.id),
        action="finance.budget",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"更新預算列管：{entry.description}／{body.included}",
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


@router.get(
    "/journals/{entry_id}/claim-items",
    dependencies=[Depends(require_journal_permission(PermissionCode.FINANCE_VIEW))],
)
async def list_claim_items(entry_id: uuid.UUID, db: DbDep, _: CurrentUser) -> list[dict]:
    items = list(
        (
            await db.execute(
                select(ExpenseClaimItem).where(ExpenseClaimItem.journal_entry_id == entry_id)
            )
        ).scalars()
    )
    evidence_rows = (
        list(
            (
                await db.execute(
                    select(ExpenseClaimItemEvidence).where(
                        ExpenseClaimItemEvidence.item_id.in_([item.id for item in items])
                    )
                )
            ).scalars()
        )
        if items
        else []
    )
    by_item: dict[uuid.UUID, list[ExpenseClaimItemEvidence]] = {}
    for evidence in evidence_rows:
        by_item.setdefault(evidence.item_id, []).append(evidence)
    return [
        {
            "id": item.id,
            "name": item.name,
            "unit_price": item.unit_price,
            "tax_rate": item.tax_rate,
            "quantity": item.quantity,
            "budget_node_id": item.budget_node_id,
            "budget_exception_note": item.budget_exception_note,
            "evidence_count": len(by_item.get(item.id, [])),
        }
        for item in items
    ]


@router.get("/expense-evidence/{evidence_id}")
async def download_item_evidence(evidence_id: uuid.UUID, db: DbDep, user: CurrentUser):
    evidence = await db.get(ExpenseClaimItemEvidence, evidence_id)
    if not evidence:
        raise HTTPException(404, "憑證不存在")
    item = await db.get(ExpenseClaimItem, evidence.item_id)
    if not item:
        raise HTTPException(404, "報帳品項不存在")
    entry = await db.get(JournalEntry, item.journal_entry_id)
    if not entry:
        raise HTTPException(404, "報帳不存在")
    if entry.created_by_id != user.id and entry.advanced_by_id != user.id:
        ledger = await service.get_ledger(db, entry.ledger_id)
        await _assert_ledger_permission(
            db,
            user,
            ledger,
            PermissionCode.FINANCE_EXPENSE_CLAIM,
            PermissionCode.FINANCE_REVIEW,
            PermissionCode.FINANCE_SCHOOL_PAYMENT,
            PermissionCode.FINANCE_DUES_PAYMENT,
            PermissionCode.FINANCE_BUDGET,
        )
    service.validate_evidence_key(evidence.storage_key, entry.ledger_id)
    storage = get_storage()
    local_path = storage.local_path(evidence.storage_key)
    if local_path is not None:
        if not local_path.is_file():
            raise HTTPException(404, "憑證檔案不存在")
        return FileResponse(
            local_path,
            filename=evidence.filename,
            media_type=evidence.content_type,
            headers={"Cache-Control": "private, no-store"},
        )
    return RedirectResponse(
        await storage.get_url(
            evidence.storage_key, disposition="attachment", download_name=evidence.filename
        ),
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
