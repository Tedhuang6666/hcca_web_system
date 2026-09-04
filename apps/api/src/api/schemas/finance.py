from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from api.models.finance import (
    BudgetSubmissionKind,
    BudgetSubmissionStatus,
    ExpenseClaimStatus,
    ExpenseEvidenceType,
    ExpensePaymentMethod,
    ExpensePaymentStatus,
    ExpenseProcurementStatus,
    FinanceAccountType,
    FundStorageType,
    JournalStatus,
)


class LedgerCreate(BaseModel):
    org_id: uuid.UUID
    name: str = Field(min_length=1, max_length=120)


class LedgerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    org_id: uuid.UUID
    name: str
    currency: str


class PeriodCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    starts_on: date
    ends_on: date

    @model_validator(mode="after")
    def valid_dates(self) -> PeriodCreate:
        if self.ends_on < self.starts_on:
            raise ValueError("會計期間結束日不得早於開始日")
        return self


class PeriodOut(PeriodCreate):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    ledger_id: uuid.UUID
    is_closed: bool


class ChartAccountCreate(BaseModel):
    code: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=120)
    account_type: FinanceAccountType


class ChartAccountOut(ChartAccountCreate):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    ledger_id: uuid.UUID
    is_active: bool
    is_system: bool
    balance: int = 0


class ChartAccountUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    is_active: bool | None = None


class FundAccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    storage_type: FundStorageType
    chart_account_id: uuid.UUID
    bank_name: str | None = None
    account_last_four: str | None = Field(None, max_length=4)


class FundAccountOut(FundAccountCreate):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    ledger_id: uuid.UUID
    is_active: bool
    balance: int = 0


class JournalLineIn(BaseModel):
    account_id: uuid.UUID
    debit: int = Field(default=0, ge=0, le=2_000_000_000)
    credit: int = Field(default=0, ge=0, le=2_000_000_000)
    memo: str | None = Field(None, max_length=240)

    @model_validator(mode="after")
    def single_side(self) -> JournalLineIn:
        if (self.debit == 0) == (self.credit == 0):
            raise ValueError("每筆分錄必須且只能填借方或貸方")
        return self


class JournalCreate(BaseModel):
    period_id: uuid.UUID
    entry_date: date
    description: str = Field(min_length=1, max_length=300)
    lines: list[JournalLineIn] = Field(min_length=2)
    source_type: str | None = None
    source_id: uuid.UUID | None = None
    source_event: str | None = None
    source_url: str | None = None
    evidence_url: str | None = None
    note: str | None = None

    @model_validator(mode="after")
    def balanced(self) -> JournalCreate:
        if sum(line.debit for line in self.lines) != sum(line.credit for line in self.lines):
            raise ValueError("借貸金額必須相等")
        return self


class ManualJournalUpdate(BaseModel):
    period_id: uuid.UUID
    entry_date: date
    fund_account_id: uuid.UUID
    counterpart_account_id: uuid.UUID
    description: str = Field(min_length=1, max_length=300)
    amount: int = Field(gt=0, le=2_000_000_000)
    source_url: str | None = Field(None, max_length=500)
    evidence_url: str | None = Field(None, max_length=500)
    note: str | None = Field(None, max_length=500)


class TransferCreate(BaseModel):
    period_id: uuid.UUID
    entry_date: date
    from_fund_account_id: uuid.UUID
    to_fund_account_id: uuid.UUID
    amount: int = Field(gt=0, le=2_000_000_000)
    description: str = Field(min_length=1, max_length=300)
    note: str | None = None


class ExpenseClaimItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    unit_price: int = Field(gt=0, le=2_000_000_000)
    tax_rate: int = Field(default=0, ge=0, le=100)
    quantity: Decimal = Field(gt=0, le=100_000, max_digits=12, decimal_places=2)
    unit: str = Field(default="項", min_length=1, max_length=32)
    budget_node_id: uuid.UUID | None = None
    budget_exception_note: str | None = Field(None, max_length=500)
    evidence: list[ExpenseClaimEvidenceIn] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def budget_reason_required(self) -> ExpenseClaimItemCreate:
        self.unit = self.unit.strip()
        if not self.unit:
            raise ValueError("請填寫數量單位")
        if self.budget_node_id is None and not (self.budget_exception_note or "").strip():
            raise ValueError("未對應預算的品項必須說明原因")
        return self


class ExpenseClaimEvidenceIn(BaseModel):
    storage_key: str = Field(min_length=1, max_length=500)
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=120)
    file_size: int = Field(gt=0, le=20 * 1024 * 1024)
    evidence_type: ExpenseEvidenceType = ExpenseEvidenceType.RECEIPT
    note: str | None = Field(None, max_length=500)


