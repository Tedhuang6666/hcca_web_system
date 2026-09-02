"""班聯會複式簿記與資金保管模型。"""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONDict


class FinanceAccountType(enum.StrEnum):
    ASSET = "asset"
    LIABILITY = "liability"
    EQUITY = "equity"
    REVENUE = "revenue"
    EXPENSE = "expense"


class FundStorageType(enum.StrEnum):
    PETTY_CASH = "petty_cash"
    SAFE = "safe"
    BANK = "bank"


class JournalStatus(enum.StrEnum):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    POSTED = "posted"
    RETURNED = "returned"
    REVERSED = "reversed"


class ExpenseClaimStatus(enum.StrEnum):
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    RETURNED = "returned"
    REJECTED = "rejected"
    COMPLETED = "completed"


class ExpenseProcurementStatus(enum.StrEnum):
    NOT_REQUIRED = "not_required"
    REQUESTED = "requested"
    ORDERED = "ordered"
    RECEIVED = "received"


class ExpensePaymentStatus(enum.StrEnum):
    UNPAID = "unpaid"
    SCHOOL_PAID = "school_paid"
    DUES_PAID = "dues_paid"
    ADVANCE_REIMBURSED = "advance_reimbursed"


class ExpensePaymentMethod(enum.StrEnum):
    DIRECT = "direct"
    ADVANCE = "advance"


class BudgetSubmissionKind(enum.StrEnum):
    INITIAL = "initial"
    SUPPLEMENTAL = "supplemental"


