"""自治機關專頁 schema。"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from api.models.agency import AgencyBranch
from api.schemas.site import PublicOfficerOut

AgencyEntryKind = Literal[
    "document",
    "policy",
    "achievement",
    "session",
    "bill",
    "committee",
    "finance",
    "procedure",
    "decision",
    "meeting",
    "proposal",
    "rights",
    "event",
    "template",
]
AgencyEntryStatus = Literal[
    "planned",
    "in_progress",
    "completed",
    "under_review",
    "passed",
    "rejected",
    "withdrawn",
    "decided",
    "dismissed",
    "adopted",
    "tracking",
]

# 各機關可用的公開項目；document（文件公開）與 event（重要日程）為共通項目。
_COMMON_KINDS = frozenset({"document", "event"})
BRANCH_ENTRY_KINDS: dict[AgencyBranch, frozenset[str]] = {
    AgencyBranch.EXECUTIVE: _COMMON_KINDS | {"policy", "achievement"},
    AgencyBranch.LEGISLATIVE: _COMMON_KINDS | {"session", "bill", "committee", "finance"},
    AgencyBranch.JUDICIAL: _COMMON_KINDS | {"procedure", "template", "decision"},
    AgencyBranch.DELEGATION: _COMMON_KINDS | {"meeting", "proposal", "rights"},
}

_SLUG = r"^[a-z0-9][a-z0-9-]*$"
# 與 /agencies 底下固定路徑相撞的 slug
RESERVED_SLUGS = frozenset({"manage", "calendar", "council-proposals"})


def _check_slug(value: str | None) -> str | None:
    if value in RESERVED_SLUGS:
        raise ValueError("此 slug 為系統保留字")
    return value


_URL = r"^(https?://|/)"


class AgencyProfileCreate(BaseModel):
    slug: str = Field(..., min_length=1, max_length=40, pattern=_SLUG)
    branch: AgencyBranch
    name: str = Field(..., min_length=1, max_length=100)
    org_id: uuid.UUID | None = None
    tagline: str | None = Field(None, max_length=200)
    intro_md: str = ""
    sort_order: int = 0

    _slug = field_validator("slug")(_check_slug)


class AgencyProfileUpdate(BaseModel):
    """機關維護者可改的內容欄位。"""

    name: str | None = Field(None, min_length=1, max_length=100)
    tagline: str | None = Field(None, max_length=200)
    intro_md: str | None = None
    mandate_md: str | None = None
    contact_md: str | None = None
    is_published: bool | None = None


class AgencyProfileAdminUpdate(AgencyProfileUpdate):
    """只有網站管理員可改的結構欄位。"""

    slug: str | None = Field(None, min_length=1, max_length=40, pattern=_SLUG)
    org_id: uuid.UUID | None = None
    sort_order: int | None = None

    _slug = field_validator("slug")(_check_slug)


class AgencyProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    branch: AgencyBranch
    name: str
    tagline: str | None
    org_id: uuid.UUID | None
    intro_md: str
    mandate_md: str | None
    contact_md: str | None
    is_published: bool
    sort_order: int
    updated_at: datetime


class AgencyManageOut(AgencyProfileOut):
    org_name: str | None = None
    # 是否可改 slug／維護組織等結構欄位
    can_admin: bool = False


class AgencyEntryBase(BaseModel):
    kind: AgencyEntryKind
    title: str = Field(..., min_length=1, max_length=200)
    reference_no: str | None = Field(None, max_length=60)
    status: AgencyEntryStatus | None = None
    summary: str | None = None
    body_md: str | None = None
    outcome_md: str | None = None
    occurred_on: date | None = None
    link_url: str | None = Field(None, max_length=500, pattern=_URL)
    show_on_calendar: bool = False
    is_published: bool = False
    sort_order: int = 0


class AgencyEntryCreate(AgencyEntryBase):
    pass


class AgencyEntryUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    reference_no: str | None = Field(None, max_length=60)
    status: AgencyEntryStatus | None = None
    summary: str | None = None
    body_md: str | None = None
    outcome_md: str | None = None
    occurred_on: date | None = None
    link_url: str | None = Field(None, max_length=500, pattern=_URL)
    show_on_calendar: bool | None = None
    is_published: bool | None = None
    sort_order: int | None = None


class AgencyEntryOut(AgencyEntryBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    agency_id: uuid.UUID
    updated_at: datetime


class AgencyListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    slug: str
    branch: AgencyBranch
    name: str
    tagline: str | None


class AgencyLinkedRecord(BaseModel):
    """既有流程的公開案件：受理後的議案（含提案人）、已公布的評議結果（不含聲請人）。"""

    id: uuid.UUID
    reference_no: str
    title: str
    category: str
    status: str
    proposer_name: str | None = None
    summary: str | None
    submitted_at: datetime
    decided_at: datetime | None


class CouncilProposalPublicOut(BaseModel):
    """議案公開內容；不含聯絡人與 email。"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    serial_number: str
    case_type: str
    kind: str | None
    title: str
    status: str
    proposer_name: str
    co_sponsors: str | None
    summary: str
    legal_basis: str | None
    proposal_text: str
    rationale: str
    expected_effect: str | None
    created_at: datetime
    decided_at: datetime | None


class AgencyCalendarItem(BaseModel):
    id: uuid.UUID
    date: date
    title: str
    kind: AgencyEntryKind
    summary: str | None
    link_url: str | None
    agency_slug: str
    agency_name: str
    agency_branch: AgencyBranch


class AgencyPublicOut(BaseModel):
    agency: AgencyProfileOut
    entries: list[AgencyEntryOut]
    members: list[PublicOfficerOut]
    linked_records: list[AgencyLinkedRecord]
