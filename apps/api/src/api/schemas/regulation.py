"""法規系統 Pydantic Schemas — 完整版（含條文結構、修訂歷程、全文搜尋）"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field

from api.models.regulation import (
    ArticleType,
    RegulationAmendmentType,
    RegulationCategory,
    RegulationWorkflowStatus,
)

# ── 條文 ────────────────────────────────────────────────────────────────────


class RegulationArticleOut(BaseModel):
    """條文輸出"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    regulation_id: uuid.UUID
    lineage_id: uuid.UUID
    sort_index: int
    order_index: int
    parent_id: uuid.UUID | None
    article_type: ArticleType
    title: str
    subtitle: str
    legal_number: str | None
    content: str | None
    is_deleted: bool
    frozen_by: str | None
    created_at: datetime
    updated_at: datetime


# ── 審議流程日誌 ─────────────────────────────────────────────────────────────


class RegulationWorkflowLogOut(BaseModel):
    """審議流程日誌輸出"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    from_status: str
    to_status: str
    actor_id: uuid.UUID
    note: str | None
    created_at: datetime


class RegulationTreeNodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: ArticleType
    title: str
    content: str | None
    order_index: int
    parent_id: uuid.UUID | None
    legal_number: str | None
    children: list[RegulationTreeNodeOut] = []


# ── 修訂歷程 ─────────────────────────────────────────────────────────────────


class RegulationRevisionOut(BaseModel):
    """修訂歷程輸出"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    regulation_id: uuid.UUID
    version: int
    change_brief: str
    is_total_amendment: bool
    content_snapshot: str
    article_snapshot: str | None = None
    proposal_metadata_snapshot: str | None = None
    resolution_link: str | None
    amended_at: datetime
    amended_at_precision: Literal["date", "month", "year", "unknown"] = "date"
    amended_year: int | None = None
    published_document_id: uuid.UUID | None = None
    published_document_summary: str | None = None
    amended_by: uuid.UUID
    amended_by_name: str | None = None
    created_at: datetime


# ── 法規主體 ─────────────────────────────────────────────────────────────────


class RegulationOut(BaseModel):
    """法規完整資訊（含條文清單、修訂歷程）"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    category: RegulationCategory
    content: str
    preface: str | None
    version: int
    is_active: bool
    workflow_status: RegulationWorkflowStatus
    workflow_note: str | None
    amendment_type: RegulationAmendmentType = RegulationAmendmentType.ENACT
    amended_articles: str | None = None
    effective_date: datetime | None = None
    legislative_history: str | None = None
    legal_basis: str | None = None
    proposal_metadata: str | None = None
    org_id: uuid.UUID
    created_by: uuid.UUID
    created_by_name: str | None = None
    published_at: datetime | None
    published_document_id: uuid.UUID | None = None
    # 整部法規凍結欄位
    freeze_reason: str | None = None
    freeze_at: datetime | None = None
    freeze_document_id: uuid.UUID | None = None
    # 廢止欄位
    is_repealed: bool = False
    repealed_date: datetime | None = None
    repeal_reason: str | None = None
    repeal_replacement_id: uuid.UUID | None = None
    # 血緣鏈：若由既有法規 fork 而來，記錄原始法規 ID
    source_regulation_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime
    articles: list[RegulationArticleOut] = []
    revisions: list[RegulationRevisionOut] = []
    workflow_logs: list[RegulationWorkflowLogOut] = []

    @computed_field(description="未刪除的條節點數；編、章、節、項、款、目不計入")
    @property
    def article_count(self) -> int:
        return sum(
            article.article_type == ArticleType.ARTICLE and not article.is_deleted
            for article in self.articles
        )


class RegulationListItem(BaseModel):
    """法規列表輕量版（不含 Markdown 內容與條文，加快載入）"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    category: RegulationCategory
    version: int
    is_active: bool
    is_repealed: bool = False
    workflow_status: RegulationWorkflowStatus
    org_id: uuid.UUID
    published_at: datetime | None
    effective_date: datetime | None = None
    repealed_date: datetime | None = None
    freeze_reason: str | None = None
    freeze_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


# ── 請求體 ────────────────────────────────────────────────────────────────────


class RegulationPublishRequest(BaseModel):
    """發布法規（草稿 → 正式發布）"""

    change_brief: str = Field(default="初次發布", max_length=500, description="修訂摘要")
    is_total_amendment: bool = Field(False, description="是否為全文修訂")
    resolution_link: str | None = Field(None, description="相關決議連結")


class RegulationSearchResult(BaseModel):
    """全文搜尋結果（RegulationListItem 的超集，額外帶命中條文）"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    category: RegulationCategory
    version: int
    is_active: bool
    is_repealed: bool = False
    workflow_status: RegulationWorkflowStatus
    org_id: uuid.UUID
    published_at: datetime | None
    effective_date: datetime | None = None
    repealed_date: datetime | None = None
    freeze_reason: str | None = None
    freeze_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    # 命中的條文摘要（關鍵字出現在標題/副標題/內容的條文）
    matched_articles: list[RegulationArticleOut] = []


class ReferenceWarningOut(BaseModel):
    source_article_id: uuid.UUID
    source_title: str
    referenced_legal_number: str
    message: str


class RegulationTimeMachineOut(BaseModel):
    as_of: datetime
    version: int
    amended_at: datetime
    content_snapshot: str
    tree: list[RegulationTreeNodeOut]
