"""議會提案 schemas。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from api.models.council_proposal import (
    CouncilProposalCaseType,
    CouncilProposalKind,
    CouncilProposalStatus,
)


class CouncilProposalCreate(BaseModel):
    contact_name: str | None = Field(None, max_length=100)
    contact_email: EmailStr
    proposer_name: str = Field(..., min_length=1, max_length=100)
    co_sponsors: str | None = Field(None, max_length=5000)
    case_type: CouncilProposalCaseType = CouncilProposalCaseType.REGULATION
    # 法規案子類型（制定/修正/廢止）；非法規案請留空。
    kind: CouncilProposalKind | None = None
    # 法規案連結既有法規；修正/廢止案必填。
    regulation_id: uuid.UUID | None = None
    title: str = Field(..., min_length=1, max_length=200)
    summary: str = Field(..., min_length=1, max_length=5000)
    legal_basis: str | None = Field(None, max_length=5000)
    proposal_text: str = Field(..., min_length=1, max_length=20000)
    rationale: str = Field(..., min_length=1, max_length=20000)
    expected_effect: str | None = Field(None, max_length=10000)

    @field_validator("contact_name", "co_sponsors", "legal_basis", "expected_effect")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @model_validator(mode="after")
    def _check_case_type_consistency(self) -> "CouncilProposalCreate":
        if self.case_type == CouncilProposalCaseType.REGULATION:
            if self.kind is None:
                raise ValueError("法規案需指定子類型（制定/修正/廢止）")
            if self.kind in {CouncilProposalKind.AMEND, CouncilProposalKind.ABOLISH} and self.regulation_id is None:
                raise ValueError("修正案與廢止案需連結既有法規")
        else:
            # 非法規案不帶法規子類型與法規連結，避免髒資料。
            self.kind = None
            self.regulation_id = None
        return self


class CouncilProposalListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    serial_number: str
    submitter_id: uuid.UUID | None
    proposer_name: str
    case_type: CouncilProposalCaseType
    kind: CouncilProposalKind | None
    regulation_id: uuid.UUID | None
    regulation_title: str | None
    title: str
    summary: str
    status: CouncilProposalStatus
    scheduled_at: datetime | None
    decided_at: datetime | None
    created_at: datetime
    updated_at: datetime


class CouncilProposalOut(CouncilProposalListItem):
    contact_name: str | None
    contact_email: str
    co_sponsors: str | None
    legal_basis: str | None
    proposal_text: str
    rationale: str
    expected_effect: str | None
    committee_review_note: str | None
    scheduled_meeting_id: uuid.UUID | None


class CouncilProposalStatusUpdate(BaseModel):
    status: CouncilProposalStatus
    committee_review_note: str | None = Field(None, max_length=5000)
    scheduled_meeting_id: uuid.UUID | None = None


class CouncilProposalSchedule(BaseModel):
    """常委會審查通過後，把提案排入指定會議（大會）議程。"""

    meeting_id: uuid.UUID
    note: str | None = Field(None, max_length=5000)


class EligibleMeetingBrief(BaseModel):
    """可排入提案的會議摘要。"""

    id: uuid.UUID
    title: str
    status: str
    bill_stage: str | None
    starts_at: datetime | None
    already_scheduled: bool
