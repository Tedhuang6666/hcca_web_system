"""議會提案 schemas。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from api.models.council_proposal import CouncilProposalKind, CouncilProposalStatus


class CouncilProposalCreate(BaseModel):
    contact_name: str | None = Field(None, max_length=100)
    contact_email: EmailStr
    proposer_name: str = Field(..., min_length=1, max_length=100)
    co_sponsors: str | None = Field(None, max_length=5000)
    kind: CouncilProposalKind
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


class CouncilProposalListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    serial_number: str
    submitter_id: uuid.UUID | None
    proposer_name: str
    kind: CouncilProposalKind
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
