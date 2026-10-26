"""財務 API 共用權限檢查與相容依賴。"""

from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.models.finance import (
    FinanceBudget,
    FinanceBudgetAllocation,
    FinanceBudgetSubmission,
    FinanceLedger,
    FiscalPeriod,
    JournalEntry,
)
from api.models.user import User
from api.schemas.finance import (
    JournalOut,
)
from api.services import finance as service
from api.services.permission import get_user_permission_codes_for_org

logger = logging.getLogger(__name__)


DbDep = Annotated[AsyncSession, Depends(get_db)]


CurrentUser = Annotated[User, Depends(get_current_active_user)]


MAX_BUDGET_IMPORT_BYTES = 10 * 1024 * 1024


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


class BudgetPermissionChecker:
    def __init__(self, *permissions: PermissionCode) -> None:
        self.permissions = permissions

    async def __call__(self, budget_id: uuid.UUID, db: DbDep, user: CurrentUser) -> FinanceBudget:
        budget = await service.get_budget(db, budget_id)
        await _assert_ledger_permission(
            db, user, await service.get_ledger(db, budget.ledger_id), *self.permissions
        )
        return budget


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


class LedgerPermissionChecker:
    def __init__(self, *permissions: PermissionCode) -> None:
        self.permissions = permissions

    async def __call__(self, ledger_id: uuid.UUID, db: DbDep, user: CurrentUser) -> FinanceLedger:
        ledger = await service.get_ledger(db, ledger_id)
        await _assert_ledger_permission(db, user, ledger, *self.permissions)
        return ledger


class PeriodPermissionChecker:
    def __init__(self, *permissions: PermissionCode) -> None:
        self.permissions = permissions

    async def __call__(self, period_id: uuid.UUID, db: DbDep, user: CurrentUser) -> None:
        period = await db.get(FiscalPeriod, period_id)
        if not period:
            raise HTTPException(404, "會計期間不存在")
        ledger = await service.get_ledger(db, period.ledger_id)
        await _assert_ledger_permission(db, user, ledger, *self.permissions)


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


async def _assert_ledger_permission(
    db: AsyncSession, user: User, ledger: FinanceLedger, *permissions: PermissionCode
) -> None:
    if user.is_superuser:
        return
    codes = await get_user_permission_codes_for_org(db, user.id, ledger.org_id)
    if not codes.intersection(map(str, permissions)):
        raise HTTPException(status_code=403, detail="沒有此組織的財務權限")


async def _budget_role_flags(
    db: AsyncSession, user: User, budget: FinanceBudget
) -> tuple[bool, bool, bool]:
    if user.is_superuser:
        return True, True, True
    ledger = await service.get_ledger(db, budget.ledger_id)
    codes = await get_user_permission_codes_for_org(db, user.id, ledger.org_id)
    return (
        str(PermissionCode.FINANCE_BUDGET) in codes,
        str(PermissionCode.FINANCE_BUDGET_PROPOSE) in codes,
        str(PermissionCode.FINANCE_BUDGET_REVIEW) in codes,
    )


def _inline_evidence_headers(cache_control: str) -> dict[str, str]:
    return {
        "Cache-Control": cache_control,
        "Content-Security-Policy": "frame-ancestors 'self'",
        "X-Frame-Options": "SAMEORIGIN",
    }


def _journal_out(data: dict) -> JournalOut:
    if data["evidence_url"]:
        data["evidence_url"] = f"/finance/journals/{data['id']}/evidence"
    return JournalOut(**data)


def require_allocation_permission(*permissions: PermissionCode) -> AllocationPermissionChecker:
    return AllocationPermissionChecker(*permissions)


def require_budget_permission(*permissions: PermissionCode) -> BudgetPermissionChecker:
    return BudgetPermissionChecker(*permissions)


def require_journal_permission(*permissions: PermissionCode) -> JournalPermissionChecker:
    return JournalPermissionChecker(*permissions)


def require_ledger_permission(*permissions: PermissionCode) -> LedgerPermissionChecker:
    return LedgerPermissionChecker(*permissions)


def require_period_permission(*permissions: PermissionCode) -> PeriodPermissionChecker:
    return PeriodPermissionChecker(*permissions)


def require_submission_permission(*permissions: PermissionCode) -> SubmissionPermissionChecker:
    return SubmissionPermissionChecker(*permissions)
