"""問卷系統 ORM 模型 - Survey / SurveyQuestion / SurveyResponse / SurveyAnswer"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin

if TYPE_CHECKING:
    from api.models.org import Org
    from api.models.user import User


# ── 枚舉 ──────────────────────────────────────────────────────────────────────


class SurveyStatus(enum.StrEnum):
    DRAFT = "draft"  # 草稿，未公開
    OPEN = "open"  # 開放填答
    CLOSED = "closed"  # 已截止
    ARCHIVED = "archived"  # 封存


class QuestionType(enum.StrEnum):
    TEXT = "text"  # 簡答（單行文字）
    TEXTAREA = "textarea"  # 長答（多行文字）
    SINGLE = "single"  # 單選
    MULTIPLE = "multiple"  # 多選
    RATING = "rating"  # 評分（1–5 / 1–10）
    DATE = "date"  # 日期輸入
    SECTION_TEXT = "section_text"  # 純文字描述區塊
    PAGE_BREAK = "page_break"  # 分頁
    IMAGE = "image"  # 圖片 URL
    VIDEO = "video"  # 影片連結


class ValidationRule(enum.StrEnum):
    """文字題型的自訂格式驗證規則。"""

    EMAIL = "email"  # 電子郵件格式
    NUMBER = "number"  # 數字（可含小數）
    INTEGER = "integer"  # 整數
    URL = "url"  # 網址
    PHONE = "phone"  # 電話號碼


# ── 問卷主表 ──────────────────────────────────────────────────────────────────


class Survey(Base, TimestampMixin):
    """
    問卷主表。
    is_anonymous=True 時，回應不記錄 respondent_id，僅保留 token
    用於防重複填答，無法反推填答人身份。
    """

    __tablename__ = "surveys"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[SurveyStatus] = mapped_column(
        Enum(SurveyStatus, name="surveystatus", values_callable=lambda obj: [e.value for e in obj]),
        nullable=False,
        default=SurveyStatus.DRAFT,
        index=True,
    )
    is_anonymous: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 允許多次填答（False = 每人限填一次，依 user_id 或 token 判斷）
    allow_multiple: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 可選的開放/截止時間
    opens_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 填答對象控制：is_public=True 時未登入者也可填答
    is_public: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    # 限制名單（JSON 陣列字串）；三者皆空代表「任何登入者皆可填」
    allowed_org_ids_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    allowed_user_ids_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    allowed_domains_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orgs.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    org: Mapped[Org] = relationship("Org")
    creator: Mapped[User] = relationship("User")
    questions: Mapped[list[SurveyQuestion]] = relationship(
        "SurveyQuestion",
        back_populates="survey",
        cascade="all, delete-orphan",
        order_by="SurveyQuestion.order_index",
    )
    responses: Mapped[list[SurveyResponse]] = relationship(
        "SurveyResponse", back_populates="survey", cascade="all, delete-orphan"
    )


# ── 問題 ──────────────────────────────────────────────────────────────────────


class SurveyQuestion(Base, TimestampMixin):
    """
    問卷題目。
    options 為 JSON 字串，格式：["選項1","選項2","選項3"]（僅 SINGLE / MULTIPLE 題型使用）。
    min_value / max_value 用於 RATING 題型設定範圍（預設 1–5）。
    """

    __tablename__ = "survey_questions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    survey_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("surveys.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    question_type: Mapped[QuestionType] = mapped_column(
        Enum(QuestionType, name="questiontype", values_callable=lambda obj: [e.value for e in obj]),
        nullable=False,
        default=QuestionType.TEXT,
    )
    is_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # 選項 JSON（SINGLE/MULTIPLE 題型）
    options_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 評分範圍
    min_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 提示文字
    placeholder: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # 附加圖片 URL（IMAGE 題型作為單獨顯示；其他題型則與題目合併顯示）
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # 自訂驗證規則（TEXT / TEXTAREA 題型）：字數下/上限
    min_length: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_length: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 格式驗證規則代碼（對應 ValidationRule 的值，如 email / number）
    validation_rule: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # 評分題型的端點敘述標籤（如「非常不滿意」「非常滿意」）
    min_label: Mapped[str | None] = mapped_column(String(50), nullable=True)
    max_label: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # 顯示條件 JSON：{"question_id": "...", "operator": "equals|contains", "value": "..."}
    # 設定後，此題（或分頁）僅在來源題目的答案符合條件時才顯示／需作答
    condition_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    survey: Mapped[Survey] = relationship("Survey", back_populates="questions")
    answers: Mapped[list[SurveyAnswer]] = relationship(
        "SurveyAnswer", back_populates="question", cascade="all, delete-orphan"
    )


# ── 回應（填答人單次填答） ─────────────────────────────────────────────────────


class SurveyResponse(Base, TimestampMixin):
    """
    一次完整填答記錄。
    匿名問卷：respondent_id=NULL，anon_token 為不可逆 UUID（每次填答生成）。
    非匿名問卷：respondent_id=填答人 user_id，anon_token=NULL。
    UNIQUE (survey_id, respondent_id)：非匿名問卷每人限填一次。
    匿名問卷：每個 anon_token 一條記錄（允許重複填答由 allow_multiple 控制）。
    """

    __tablename__ = "survey_responses"
    __table_args__ = (UniqueConstraint("survey_id", "respondent_id", name="uq_survey_respondent"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    survey_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("surveys.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 非匿名：記錄填答人
    respondent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # 匿名：記錄隨機 token 防重複（無法反推身份）
    anon_token: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    # 非匿名問卷記錄填答者 email；匿名問卷恆為 NULL 以保障匿名性
    respondent_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    survey: Mapped[Survey] = relationship("Survey", back_populates="responses")
    respondent: Mapped[User | None] = relationship("User")
    answers: Mapped[list[SurveyAnswer]] = relationship(
        "SurveyAnswer", back_populates="response", cascade="all, delete-orphan"
    )


# ── 答案（每題的答案） ─────────────────────────────────────────────────────────


class SurveyAnswer(Base, TimestampMixin):
    """
    單題答案。answer_text 儲存文字回答；answer_json 儲存多選項目（JSON 陣列）。
    """

    __tablename__ = "survey_answers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    response_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("survey_responses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    question_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("survey_questions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # TEXT / TEXTAREA / DATE / RATING(單值) → answer_text
    answer_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # MULTIPLE → answer_json（JSON 陣列 ["opt1","opt2"]）
    answer_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    response: Mapped[SurveyResponse] = relationship("SurveyResponse", back_populates="answers")
    question: Mapped[SurveyQuestion] = relationship("SurveyQuestion", back_populates="answers")


__all__ = [
    "QuestionType",
    "Survey",
    "SurveyAnswer",
    "SurveyQuestion",
    "SurveyResponse",
    "SurveyStatus",
    "ValidationRule",
]
