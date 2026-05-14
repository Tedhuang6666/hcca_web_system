"""問卷系統 Pydantic Schemas"""

from __future__ import annotations

import json
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from api.models.survey import QuestionType, SurveyStatus

# ── 問題 ─────────────────────────────────────────────────────────────────────


DISPLAY_QUESTION_TYPES = {
    QuestionType.SECTION_TEXT,
    QuestionType.PAGE_BREAK,
    QuestionType.IMAGE,
    QuestionType.VIDEO,
}


class SurveyQuestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    survey_id: uuid.UUID
    order_index: int
    question_text: str
    question_type: QuestionType
    is_required: bool
    options: list[str] = Field(default_factory=list)
    min_value: int | None
    max_value: int | None
    placeholder: str | None

    @classmethod
    def model_validate(cls, obj, **kwargs):  # type: ignore[override]
        instance = super().model_validate(obj, **kwargs)
        # 從 options_json 解析 options 清單
        raw = getattr(obj, "options_json", None)
        if raw:
            try:
                instance.options = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                instance.options = []
        return instance


class SurveyQuestionCreate(BaseModel):
    question_text: str = Field(..., min_length=1, max_length=1000)
    question_type: QuestionType = QuestionType.TEXT
    is_required: bool = True
    options: list[str] = Field(default_factory=list, description="選項（SINGLE/MULTIPLE 題型）")
    min_value: int | None = Field(None, ge=1, description="最小評分")
    max_value: int | None = Field(None, ge=1, le=10, description="最大評分")
    placeholder: str | None = Field(None, max_length=300)
    order_index: int = Field(0, ge=0)

    @field_validator("options")
    @classmethod
    def validate_options(cls, v: list[str], info) -> list[str]:  # type: ignore[misc]
        return [o.strip() for o in v if o.strip()]

    @field_validator("is_required")
    @classmethod
    def display_blocks_are_not_required(cls, v: bool, info) -> bool:  # type: ignore[misc]
        question_type = info.data.get("question_type")
        if question_type in DISPLAY_QUESTION_TYPES:
            return False
        return v


class SurveyQuestionUpdate(BaseModel):
    question_text: str | None = Field(None, min_length=1, max_length=1000)
    is_required: bool | None = None
    options: list[str] | None = None
    min_value: int | None = None
    max_value: int | None = None
    placeholder: str | None = None
    order_index: int | None = Field(None, ge=0)


# ── 問卷 ─────────────────────────────────────────────────────────────────────


class SurveyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str | None
    status: SurveyStatus
    is_anonymous: bool
    allow_multiple: bool
    opens_at: datetime | None
    closes_at: datetime | None
    org_id: uuid.UUID
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime
    questions: list[SurveyQuestionOut] = []
    response_count: int = 0


class SurveyListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    status: SurveyStatus
    is_anonymous: bool
    opens_at: datetime | None
    closes_at: datetime | None
    org_id: uuid.UUID
    created_by: uuid.UUID
    created_at: datetime
    response_count: int = 0


class SurveyCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)
    description: str | None = Field(None, max_length=2000)
    is_anonymous: bool = False
    allow_multiple: bool = False
    opens_at: datetime | None = None
    closes_at: datetime | None = None
    org_id: uuid.UUID


class SurveyUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=300)
    description: str | None = None
    opens_at: datetime | None = None
    closes_at: datetime | None = None


# ── 答案 ─────────────────────────────────────────────────────────────────────


class AnswerSubmit(BaseModel):
    question_id: uuid.UUID
    answer_text: str | None = Field(None, max_length=5000)
    answer_options: list[str] = Field(default_factory=list)


class SurveySubmit(BaseModel):
    answers: list[AnswerSubmit] = Field(..., min_length=1)
    anon_token: str | None = Field(
        None, max_length=64, description="匿名填答 token（由客戶端生成）"
    )


# ── 回應（填答記錄） ──────────────────────────────────────────────────────────


class SurveyAnswerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    question_id: uuid.UUID
    answer_text: str | None
    answer_options: list[str] = Field(default_factory=list)

    @classmethod
    def model_validate(cls, obj, **kwargs):  # type: ignore[override]
        instance = super().model_validate(obj, **kwargs)
        raw = getattr(obj, "answer_json", None)
        if raw:
            try:
                instance.answer_options = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                instance.answer_options = []
        return instance


class SurveyResponseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    survey_id: uuid.UUID
    # 匿名問卷不回傳 respondent_id
    submitted_at: datetime
    answers: list[SurveyAnswerOut] = []


# ── 統計（管理員用） ──────────────────────────────────────────────────────────


class QuestionStats(BaseModel):
    question_id: uuid.UUID
    question_text: str
    question_type: QuestionType
    total_responses: int
    # SINGLE / MULTIPLE：各選項票數
    option_counts: dict[str, int] = Field(default_factory=dict)
    # TEXT / TEXTAREA：所有文字回答
    text_answers: list[str] = Field(default_factory=list)
    # RATING：平均分
    average_rating: float | None = None
    suggested_chart: str = "list"
    available_charts: list[str] = Field(default_factory=list)


class SurveyStats(BaseModel):
    survey_id: uuid.UUID
    title: str
    total_responses: int
    questions: list[QuestionStats] = Field(default_factory=list)