class ExpenseClaimCreate(BaseModel):
    period_id: uuid.UUID
    entry_date: date
    fund_account_id: uuid.UUID
    expense_account_id: uuid.UUID
    description: str = Field(min_length=1, max_length=300)
    items: list[ExpenseClaimItemCreate] = Field(min_length=1, max_length=100)
    evidence_url: str | None = Field(None, max_length=500)
    source_url: str | None = Field(None, max_length=500)
    note: str | None = None
    proposing_org_id: uuid.UUID | None = None
    payment_method: ExpensePaymentMethod = ExpensePaymentMethod.DIRECT
    advanced_by_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def advance_requires_person(self) -> ExpenseClaimCreate:
        if self.payment_method == ExpensePaymentMethod.ADVANCE and self.advanced_by_id is None:
            raise ValueError("代墊報帳必須指定代墊人")
        if self.payment_method == ExpensePaymentMethod.DIRECT and self.advanced_by_id is not None:
            raise ValueError("直接付款不可指定代墊人")
        return self


class ExpenseProcurementUpdate(BaseModel):
    status: ExpenseProcurementStatus
    note: str | None = Field(None, max_length=500)


class ExpenseBudgetUpdate(BaseModel):
    included: bool
    note: str | None = Field(None, max_length=500)


class ExpenseReturnCreate(BaseModel):
    note: str = Field(min_length=1, max_length=500)


class ExpenseReimbursementCreate(BaseModel):
    period_id: uuid.UUID
    entry_date: date
    fund_account_id: uuid.UUID
    payment_status: ExpensePaymentStatus = ExpensePaymentStatus.DUES_PAID
    note: str | None = Field(None, max_length=500)


class BudgetCreate(BaseModel):
    period_id: uuid.UUID
    name: str = Field(min_length=1, max_length=160)


class BudgetSubmissionCreate(BaseModel):
    kind: BudgetSubmissionKind = BudgetSubmissionKind.INITIAL
    title: str = Field(min_length=1, max_length=160)
    note: str | None = None


class BudgetNodeCreate(BaseModel):
    parent_id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=160)
    sort_order: int = 0


class BudgetAllocationCreate(BaseModel):
    node_id: uuid.UUID
    amount: int | None = Field(default=None, gt=0, le=2_000_000_000)
    quantity: Decimal | None = Field(
        default=None, gt=0, le=100_000, max_digits=12, decimal_places=2
    )
    unit: str | None = Field(default=None, max_length=32)
    unit_price: int | None = Field(default=None, gt=0, le=2_000_000_000)
    proposing_org_id: uuid.UUID
    note: str | None = None

    @model_validator(mode="after")
    def amount_or_quantity_required(self) -> BudgetAllocationCreate:
        has_quantity_detail = self.quantity is not None or self.unit is not None
        if has_quantity_detail:
            self.unit = (self.unit or "").strip()
            if self.quantity is None or not self.unit:
                raise ValueError("填寫數量時，必須同時填寫單位")
            if self.unit_price is not None:
                calculated = int(
                    (self.quantity * self.unit_price).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
                )
                if self.amount is not None and self.amount != calculated:
                    raise ValueError("預算總額必須等於數量乘以單價")
                self.amount = calculated
        if self.amount is None:
            raise ValueError("請填寫預算總額，或完整填寫數量、單位與單價")
        return self


class BudgetAllocationUpdate(BaseModel):
    node_id: uuid.UUID | None = None
    amount: int | None = Field(default=None, gt=0, le=2_000_000_000)
    quantity: Decimal | None = Field(
        default=None, gt=0, le=100_000, max_digits=12, decimal_places=2
    )
    unit: str | None = Field(default=None, min_length=1, max_length=32)
    unit_price: int | None = Field(default=None, gt=0, le=2_000_000_000)
    note: str | None = Field(default=None, max_length=2000)
    reason: str = Field(min_length=1, max_length=500)


class BudgetReview(BaseModel):
    status: BudgetSubmissionStatus
    note: str | None = Field(None, max_length=500)

    @model_validator(mode="after")
    def review_status_valid(self) -> BudgetReview:
        if self.status not in {
            BudgetSubmissionStatus.APPROVED,
            BudgetSubmissionStatus.RETURNED,
            BudgetSubmissionStatus.REJECTED,
        }:
            raise ValueError("審核結果必須是核准、退回或否決")
        return self


class BudgetPublicationUpdate(BaseModel):
    is_public: bool


class BudgetCouncilReviewPublicationUpdate(BaseModel):
    is_public: bool


class FinanceEvidenceUploadOut(BaseModel):
    storage_key: str
    filename: str
    content_type: str
    file_size: int


class FinanceExpenseClaimEvidenceOut(FinanceEvidenceUploadOut):
    id: uuid.UUID
    evidence_type: ExpenseEvidenceType
    note: str | None
    url: str


class BudgetAllocationEvidenceCreate(FinanceEvidenceUploadOut):
    note: str | None = Field(None, max_length=500)


class BudgetAllocationEvidenceOut(FinanceEvidenceUploadOut):
    id: uuid.UUID
    note: str | None
    uploaded_at: datetime
    url: str


