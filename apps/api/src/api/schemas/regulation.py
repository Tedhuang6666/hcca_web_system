"""法規系統 Pydantic Schemas — 完整版（含條文結構、修訂歷程、全文搜尋）"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from api.models.regulation import ArticleType, RegulationCategory

# ── 條文 ────────────────────────────────────────────────────────────────────

class RegulationArticleOut(BaseModel):
    """條文輸出"""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    regulation_id: uuid.UUID
    sort_index: int
    article_type: ArticleType
    title: str
    subtitle: str
    content: str | None
    is_deleted: bool
    frozen_by: str | None
    created_at: datetime
    updated_at: datetime


class RegulationArticleCreate(BaseModel):
    """新增條文"""
    sort_index: int = Field(..., ge=0, description="排序索引（同法規內唯一）")
    article_type: ArticleType = Field(..., description="條文層級類型")
    title: str = Field(default="", max_length=200, description="條文標題（如：第一章 總則）")
    subtitle: str = Field(default="", max_length=200, description="條文副標題")
    content: str | None = Field(None, description="條文內容（Chapter 類型可不填）")


class RegulationArticleUpdate(BaseModel):
    """更新條文"""
    sort_index: int | None = Field(None, ge=0)
    article_type: ArticleType | None = None
    title: str | None = Field(None, max_length=200)
    subtitle: str | None = Field(None, max_length=200)
    content: str | None = None
    is_deleted: bool | None = None
    frozen_by: str | None = None


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
    resolution_link: str | None
    amended_at: datetime
    amended_by: uuid.UUID
    created_at: datetime


class RegulationRevisionCreate(BaseModel):
    """手動建立修訂記錄（發布新版時通常由服務層自動呼叫）"""
    change_brief: str = Field(..., min_length=1, max_length=500, description="修訂摘要")
    is_total_amendment: bool = Field(False, description="是否為全文修訂")
    resolution_link: str | None = Field(None, description="相關決議連結（多個以換行分隔）")


# ── 法規主體 ─────────────────────────────────────────────────────────────────

class RegulationOut(BaseModel):
    """法規完整資訊（含 Markdown 內容、條文清單、修訂歷程）"""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    category: RegulationCategory
    content: str
    preface: str | None
    version: int
    is_active: bool
    org_id: uuid.UUID
    created_by: uuid.UUID
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime
    articles: list[RegulationArticleOut] = []
    revisions: list[RegulationRevisionOut] = []


class RegulationListItem(BaseModel):
    """法規列表輕量版（不含 Markdown 內容與條文，加快載入）"""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    category: RegulationCategory
    version: int
    is_active: bool
    org_id: uuid.UUID
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime


# ── 請求體 ────────────────────────────────────────────────────────────────────

class RegulationCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200, description="法規標題")
    category: RegulationCategory = Field(..., description="法規分類")
    content: str = Field(default="", description="法規內容（支援 Markdown）")
    preface: str | None = Field(None, description="法規前言/序言（選填）")
    org_id: uuid.UUID = Field(..., description="所屬組織 ID")


class RegulationUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    category: RegulationCategory | None = None
    content: str | None = None
    preface: str | None = None
    change_brief: str | None = Field(None, max_length=500, description="修改摘要（更新時自動建立歷程）")


class RegulationPublishRequest(BaseModel):
    """發布法規（草稿 → 正式發布）"""
    change_brief: str = Field(
        default="初次發布", max_length=500, description="修訂摘要"
    )
    is_total_amendment: bool = Field(False, description="是否為全文修訂")
    resolution_link: str | None = Field(None, description="相關決議連結")


class RegulationArchiveRequest(BaseModel):
    """停用（封存）法規：is_active=False"""
    pass


class RegulationSearchResult(BaseModel):
    """全文搜尋結果（輕量版）"""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    category: RegulationCategory
    version: int
    is_active: bool
    org_id: uuid.UUID
    published_at: datetime | None
    # 命中的條文摘要
    matched_articles: list[RegulationArticleOut] = []
