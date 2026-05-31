"""人員主檔與身分歸屬 schemas。"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from api.models.person import (
    PersonAffiliationKind,
    PersonAffiliationSource,
    PersonAffiliationStatus,
    PersonStatus,
)


class PersonBase(BaseModel):
    student_id: str | None = Field(None, max_length=20)
    display_name: str = Field(..., min_length=1, max_length=100)
    legal_name: str | None = Field(None, max_length=100)
    email: str | None = Field(None, max_length=255)
    status: PersonStatus = PersonStatus.ACTIVE
    note: str | None = None


class PersonCreate(PersonBase):
    user_id: uuid.UUID | None = None


class PersonUpdate(BaseModel):
    user_id: uuid.UUID | None = None
    student_id: str | None = Field(None, max_length=20)
    display_name: str | None = Field(None, min_length=1, max_length=100)
    legal_name: str | None = Field(None, max_length=100)
    email: str | None = Field(None, max_length=255)
    status: PersonStatus | None = None
    note: str | None = None


class PersonOut(PersonBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime


class PersonListItem(PersonOut):
    active_affiliation_count: int = 0
    class_labels: list[str] = []
    role_titles: list[str] = []


class PersonAffiliationCreate(BaseModel):
    person_id: uuid.UUID
    kind: PersonAffiliationKind
    academic_year: int | None = Field(None, ge=1, le=999)
    class_id: uuid.UUID | None = None
    org_id: uuid.UUID | None = None
    position_id: uuid.UUID | None = None
    role_key: str | None = Field(None, max_length=50)
    title: str | None = Field(None, max_length=100)
    start_date: date | None = None
    end_date: date | None = None
    source: PersonAffiliationSource = PersonAffiliationSource.MANUAL
    note: str | None = None

    @model_validator(mode="after")
    def validate_scope(self) -> PersonAffiliationCreate:
        if (
            self.end_date is not None
            and self.start_date is not None
            and self.end_date < self.start_date
        ):
            raise ValueError("end_date 不能早於 start_date")
        if self.kind == PersonAffiliationKind.CLASS_MEMBER and self.class_id is None:
            raise ValueError("class_member 必須提供 class_id")
        if self.kind == PersonAffiliationKind.CLASS_ROLE and self.class_id is None:
            raise ValueError("class_role 必須提供 class_id")
        if self.kind == PersonAffiliationKind.ORG_POSITION and self.position_id is None:
            raise ValueError("org_position 必須提供 position_id")
        return self


class PersonAffiliationUpdate(BaseModel):
    start_date: date | None = None
    end_date: date | None = None
    status: PersonAffiliationStatus | None = None
    title: str | None = Field(None, max_length=100)
    note: str | None = None


class PersonAffiliationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    person_id: uuid.UUID
    kind: PersonAffiliationKind
    academic_year: int | None = None
    class_id: uuid.UUID | None = None
    class_label: str | None = None
    org_id: uuid.UUID | None = None
    org_name: str | None = None
    position_id: uuid.UUID | None = None
    position_name: str | None = None
    role_key: str | None = None
    title: str | None = None
    start_date: date
    end_date: date | None = None
    status: PersonAffiliationStatus
    source: PersonAffiliationSource
    synced_user_position_id: uuid.UUID | None = None
    note: str | None = None
    created_at: datetime
    updated_at: datetime


class PersonDetailOut(PersonOut):
    affiliations: list[PersonAffiliationOut] = []


class PersonRosterImportRow(BaseModel):
    student_id: str = Field(..., min_length=1, max_length=20)
    display_name: str = Field(..., min_length=1, max_length=100)
    email: str | None = Field(None, max_length=255)
    class_id: uuid.UUID | None = None
    academic_year: int | None = Field(None, ge=1, le=999)
    note: str | None = None


class PersonRosterImport(BaseModel):
    rows: list[PersonRosterImportRow] = Field(..., min_length=1, max_length=2000)


class PersonRosterImportResult(BaseModel):
    total: int
    people_created: int
    people_updated: int
    affiliations_created: int
    skipped: int


__all__ = [
    "PersonAffiliationCreate",
    "PersonAffiliationOut",
    "PersonAffiliationUpdate",
    "PersonCreate",
    "PersonDetailOut",
    "PersonListItem",
    "PersonOut",
    "PersonRosterImport",
    "PersonRosterImportResult",
    "PersonUpdate",
]