class FinanceExpenseClaimItemOut(BaseModel):
    id: uuid.UUID
    name: str
    unit_price: int
    tax_rate: int
    quantity: Decimal
    unit: str
    budget_node_id: uuid.UUID | None
    budget_exception_note: str | None
    evidence: list[FinanceExpenseClaimEvidenceOut]


class BudgetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    ledger_id: uuid.UUID
    period_id: uuid.UUID
    name: str
    is_public: bool


class BudgetSubmissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    budget_id: uuid.UUID
    kind: BudgetSubmissionKind
    status: BudgetSubmissionStatus
    title: str
    note: str | None
    created_by_id: uuid.UUID
    submitted_at: datetime | None
    reviewed_by_id: uuid.UUID | None
    reviewed_at: datetime | None
    review_note: str | None
    is_council_review_public: bool


class BudgetNodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    budget_id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    sort_order: int
    allocated_amount: int = 0
    used_amount: int = 0
    remaining_amount: int = 0


class BudgetAllocationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    submission_id: uuid.UUID
    node_id: uuid.UUID
    amount: int
    quantity: float | None
    unit: str | None
    unit_price: int | None
    note: str | None
    proposed_by_id: uuid.UUID
    proposing_org_id: uuid.UUID
    evidence: list[BudgetAllocationEvidenceOut] = Field(default_factory=list)


class BudgetDetailOut(BudgetOut):
    submissions: list[BudgetSubmissionOut]
    nodes: list[BudgetNodeOut]
    allocations: list[BudgetAllocationOut]


class BudgetImportOut(BaseModel):
    budget: BudgetOut
    submission: BudgetSubmissionOut
    categories_created: int
    allocations_created: int
    skipped_rows: list[str]


class PublicBudgetListItem(BaseModel):
    id: uuid.UUID
    name: str
    period_name: str
    visibility: Literal["approved", "council_review"]
    review_submission_id: uuid.UUID | None = None
    review_title: str | None = None


class PublicBudgetSubmissionOut(BaseModel):
    id: uuid.UUID
    kind: BudgetSubmissionKind
    status: BudgetSubmissionStatus
    title: str
    reviewed_at: datetime | None
    review_note: str | None


class PublicBudgetAllocationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    node_id: uuid.UUID
    amount: int
    quantity: float | None
    unit: str | None
    unit_price: int | None
    note: str | None


class PublicBudgetDetailOut(BaseModel):
    id: uuid.UUID
    name: str
    period_name: str
    visibility: Literal["approved", "council_review"]
    review_submission: PublicBudgetSubmissionOut | None = None
    submissions: list[PublicBudgetSubmissionOut]
    nodes: list[BudgetNodeOut]
    allocations: list[PublicBudgetAllocationOut]


class FinanceSettlementLineOut(BaseModel):
    node_id: uuid.UUID
    name: str
    budgeted_amount: int
    settled_amount: int
    difference_amount: int


class FinanceSettlementOut(BaseModel):
    period_id: uuid.UUID
    period_name: str
    budgeted_total: int
    settled_total: int
    unsettled_claim_count: int
    lines: list[FinanceSettlementLineOut]


class JournalLineOut(JournalLineIn):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    account_name: str = ""


class JournalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    reference_no: str
    ledger_id: uuid.UUID
    period_id: uuid.UUID
    entry_date: date
    description: str
    status: JournalStatus
    created_by_id: uuid.UUID
    created_by_name: str
    reviewed_by_id: uuid.UUID | None
    posted_at: datetime | None
    source_type: str | None
    source_id: uuid.UUID | None
    source_event: str | None
    source_url: str | None
    evidence_url: str | None
    note: str | None
    claim_status: ExpenseClaimStatus | None
    procurement_status: ExpenseProcurementStatus | None
    procurement_updated_by_id: uuid.UUID | None
    procurement_updated_at: datetime | None
    payment_status: ExpensePaymentStatus | None
    payment_by_id: uuid.UUID | None
    payment_at: datetime | None
    budget_included: bool | None
    budget_included_by_id: uuid.UUID | None
    budget_included_at: datetime | None
    proposing_org_id: uuid.UUID | None = None
    advanced_by_id: uuid.UUID | None = None
    payment_method: ExpensePaymentMethod = ExpensePaymentMethod.DIRECT
    reimbursement_entry_id: uuid.UUID | None = None
    evidence_complete: bool = False
    effective_amount: int | None = None
    lines: list[JournalLineOut]


class BankTransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    fund_account_id: uuid.UUID
    external_id: str
    occurred_on: date
    amount: int
    description: str
    journal_entry_id: uuid.UUID | None


class FinanceDashboardOut(BaseModel):
    assets: int
    liabilities: int
    equity: int
    revenue: int
    expense: int
    net_income: int
    unreconciled_count: int
    funds: list[FundAccountOut]


class GoogleSheetsExportIn(BaseModel):
    spreadsheet_id: str = Field(min_length=10, max_length=200)
