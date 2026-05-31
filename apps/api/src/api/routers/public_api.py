"""Public API（外部讀取 / 開放資料）。Phase D2。

對應 ADR-005 規劃：第三方系統可用 ApiKey 拉取公開資料。

特性：
- 需 ApiKey 認證（X-API-Key 或 Authorization: Bearer），scope check
- 全部 GET、回應簡化版欄位
- 不洩漏 PII、不顯示草稿

scope 規範：
- read:announcements
- read:regulations
- read:calendar
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.api_key_auth import require_api_scope
from api.models.announcement import Announcement
from api.models.regulation import Regulation

router = APIRouter(prefix="/public/v1", tags=["Public API"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


class PublicAnnouncementItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    org_id: uuid.UUID | None
    is_urgent: bool
    published_at: datetime | None
    created_at: datetime


class PublicRegulationItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    category: str | None = None


@router.get(
    "/announcements",
    response_model=list[PublicAnnouncementItem],
)
async def list_public_announcements(
    db: DbDep,
    _key=Depends(require_api_scope("read:announcements")),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[PublicAnnouncementItem]:
    """已發布、全站可見的公告。不含草稿、不含內文（避免大 payload）。"""
    stmt = (
        select(Announcement)
        .where(Announcement.is_published.is_(True))
        .where(Announcement.audience_type == "all")
        .order_by(desc(Announcement.published_at), desc(Announcement.created_at))
        .offset(offset)
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [PublicAnnouncementItem.model_validate(r) for r in rows]


@router.get(
    "/announcements/{announcement_id}/content",
)
async def get_public_announcement_content(
    announcement_id: uuid.UUID,
    db: DbDep,
    _key=Depends(require_api_scope("read:announcements")),
) -> dict:
    """取單筆已發布公告完整內容（Tiptap JSON）。"""
    row = await db.get(Announcement, announcement_id)
    if row is None or not row.is_published or row.audience_type != "all":
        from fastapi import HTTPException

        raise HTTPException(404, "Not found or not public")
    return {
        "id": str(row.id),
        "title": row.title,
        "content": row.content,
        "is_urgent": row.is_urgent,
        "published_at": row.published_at.isoformat() if row.published_at else None,
        "org_id": str(row.org_id) if row.org_id else None,
    }


@router.get(
    "/regulations",
    response_model=list[PublicRegulationItem],
)
async def list_public_regulations(
    db: DbDep,
    _key=Depends(require_api_scope("read:regulations")),
    limit: int = Query(100, ge=1, le=500),
) -> list[PublicRegulationItem]:
    """已公布、生效中的法規清單。"""
    stmt = (
        select(Regulation)
        .where(Regulation.published_at.is_not(None))
        .where(Regulation.published_document_id.is_not(None))
        .order_by(Regulation.name)
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [PublicRegulationItem.model_validate(r) for r in rows]
