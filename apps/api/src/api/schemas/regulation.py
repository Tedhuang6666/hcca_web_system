"""法規系統 Pydantic Schemas — 完整版（含條文結構、修訂歷程、全文搜尋）"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

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


class RegulationArticleCreate(BaseModel):
    """新增條文"""

    sort_index: int = Field(..., ge=0, description="排序索引（同法規內唯一）")
    order_index: int = Field(default=0, ge=0, description="同層級排序")
    parent_id: uuid.UUID | None = Field(default=None, description="父節點 ID")
    article_type: ArticleType = Field(..., description="條文層級類型")
    title: str = Field(default="", max_length=200, description="條文標題（如：第一章 總則）")
    subtitle: str = Field(default="", max_length=200, description="條文副標題")
    legal_number: str | None = Field(None, max_length=50, description="法律條號（如 5-1）")
    content: str | None = Field(None, description="條文內容（Chapter 類型可不填）")

    @model_validator(mode="after")
    def validate_no_legacy_type(self) -> RegulationArticleCreate:
        if self.article_type in (ArticleType.CLAUSE, ArticleType.SUBSECTION):
            raise ValueError("不可新建舊層級類型，請改用 article / subparagraph")
        return self


class RegulationArticleUpdate(BaseModel):
    """更新條文"""

    sort_index: int | None = Field(None, ge=0)
    order_index: int | None = Field(None, ge=0)
    parent_id: uuid.UUID | None = None
    article_type: ArticleType | None = None
    title: str | None = Field(None, max_length=200)
    subtitle: str | None = Field(None, max_length=200)
    legal_number: str | None = Field(None, max_length=50)
    content: str | None = None
    is_deleted: bool | None = None
    frozen_by: str | None = None


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


class WorkflowActionRequest(BaseModel):
    """審議流程動作請求（送審/排程/核定/退回）"""

    note: str | None = Field(None, max_length=500, description="備註或退回原因")
    meeting_id: uuid.UUID | None = Field(
        None, description="排入議程時，同步加入指定議事會議的議程"
    )


class ArticleReorderItem(BaseModel):
    id: uuid.UUID
    sort_index: int = Field(..., ge=0)


class ArticleReorderRequest(BaseModel):
    items: list[ArticleReorderItem] = Field(..., min_length=1)


class ArticleMoveRequest(BaseModel):
    parent_id: uuid.UUID | None = Field(None, description="目標父節點")
    order_index: int = Field(..., ge=0, description="目標同層排序位置")


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
    amended_by: uuid.UUID
    amended_by_name: str | None = None
    created_at: datetime


class RegulationRevisionCreate(BaseModel):
    """手動建立修訂記錄（發布新版時通常由服務層自動呼叫）"""

    change_brief: str = Field(..., min_length=1, max_length=500, description="修訂摘要")
    is_total_amendment: bool = Field(False, description="是否為全文修訂")
    resolution_link: str | None = Field(None, description="相關決議連結（多個以換行分隔）")


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
    repealed_date: datetime | None = None
    freeze_reason: str | None = None
    freeze_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


# ── 請求體 ────────────────────────────────────────────────────────────────────


class RegulationCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200, description="法規標題")
    category: RegulationCategory = Field(..., description="法規分類")
    content: str = Field(default="", description="Markdown 全文內容（與結構化條文可並用）")
    preface: str | None = Field(None, description="法規前言/序言（選填）")
    amendment_type: RegulationAmendmentType = Field(
        RegulationAmendmentType.ENACT, description="制定/修正/廢止"
    )
    amended_articles: str | None = Field(None, description="修正條號清單")
    effective_date: datetime | None = Field(None, description="生效日期")
    legislative_history: str | None = Field(None, description="沿革")
    legal_basis: str | None = Field(None, description="法源依據")
    proposal_metadata: str | None = Field(None, description="提案/決議資訊")
    org_id: uuid.UUID = Field(..., description="所屬組織 ID")


class RegulationUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    category: RegulationCategory | None = None
    content: str | None = Field(None, description="Markdown 全文內容（空字串代表清除）")
    preface: str | None = None
    amendment_type: RegulationAmendmentType | None = None
    amended_articles: str | None = None
    effective_date: datetime | None = None
    legislative_history: str | None = None
    legal_basis: str | None = None
    proposal_metadata: str | None = None
    change_brief: str | None = Field(
        None, max_length=500, description="修改摘要（更新時自動建立歷程）"
    )


class RegulationPublishRequest(BaseModel):
    """發布法規（草稿 → 正式發布）"""

    change_brief: str = Field(default="初次發布", max_length=500, description="修訂摘要")
    is_total_amendment: bool = Field(False, description="是否為全文修訂")
    resolution_link: str | None = Field(None, description="相關決議連結")


class RegulationArchiveRequest(BaseModel):
    """停用（封存）法規：is_active=False"""

    reason: str | None = Field(None, max_length=500, description="停用原因")


class RepealRegulationRequest(BaseModel):
    """廢止法規"""

    reason: str = Field(..., min_length=1, max_length=500, description="廢止理由")
    replacement_id: uuid.UUID | None = Field(None, description="替代法規 ID（若有）")

    pass


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
    repealed_date: datetime | None = None
    freeze_reason: str | None = None
    freeze_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    # 命中的條文摘要（關鍵字出現在標題/副標題/內容的條文）
    matched_articles: list[RegulationArticleOut] = []


class AutoRenumberRequest(BaseModel):
    include_special_number: bool = Field(False, description="是否重編特殊條號（如 5-1）")


class AmendmentComparisonRowOut(BaseModel):
    article_key: str
    revised_text: str
    current_text: str
    note: str


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
