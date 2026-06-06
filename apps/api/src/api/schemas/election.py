"""即時開票紀錄系統 Pydantic schemas。"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from api.models.election import BallotBoxStatus, ElectionStatus, VoteEventKind


class CandidateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    number: int = Field(ge=1)
    color: str = Field("#2563eb", pattern=r"^#[0-9A-Fa-f]{6}$")
    sort_order: int = Field(0, ge=0)


class CandidateOut(CandidateCreate):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    election_id: uuid.UUID
    is_active: bool


class BallotBoxCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    expected_total_votes: int | None = Field(None, ge=0)
    sort_order: int = Field(0, ge=0)


class BallotBoxOut(BallotBoxCreate):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    election_id: uuid.UUID
    status: BallotBoxStatus


class ElectionCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(None, max_length=2000)
    is_public: bool = True
    candidates: list[CandidateCreate] = Field(min_length=1)
    ballot_boxes: list[BallotBoxCreate] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_unique_children(self) -> "ElectionCreate":
        if len({item.number for item in self.candidates}) != len(self.candidates):
            raise ValueError("候選人號次不可重複")
        names = [item.name.strip() for item in self.ballot_boxes]
        if len(set(names)) != len(names):
            raise ValueError("票匭名稱不可重複")
        return self


class ElectionUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = Field(None, max_length=2000)
    is_public: bool | None = None


class ElectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str | None
    status: ElectionStatus
    is_public: bool
    created_by_id: uuid.UUID
    candidates: list[CandidateOut]
    ballot_boxes: list[BallotBoxOut]
    created_at: datetime
    updated_at: datetime


class ElectionListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    status: ElectionStatus
    is_public: bool
    created_at: datetime
    updated_at: datetime


class ElectionStatusUpdate(BaseModel):
    status: ElectionStatus


class BallotBoxStatusUpdate(BaseModel):
    status: BallotBoxStatus


class VoteEventCreate(BaseModel):
    ballot_box_id: uuid.UUID
    candidate_id: uuid.UUID | None = None
    kind: VoteEventKind = VoteEventKind.CANDIDATE
    delta: int = Field(ge=-10000, le=10000)
    reason: str = Field("正常唱票", min_length=1, max_length=300)

    @model_validator(mode="after")
    def validate_target(self) -> "VoteEventCreate":
        if self.delta == 0:
            raise ValueError("票數異動不可為 0")
        if self.kind == VoteEventKind.CANDIDATE and self.candidate_id is None:
            raise ValueError("候選票必須指定候選人")
        if self.kind == VoteEventKind.INVALID and self.candidate_id is not None:
            raise ValueError("廢票事件不可指定候選人")
        return self


class VoteEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    election_id: uuid.UUID
    ballot_box_id: uuid.UUID
    candidate_id: uuid.UUID | None
    kind: VoteEventKind
    delta: int
    reason: str
    operator_id: uuid.UUID
    operator_name: str
    ballot_box_name: str
    candidate_name: str | None
    reverses_event_id: uuid.UUID | None
    created_at: datetime


class CandidateTally(BaseModel):
    candidate_id: uuid.UUID
    name: str
    number: int
    color: str
    votes: int
    percentage: float


class BallotBoxTally(BaseModel):
    ballot_box_id: uuid.UUID
    name: str
    status: BallotBoxStatus
    counted_votes: int
    invalid_votes: int
    expected_total_votes: int | None
    progress_percentage: float | None


class ElectionLiveSummary(BaseModel):
    election_id: uuid.UUID
    title: str
    status: ElectionStatus
    total_votes: int
    valid_votes: int
    invalid_votes: int
    expected_total_votes: int | None
    progress_percentage: float | None
    leader_candidate_id: uuid.UUID | None
    current_ballot_boxes: list[str]
    candidates: list[CandidateTally]
    ballot_boxes: list[BallotBoxTally]
    last_updated_at: datetime
