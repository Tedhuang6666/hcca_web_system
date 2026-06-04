"""跨模組情境脈絡 schemas。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class ContextLink(BaseModel):
    title: str
    href: str
    kind: str
    timestamp: datetime | None = None


class MeetingBriefingCardOut(BaseModel):
    meeting_id: uuid.UUID
    my_role: str | None = None
    attendance_status: str | None = None
    agenda_items: list[ContextLink] = Field(default_factory=list)
    related_items: list[ContextLink] = Field(default_factory=list)
    recommended_actions: list[str] = Field(default_factory=list)


class DocumentApprovalContextOut(BaseModel):
    document_id: uuid.UUID
    source_activity: ContextLink | None = None
    related_items: list[ContextLink] = Field(default_factory=list)
    previous_comments: list[str] = Field(default_factory=list)
    recommended_actions: list[str] = Field(default_factory=list)


class PetitionResolutionContextOut(BaseModel):
    petition_id: uuid.UUID
    related_regulations: list[ContextLink] = Field(default_factory=list)
    similar_petitions: list[ContextLink] = Field(default_factory=list)
    related_activities: list[ContextLink] = Field(default_factory=list)
    recommended_actions: list[str] = Field(default_factory=list)


class RegulationUsageContextOut(BaseModel):
    regulation_id: uuid.UUID
    related_documents: list[ContextLink] = Field(default_factory=list)
    related_meetings: list[ContextLink] = Field(default_factory=list)
    related_petitions: list[ContextLink] = Field(default_factory=list)
    related_announcements: list[ContextLink] = Field(default_factory=list)
    pending_reviews: list[ContextLink] = Field(default_factory=list)
