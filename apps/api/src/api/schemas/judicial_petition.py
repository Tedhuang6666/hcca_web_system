"""評議委員會訴訟 schemas。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from api.models.judicial_petition import JudicialPetitionStatus, JudicialPetitionType


class JudicialPetitionCreate(BaseModel):
    petitioner_name: str = Field(..., min_length=1, max_length=100)
    petitioner_email: EmailStr
    representative: str | None = Field(None, max_length=100)
    respondent: str | None = Field(None, max_length=200)
    petition_type: JudicialPetitionType = JudicialPetitionType.CONSTITUTIONAL_NORM_REVIEW
    title: str = Field(..., min_length=1, max_length=200)
    challenged_norm: str = Field(..., min_length=1, max_length=10000)
    constitutional_provisions: str = Field(..., min_length=1, max_length=10000)
    petition_claim: str = Field(..., min_length=1, max_length=20000)
    facts_and_reasons: str = Field(..., min_length=1, max_length=30000)
    evidence: str | None = Field(None, max_length=20000)
    attachments_description: str | None = Field(None, max_length=10000)

    @field_validator("representative", "respondent", "evidence", "attachments_description")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class JudicialPetitionListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    docket_number: str
    submitter_id: uuid.UUID | None
    petitioner_name: str
    petition_type: JudicialPetitionType
    title: str
    status: JudicialPetitionStatus
    decided_at: datetime | None
    created_at: datetime
    updated_at: datetime


class JudicialPetitionOut(JudicialPetitionListItem):
    petitioner_email: str
    representative: str | None
    respondent: str | None
    challenged_norm: str
    constitutional_provisions: str
    petition_claim: str
    facts_and_reasons: str
    evidence: str | None
    attachments_description: str | None
    docketing_note: str | None
    decision_summary: str | None


class JudicialPetitionStatusUpdate(BaseModel):
    status: JudicialPetitionStatus
    docketing_note: str | None = Field(None, max_length=5000)
    decision_summary: str | None = Field(None, max_length=10000)
