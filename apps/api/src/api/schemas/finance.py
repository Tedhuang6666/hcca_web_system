from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from api.models.finance import FinanceAccountType, FundStorageType, JournalStatus


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
    debit: int = Field(default=0, ge=0)
    credit: int = Field(default=0, ge=0)
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


class TransferCreate(BaseModel):
    period_id: uuid.UUID
    entry_date: date
    from_fund_account_id: uuid.UUID
    to_fund_account_id: uuid.UUID
    amount: int = Field(gt=0)
    description: str = Field(min_length=1, max_length=300)
    note: str | None = None


class JournalLineOut(JournalLineIn):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    account_name: str = ""


class JournalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    ledger_id: uuid.UUID
    period_id: uuid.UUID
    entry_date: date
    description: str
    status: JournalStatus
    created_by_id: uuid.UUID
    reviewed_by_id: uuid.UUID | None
    posted_at: datetime | None
    source_type: str | None
    source_id: uuid.UUID | None
    source_event: str | None
    source_url: str | None
    evidence_url: str | None
    note: str | None
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
