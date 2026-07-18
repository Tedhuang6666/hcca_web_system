"""班聯會複式簿記與資金保管模型。"""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
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

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    journal_entry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("finance_journal_entries.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    unit_price: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)


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
