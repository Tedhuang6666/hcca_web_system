"""問卷系統 Pydantic Schemas"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from api.models.survey import QuestionType, SurveyStatus, ValidationRule


def _parse_json_list(raw: object) -> list[str]:
    """安全解析 JSON 陣列字串，失敗時回傳空清單。"""
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
    return parsed if isinstance(parsed, list) else []


def _parse_json_nested_list(raw: object) -> list[list[str]]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
    return (
        [
            [str(value) for value in values if isinstance(value, str)]
            for values in parsed
            if isinstance(values, list)
        ]
        if isinstance(parsed, list)
        else []
    )


# ── 問題 ─────────────────────────────────────────────────────────────────────


DISPLAY_QUESTION_TYPES = {
    QuestionType.SECTION_TEXT,
    QuestionType.PAGE_BREAK,
    QuestionType.IMAGE,
    QuestionType.VIDEO,
}


class ConditionRule(BaseModel):
    """單一條件判斷規則。"""

    question_id: uuid.UUID
    operator: Literal["equals", "contains"]
    value: str = Field("", max_length=500)
    # 與「前一條規則」的連接方式（第一條規則忽略此欄位）
    connector: Literal["and", "or"] = "and"


class QuestionCondition(BaseModel):
    """題目（或分頁）的顯示條件：多條規則由上到下依序左結合評估。"""

    rules: list[ConditionRule] = Field(..., min_length=1)


def _parse_condition(raw: object) -> QuestionCondition | None:
    """安全解析 condition_json，失敗時回傳 None。"""
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    try:
        return QuestionCondition.model_validate(data)
    except ValueError:
        return None


class OptionConfig(BaseModel):
    """選項額外設定：標記哪些選項為互斥／允許自由輸入。

    exclusive：多選題中勾選後會清空其他選項（如「以上皆非」）。
    other：允許在選項後附加自由輸入文字（提交時存到 answer.other_text）。
    """

    exclusive: list[str] = Field(default_factory=list)
    other: list[str] = Field(default_factory=list)


def _parse_option_config(raw: object) -> OptionConfig | None:
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    try:
        cfg = OptionConfig.model_validate(data)
    except ValueError:
        return None
    return cfg if (cfg.exclusive or cfg.other) else None


class SurveyQuestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    survey_id: uuid.UUID
    order_index: int
    question_text: str
    question_type: QuestionType
    is_required: bool
    options: list[str] = Field(default_factory=list)
    option_image_sets: list[list[str]] = Field(default_factory=list)
    min_value: int | None
    max_value: int | None
    placeholder: str | None
    image_url: str | None = None
    min_length: int | None = None
    max_length: int | None = None
    validation_rule: ValidationRule | None = None
    min_label: str | None = None
    max_label: str | None = None
    condition: QuestionCondition | None = None
    option_config: OptionConfig | None = None

    @model_validator(mode="before")
    @classmethod
    def _from_orm(cls, data: Any) -> Any:
        """ORM 物件的 options_json 欄位需轉成 options 清單。

        FastAPI 以 TypeAdapter 序列化回應，不會呼叫被覆寫的 model_validate
        classmethod，故改用 before validator 確保巢狀題目也能正確解析選項。
        """
        if isinstance(data, dict):
            return data
        fields = (
            "id",
            "survey_id",
            "order_index",
            "question_text",
            "question_type",
            "is_required",
            "min_value",
            "max_value",
            "placeholder",
            "image_url",
            "min_length",
            "max_length",
            "validation_rule",
            "min_label",
            "max_label",
        )
        result: dict[str, Any] = {f: getattr(data, f, None) for f in fields}
        result["options"] = _parse_json_list(getattr(data, "options_json", None))
        result["option_image_sets"] = _parse_json_nested_list(
            getattr(data, "option_image_sets_json", None)
        )
        result["condition"] = _parse_condition(getattr(data, "condition_json", None))
        result["option_config"] = _parse_option_config(getattr(data, "option_config_json", None))
        return result


class SurveyQuestionCreate(BaseModel):
    # 純顯示區塊（圖片、分頁等）可不填文字，由 _require_text_for_questions 驗證。
    question_text: str = Field("", max_length=1000)
    question_type: QuestionType = QuestionType.TEXT
    is_required: bool = True
    options: list[str] = Field(
        default_factory=list, description="選項（SINGLE/MULTIPLE/RANKING 題型）"
    )
    option_image_sets: list[list[str]] = Field(
        default_factory=list, description="各選項的預覽圖片 URL，與 options 依序對應"
    )
    # 評分題：起始/最大分數；排序題：最少/最多必選項數
    min_value: int | None = Field(None, ge=1, le=100, description="評分起始值或排序最少項數")
    max_value: int | None = Field(None, ge=1, le=100, description="評分最大值或排序最多項數")
    placeholder: str | None = Field(None, max_length=300)
    image_url: str | None = Field(
        None, max_length=500, description="附加圖片（可與題目合併或單獨顯示）"
    )
    min_length: int | None = Field(None, ge=0, le=10000, description="最少字數")
    max_length: int | None = Field(None, ge=1, le=10000, description="最多字數")
    validation_rule: ValidationRule | None = Field(None, description="格式驗證規則")
    min_label: str | None = Field(None, max_length=50, description="評分最低端標籤")
    max_label: str | None = Field(None, max_length=50, description="評分最高端標籤")
    condition: QuestionCondition | None = Field(None, description="顯示條件（選填）")
    option_config: OptionConfig | None = Field(
        None, description="選項額外設定（多選互斥／其他自由輸入）"
    )
    order_index: int = Field(0, ge=0)

    @field_validator("options")
    @classmethod
    def validate_options(cls, v: list[str], info) -> list[str]:  # type: ignore[misc]
        return [o.strip() for o in v if o.strip()]

    @field_validator("option_image_sets")
    @classmethod
    def validate_option_image_sets(cls, v: list[list[str]]) -> list[list[str]]:
        return [[image.strip() for image in images if image.strip()] for images in v]

    @field_validator("is_required")
    @classmethod
    def display_blocks_are_not_required(cls, v: bool, info) -> bool:  # type: ignore[misc]
        question_type = info.data.get("question_type")
        if question_type in DISPLAY_QUESTION_TYPES:
            return False
        return v

    @model_validator(mode="after")
    def _require_text_for_questions(self) -> SurveyQuestionCreate:
        if self.question_type not in DISPLAY_QUESTION_TYPES and not self.question_text.strip():
            raise ValueError("題目文字不可為空")
        if self.question_type == QuestionType.IMAGE and not self.image_url:
            raise ValueError("圖片題型需提供圖片")
        if (
            self.min_length is not None
            and self.max_length is not None
            and self.min_length > self.max_length
        ):
            raise ValueError("最少字數不可大於最多字數")
        if (
            self.min_value is not None
            and self.max_value is not None
            and self.min_value > self.max_value
        ):
            raise ValueError("起始值不可大於最大值")
        if self.question_type == QuestionType.RANKING:
            if len(self.options) < 2:
                raise ValueError("排序題至少需要 2 個選項")
            ceiling = self.max_value if self.max_value is not None else len(self.options)
            if ceiling > len(self.options):
                raise ValueError("排序最多項數不可大於選項總數")
        return self


class SurveyQuestionUpdate(BaseModel):
    question_text: str | None = Field(None, max_length=1000)
    is_required: bool | None = None
    options: list[str] | None = None
    option_image_sets: list[list[str]] | None = None
    min_value: int | None = Field(None, ge=1, le=100)
    max_value: int | None = Field(None, ge=1, le=100)
    placeholder: str | None = None
    image_url: str | None = Field(None, max_length=500)
    min_length: int | None = Field(None, ge=0, le=10000)
    max_length: int | None = Field(None, ge=1, le=10000)
    validation_rule: ValidationRule | None = None
    min_label: str | None = Field(None, max_length=50)
    max_label: str | None = Field(None, max_length=50)
    condition: QuestionCondition | None = None
    option_config: OptionConfig | None = None
    order_index: int | None = Field(None, ge=0)


class SurveyImageOut(BaseModel):
    """本地上傳圖片後回傳的存取資訊。"""

    url: str
    filename: str


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
    activity_id: uuid.UUID | None = None
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime
    questions: list[SurveyQuestionOut] = []
    response_count: int = 0
    is_public: bool = False
    allowed_org_ids: list[str] = Field(default_factory=list)
    allowed_user_ids: list[str] = Field(default_factory=list)
    allowed_domains: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _from_orm(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return data
        plain = (
            "id",
            "title",
            "description",
            "status",
            "is_anonymous",
            "allow_multiple",
            "opens_at",
            "closes_at",
            "org_id",
            "activity_id",
            "created_by",
            "created_at",
            "updated_at",
            "questions",
            "is_public",
        )
        result: dict[str, Any] = {f: getattr(data, f, None) for f in plain}
        result["response_count"] = getattr(data, "response_count", 0) or 0
        result["allowed_org_ids"] = _parse_json_list(getattr(data, "allowed_org_ids_json", None))
        result["allowed_user_ids"] = _parse_json_list(getattr(data, "allowed_user_ids_json", None))
        result["allowed_domains"] = _parse_json_list(getattr(data, "allowed_domains_json", None))
        return result


class SurveyListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    status: SurveyStatus
    is_anonymous: bool
    opens_at: datetime | None
    closes_at: datetime | None
    org_id: uuid.UUID
    activity_id: uuid.UUID | None = None
    created_by: uuid.UUID
    created_at: datetime
    response_count: int = 0


class SurveyAudience(BaseModel):
    """填答對象設定（公開與否、限制名單）。"""

    is_public: bool = False
    allowed_org_ids: list[uuid.UUID] = Field(default_factory=list)
    allowed_user_ids: list[uuid.UUID] = Field(default_factory=list)
    allowed_domains: list[str] = Field(default_factory=list)


class SurveyCreate(SurveyAudience):
    title: str = Field(..., min_length=1, max_length=300)
    description: str | None = Field(None, max_length=2000)
    is_anonymous: bool = False
    allow_multiple: bool = False
    opens_at: datetime | None = None
    closes_at: datetime | None = None
    org_id: uuid.UUID
    activity_id: uuid.UUID | None = None


class SurveyUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=300)
    description: str | None = None
    opens_at: datetime | None = None
    closes_at: datetime | None = None
    is_public: bool | None = None
    allowed_org_ids: list[uuid.UUID] | None = None
    allowed_user_ids: list[uuid.UUID] | None = None
    allowed_domains: list[str] | None = None
    activity_id: uuid.UUID | None = None


# ── 答案 ─────────────────────────────────────────────────────────────────────


class AnswerSubmit(BaseModel):
    question_id: uuid.UUID
    answer_text: str | None = Field(None, max_length=5000)
    answer_options: list[str] = Field(default_factory=list)
    other_text: str | None = Field(
        None, max_length=2000, description="多選題勾選「其他」時的補充文字"
    )


class SurveySubmit(BaseModel):
    answers: list[AnswerSubmit] = Field(..., min_length=1)
    anon_token: str | None = Field(
        None, max_length=64, description="匿名填答 token（由客戶端生成）"
    )
    email_copy: bool = Field(False, description="是否將回答副本寄送到填答者信箱")


# ── 回應（填答記錄） ──────────────────────────────────────────────────────────


class SurveyAnswerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    question_id: uuid.UUID
    answer_text: str | None
    answer_options: list[str] = Field(default_factory=list)
    other_text: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _from_orm(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return data
        return {
            "id": getattr(data, "id", None),
            "question_id": getattr(data, "question_id", None),
            "answer_text": getattr(data, "answer_text", None),
            "answer_options": _parse_json_list(getattr(data, "answer_json", None)),
            "other_text": getattr(data, "other_text", None),
        }


class SurveyResponseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    survey_id: uuid.UUID
    # 匿名問卷不回傳 respondent_id
    submitted_at: datetime
    answers: list[SurveyAnswerOut] = []


class SurveyResponseAdminItem(BaseModel):
    """後台檢視用的單筆填答記錄（含填答者 email 與各題答案）。"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    submitted_at: datetime
    respondent_email: str | None = None
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
