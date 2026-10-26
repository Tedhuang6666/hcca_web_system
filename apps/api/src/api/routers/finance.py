"""財務路由相容入口，按總帳、預算、報帳與公開查詢分派。"""

from __future__ import annotations

from fastapi import APIRouter

from api.routers.finance_budget import (
    add_budget_allocation_evidence as add_budget_allocation_evidence,
)
from api.routers.finance_budget import create_budget as create_budget
from api.routers.finance_budget import create_budget_allocation as create_budget_allocation
from api.routers.finance_budget import create_budget_expense as create_budget_expense
from api.routers.finance_budget import create_budget_node as create_budget_node
from api.routers.finance_budget import create_budget_submission as create_budget_submission
from api.routers.finance_budget import (
    delete_budget_draft_allocation as delete_budget_draft_allocation,
)
from api.routers.finance_budget import delete_budget_submission as delete_budget_submission
from api.routers.finance_budget import download_budget_evidence as download_budget_evidence
from api.routers.finance_budget import (
    download_budget_expense_evidence as download_budget_expense_evidence,
)
from api.routers.finance_budget import export_budget_workbook as export_budget_workbook
from api.routers.finance_budget import get_budget_detail as get_budget_detail
from api.routers.finance_budget import import_budget as import_budget
from api.routers.finance_budget import list_budgets as list_budgets
from api.routers.finance_budget import review_budget_submission as review_budget_submission
from api.routers.finance_budget import router as finance_budget_router
from api.routers.finance_budget import submit_budget_submission as submit_budget_submission
from api.routers.finance_budget import update_budget_allocation as update_budget_allocation
from api.routers.finance_budget import (
    update_budget_draft_allocation as update_budget_draft_allocation,
)
from api.routers.finance_budget import update_budget_expense as update_budget_expense
from api.routers.finance_budget import update_budget_income_item as update_budget_income_item
from api.routers.finance_budget import update_budget_name as update_budget_name
from api.routers.finance_budget import update_budget_publication as update_budget_publication
from api.routers.finance_budget import update_budget_submission as update_budget_submission
from api.routers.finance_budget import (
    update_council_review_publication as update_council_review_publication,
)
from api.routers.finance_claims import complete_expense_claim as complete_expense_claim
from api.routers.finance_claims import create_expense_claim as create_expense_claim
from api.routers.finance_claims import download_evidence as download_evidence
from api.routers.finance_claims import download_item_evidence as download_item_evidence
from api.routers.finance_claims import export_advance_receipt as export_advance_receipt
from api.routers.finance_claims import list_claim_items as list_claim_items
from api.routers.finance_claims import mark_dues_payment as mark_dues_payment
from api.routers.finance_claims import mark_school_payment as mark_school_payment
from api.routers.finance_claims import reimburse_advance as reimburse_advance
from api.routers.finance_claims import return_expense_claim as return_expense_claim
from api.routers.finance_claims import router as finance_claims_router
from api.routers.finance_claims import update_expense_budget as update_expense_budget
from api.routers.finance_claims import update_expense_claim as update_expense_claim
from api.routers.finance_claims import update_expense_procurement as update_expense_procurement
from api.routers.finance_claims import upload_evidence as upload_evidence
from api.routers.finance_common import MAX_BUDGET_IMPORT_BYTES as MAX_BUDGET_IMPORT_BYTES
from api.routers.finance_common import AllocationPermissionChecker as AllocationPermissionChecker
from api.routers.finance_common import BudgetPermissionChecker as BudgetPermissionChecker
from api.routers.finance_common import CurrentUser as CurrentUser
from api.routers.finance_common import DbDep as DbDep
from api.routers.finance_common import JournalPermissionChecker as JournalPermissionChecker
from api.routers.finance_common import LedgerPermissionChecker as LedgerPermissionChecker
from api.routers.finance_common import PeriodPermissionChecker as PeriodPermissionChecker
from api.routers.finance_common import SubmissionPermissionChecker as SubmissionPermissionChecker
from api.routers.finance_common import _assert_ledger_permission as _assert_ledger_permission
from api.routers.finance_common import _budget_role_flags as _budget_role_flags
from api.routers.finance_common import _inline_evidence_headers as _inline_evidence_headers
from api.routers.finance_common import _journal_out as _journal_out
from api.routers.finance_common import logger as logger
from api.routers.finance_common import (
    require_allocation_permission as require_allocation_permission,
)
from api.routers.finance_common import require_budget_permission as require_budget_permission
from api.routers.finance_common import require_journal_permission as require_journal_permission
from api.routers.finance_common import require_ledger_permission as require_ledger_permission
from api.routers.finance_common import require_period_permission as require_period_permission
from api.routers.finance_common import (
    require_submission_permission as require_submission_permission,
)
from api.routers.finance_ledger import clear_all_finance_test_data as clear_all_finance_test_data
from api.routers.finance_ledger import close_period as close_period
from api.routers.finance_ledger import create_account as create_account
from api.routers.finance_ledger import create_fund as create_fund
from api.routers.finance_ledger import create_journal as create_journal
from api.routers.finance_ledger import create_ledger as create_ledger
from api.routers.finance_ledger import create_period as create_period
from api.routers.finance_ledger import create_transfer as create_transfer
from api.routers.finance_ledger import get_ledger as get_ledger
from api.routers.finance_ledger import get_settlement_report as get_settlement_report
from api.routers.finance_ledger import list_accounts as list_accounts
from api.routers.finance_ledger import list_funds as list_funds
from api.routers.finance_ledger import list_journals as list_journals
from api.routers.finance_ledger import list_ledgers as list_ledgers
from api.routers.finance_ledger import list_periods as list_periods
from api.routers.finance_ledger import post_journal as post_journal
from api.routers.finance_ledger import router as finance_ledger_router
from api.routers.finance_ledger import submit_journal as submit_journal
from api.routers.finance_ledger import update_account as update_account
from api.routers.finance_ledger import update_manual_journal as update_manual_journal
from api.routers.finance_public import (
    download_public_budget_expense_evidence as download_public_budget_expense_evidence,
)
from api.routers.finance_public import (
    download_public_expense_claim_evidence as download_public_expense_claim_evidence,
)
from api.routers.finance_public import get_public_budget_detail as get_public_budget_detail
from api.routers.finance_public import (
    get_public_budget_period_totals as get_public_budget_period_totals,
)
from api.routers.finance_public import (
    get_public_expense_claim_detail as get_public_expense_claim_detail,
)
from api.routers.finance_public import list_public_budgets as list_public_budgets
from api.routers.finance_public import list_public_expenses as list_public_expenses
from api.routers.finance_public import router as finance_public_router

router = APIRouter(prefix="/finance", tags=["財務總帳"])
router.include_router(finance_ledger_router)
router.include_router(finance_budget_router)
router.include_router(finance_claims_router)
router.include_router(finance_public_router)