class BudgetSubmissionStatus(enum.StrEnum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    RETURNED = "returned"
    REJECTED = "rejected"


class ExpenseEvidenceType(enum.StrEnum):
    RECEIPT = "receipt"
    INVOICE = "invoice"
    OTHER = "other"


class FinanceLedger(Base, TimestampMixin):
    __tablename__ = "finance_ledgers"
    __table_args__ = (UniqueConstraint("org_id", name="uq_finance_ledger_org"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="TWD")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class FiscalPeriod(Base, TimestampMixin):
    __tablename__ = "finance_fiscal_periods"
    __table_args__ = (UniqueConstraint("ledger_id", "name", name="uq_finance_period_name"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ledger_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("finance_ledgers.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    starts_on: Mapped[date] = mapped_column(Date, nullable=False)
    ends_on: Mapped[date] = mapped_column(Date, nullable=False)
    is_closed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class ChartAccount(Base, TimestampMixin):
    __tablename__ = "finance_chart_accounts"
    __table_args__ = (UniqueConstraint("ledger_id", "code", name="uq_finance_account_code"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ledger_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("finance_ledgers.id"), nullable=False
    )
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    account_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class FundAccount(Base, TimestampMixin):
    """實體保管點：零用金、保險箱或銀行帳戶，且必須對應資產科目。"""

    __tablename__ = "finance_fund_accounts"
    __table_args__ = (UniqueConstraint("ledger_id", "name", name="uq_finance_fund_name"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ledger_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("finance_ledgers.id"), nullable=False
    )
    chart_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("finance_chart_accounts.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    storage_type: Mapped[str] = mapped_column(String(20), nullable=False)
    bank_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    account_last_four: Mapped[str | None] = mapped_column(String(4), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class JournalEntry(Base, TimestampMixin):
    __tablename__ = "finance_journal_entries"
    __table_args__ = (
        Index("ix_finance_journal_ledger_status", "ledger_id", "status"),
        Index("ix_finance_journal_proposing_org", "proposing_org_id"),
        Index("ix_finance_journal_advanced_by", "advanced_by_id"),
        UniqueConstraint(
            "ledger_id", "source_type", "source_id", "source_event", name="uq_finance_source_event"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ledger_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("finance_ledgers.id"), nullable=False
    )
    period_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("finance_fiscal_periods.id"), nullable=False
    )
    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    description: Mapped[str] = mapped_column(String(300), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default=JournalStatus.DRAFT)
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    reviewed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    source_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    source_event: Mapped[str | None] = mapped_column(String(60), nullable=True)
    source_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    evidence_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    claim_status: Mapped[str | None] = mapped_column(String(24), nullable=True, index=True)
    procurement_status: Mapped[str | None] = mapped_column(String(24), nullable=True)
    procurement_updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    procurement_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    payment_status: Mapped[str | None] = mapped_column(String(24), nullable=True)
    payment_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    payment_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    budget_included: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    budget_included_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    budget_included_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    proposing_org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id"), nullable=True
    )
    advanced_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    payment_method: Mapped[str] = mapped_column(
        String(20), nullable=False, default=ExpensePaymentMethod.DIRECT
    )
    reimbursement_entry_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("finance_journal_entries.id"), nullable=True
    )
    reversal_of_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("finance_journal_entries.id"), nullable=True
    )


class JournalLine(Base, TimestampMixin):
    __tablename__ = "finance_journal_lines"
    __table_args__ = (Index("ix_finance_line_account", "account_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("finance_journal_entries.id", ondelete="CASCADE"),
        nullable=False,
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("finance_chart_accounts.id"), nullable=False
    )
    debit: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    credit: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    memo: Mapped[str | None] = mapped_column(String(240), nullable=True)


class ExpenseClaimItem(Base, TimestampMixin):
    """報帳傳票的逐項明細，保留品項、單價與數量供日後稽核。"""

    __tablename__ = "finance_expense_claim_items"
    __table_args__ = (Index("ix_finance_claim_item_budget_node", "budget_node_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    journal_entry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("finance_journal_entries.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    unit_price: Mapped[int] = mapped_column(Integer, nullable=False)
    tax_rate: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    unit: Mapped[str] = mapped_column(String(32), nullable=False, default="項")
    budget_node_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("finance_budget_nodes.id"), nullable=True
    )
    budget_exception_note: Mapped[str | None] = mapped_column(String(500), nullable=True)


class FinanceBudget(Base, TimestampMixin):
    __tablename__ = "finance_budgets"
    __table_args__ = (
        UniqueConstraint("ledger_id", "period_id", name="uq_finance_budget_period"),
        Index("ix_finance_budgets_ledger", "ledger_id"),
        Index("ix_finance_budgets_period", "period_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ledger_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("finance_ledgers.id"), nullable=False
    )
    period_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("finance_fiscal_periods.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class FinanceBudgetSubmission(Base, TimestampMixin):
    __tablename__ = "finance_budget_submissions"
    __table_args__ = (Index("ix_finance_budget_submission_status", "budget_id", "status"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    budget_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("finance_budgets.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(
        String(20), nullable=False, default=BudgetSubmissionKind.INITIAL
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=BudgetSubmissionStatus.DRAFT, index=True
    )
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)


class FinanceBudgetNode(Base, TimestampMixin):
    __tablename__ = "finance_budget_nodes"
    __table_args__ = (
        UniqueConstraint("budget_id", "parent_id", "name", name="uq_finance_budget_node_name"),
        Index("ix_finance_budget_node_parent", "budget_id", "parent_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    budget_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("finance_budgets.id", ondelete="CASCADE"), nullable=False
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("finance_budget_nodes.id", ondelete="CASCADE"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class FinanceBudgetAllocation(Base, TimestampMixin):
    __tablename__ = "finance_budget_allocations"
    __table_args__ = (Index("ix_finance_budget_allocation_node", "node_id", "submission_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    submission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("finance_budget_submissions.id", ondelete="CASCADE"),
        nullable=False,
    )
    node_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("finance_budget_nodes.id"), nullable=False
    )
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    unit_price: Mapped[int | None] = mapped_column(Integer, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    proposed_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    proposing_org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id"), nullable=False
    )


class FinanceBudgetAllocationRevision(Base, TimestampMixin):
    __tablename__ = "finance_budget_allocation_revisions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    allocation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("finance_budget_allocations.id", ondelete="CASCADE"),
        nullable=False,
    )
    previous_amount: Mapped[int] = mapped_column(Integer, nullable=False)
    next_amount: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    changed_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    previous_details: Mapped[dict | None] = mapped_column(JSONDict, nullable=True)
    next_details: Mapped[dict | None] = mapped_column(JSONDict, nullable=True)


class FinanceBudgetAllocationEvidence(Base, TimestampMixin):
    __tablename__ = "finance_budget_allocation_evidence"
    __table_args__ = (Index("ix_finance_budget_evidence_allocation", "allocation_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    allocation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("finance_budget_allocations.id", ondelete="CASCADE"),
        nullable=False,
    )
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    uploaded_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )


class ExpenseClaimItemEvidence(Base, TimestampMixin):
    __tablename__ = "finance_expense_claim_item_evidence"
    __table_args__ = (Index("ix_finance_expense_claim_item_evidence_item", "item_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("finance_expense_claim_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    evidence_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default=ExpenseEvidenceType.RECEIPT
    )
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    uploaded_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )


class BankTransaction(Base, TimestampMixin):
    __tablename__ = "finance_bank_transactions"
    __table_args__ = (
        UniqueConstraint("fund_account_id", "external_id", name="uq_finance_bank_external"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    fund_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("finance_fund_accounts.id"), nullable=False
    )
    external_id: Mapped[str] = mapped_column(String(180), nullable=False)
    occurred_on: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str] = mapped_column(String(300), nullable=False)
    journal_entry_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("finance_journal_entries.id"), nullable=True
    )
    raw: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict)
