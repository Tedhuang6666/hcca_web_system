"""段考題庫 Pydantic schemas。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from api.models.exam_paper import ExamGradeTrack


class ExamPaperUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    subject: str | None = Field(None, min_length=1, max_length=80)
    academic_year: int | None = Field(None, ge=1, le=999)
    semester: int | None = Field(None, ge=1, le=2)
    grade: int | None = Field(None, ge=1, le=3)
    grade_track: ExamGradeTrack | None = None
    exam_number: int | None = Field(None, ge=1, le=4)
    is_published: bool | None = None


class ExamPaperListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    subject: str
    academic_year: int
    semester: int
    grade: int
    grade_track: ExamGradeTrack | None
    exam_number: int
    filename: str
    file_size: int
    is_published: bool
    uploaded_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class ExamPaperOut(ExamPaperListItem):
    content_type: str
    is_active: bool


class ExamPaperDownloadOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    paper_id: uuid.UUID
    user_id: uuid.UUID
    trace_code: str
    file_sha256: str | None
    ip_address: str | None
    user_agent: str | None
    downloaded_at: datetime
    user_display_name: str = ""
    user_email: str = ""
    user_student_id: str | None = None


class ExamTraceInspectMatch(BaseModel):
    trace_code: str
    download_id: uuid.UUID
    paper_id: uuid.UUID
    paper_title: str
    user_id: uuid.UUID
    user_display_name: str
    user_email: str
    user_student_id: str | None
    downloaded_at: datetime
    confidence: str


class ExamTraceInspectOut(BaseModel):
    detected_trace_codes: list[str]
    matches: list[ExamTraceInspectMatch]
    unsupported_reason: str | None = None
