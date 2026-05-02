"""法規服務層 - CRUD / 發布 / 停用 / 條文管理 / 全文搜尋 / 修訂歷程"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.regulation import (
    Regulation,
    RegulationArticle,
    RegulationCategory,
    RegulationRevision,
)
from api.schemas.regulation import (
    RegulationArticleCreate,
    RegulationArticleUpdate,
    RegulationCreate,
    RegulationPublishRequest,
    RegulationUpdate,
)

logger = logging.getLogger(__name__)


# ── 查詢輔助 ─────────────────────────────────────────────────────────────────

def _reg_query_with_relations():
    """帶入條文與修訂歷程的標準查詢"""
    return (
        select(Regulation)
        .options(
            selectinload(Regulation.articles),
            selectinload(Regulation.revisions),
        )
    )


# ── 查詢 ─────────────────────────────────────────────────────────────────────

async def get_regulation(
    session: AsyncSession, reg_id: uuid.UUID
) -> Regulation | None:
    """以 ID 取得法規（含條文與修訂歷程）"""
    result = await session.execute(
        _reg_query_with_relations().where(Regulation.id == reg_id)
    )
    return result.scalar_one_or_none()


async def list_regulations(
    session: AsyncSession,
    *,
    org_id: uuid.UUID | None = None,
    category: RegulationCategory | None = None,
    is_active: bool | None = None,
    keyword: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[Regulation]:
    """列表查詢，支援多條件過濾與關鍵字搜尋（全文搜尋）"""
    q = select(Regulation)
    if org_id is not None:
        q = q.where(Regulation.org_id == org_id)
    if category is not None:
        q = q.where(Regulation.category == category)
    if is_active is not None:
        q = q.where(Regulation.is_active == is_active)
    if keyword:
        pattern = f"%{keyword}%"
        q = q.where(
            or_(
                Regulation.title.ilike(pattern),
                Regulation.content.ilike(pattern),
                Regulation.preface.ilike(pattern),
            )
        )
    q = q.order_by(Regulation.updated_at.desc()).limit(limit).offset(offset)
    result = await session.execute(q)
    return list(result.scalars().all())


async def search_regulations(
    session: AsyncSession,
    keyword: str,
    *,
    org_id: uuid.UUID | None = None,
    active_only: bool = True,
    limit: int = 20,
) -> list[Regulation]:
    """
    全文搜尋：搜尋法規標題、內容、前言，並同時搜尋條文內容。
    回傳匹配的法規物件（包含條文子集合）。
    """
    pattern = f"%{keyword}%"

    # 搜尋法規主體
    q = _reg_query_with_relations()
    if org_id:
        q = q.where(Regulation.org_id == org_id)
    if active_only:
        q = q.where(Regulation.is_active.is_(True))
    q = q.where(
        or_(
            Regulation.title.ilike(pattern),
            Regulation.content.ilike(pattern),
            Regulation.preface.ilike(pattern),
            # 子查詢：條文內容含關鍵字的法規
            Regulation.id.in_(
                select(RegulationArticle.regulation_id).where(
                    RegulationArticle.content.ilike(pattern),
                    RegulationArticle.is_deleted.is_(False),
                )
            ),
        )
    )
    q = q.limit(limit)
    result = await session.execute(q)
    regs = list(result.scalars().unique().all())

    # 為每個法規篩選命中的條文（過濾 is_deleted）
    for reg in regs:
        reg.articles = [
            a for a in reg.articles
            if not a.is_deleted and (
                keyword.lower() in (a.title or "").lower()
                or keyword.lower() in (a.subtitle or "").lower()
                or keyword.lower() in (a.content or "").lower()
            )
        ]
    return regs


# ── 建立 ─────────────────────────────────────────────────────────────────────

async def create_regulation(
    session: AsyncSession,
    *,
    data: RegulationCreate,
    created_by: uuid.UUID,
) -> Regulation:
    """建立新法規（預設為草稿，is_active=True，version=1）"""
    reg = Regulation(
        title=data.title,
        category=data.category,
        content=data.content,
        preface=data.preface,
        org_id=data.org_id,
        created_by=created_by,
        version=1,
        is_active=True,
    )
    session.add(reg)
    await session.flush()
    logger.info("法規建立 id=%s title=%s", reg.id, reg.title)
    return reg


# ── 更新 ─────────────────────────────────────────────────────────────────────

async def update_regulation(
    session: AsyncSession,
    reg: Regulation,
    *,
    data: RegulationUpdate,
    updated_by: uuid.UUID,
) -> Regulation:
    """更新法規內容，若有變更則遞增版本號並自動建立修訂快照草稿"""
    changed = False
    for field in ("title", "category", "content", "preface"):
        val = getattr(data, field, None)
        if val is not None:
            setattr(reg, field, val)
            changed = True

    if changed:
        reg.version += 1
        # 若有提供 change_brief，建立修訂快照記錄
        if data.change_brief:
            rev = RegulationRevision(
                regulation_id=reg.id,
                version=reg.version,
                change_brief=data.change_brief,
                is_total_amendment=False,
                content_snapshot=reg.content,
                amended_at=datetime.now(UTC),
                amended_by=updated_by,
            )
            session.add(rev)

    await session.flush()
    return reg


# ── 發布 ─────────────────────────────────────────────────────────────────────

async def publish_regulation(
    session: AsyncSession,
    reg: Regulation,
    *,
    data: RegulationPublishRequest,
    published_by: uuid.UUID,
) -> Regulation:
    """
    發布法規（設定 published_at）。
    同時建立修訂歷程快照記錄。
    """
    if reg.published_at is not None:
        msg = "法規已經發布，如需修訂請使用更新功能後重新發布"
        raise ValueError(msg)

    now = datetime.now(UTC)
    reg.published_at = now

    # 自動建立首次發布歷程
    rev = RegulationRevision(
        regulation_id=reg.id,
        version=reg.version,
        change_brief=data.change_brief,
        is_total_amendment=data.is_total_amendment,
        content_snapshot=reg.content,
        resolution_link=data.resolution_link,
        amended_at=now,
        amended_by=published_by,
    )
    session.add(rev)
    await session.flush()
    logger.info("法規發布 id=%s version=%d", reg.id, reg.version)
    return reg


# ── 停用 ─────────────────────────────────────────────────────────────────────

async def archive_regulation(
    session: AsyncSession,
    reg: Regulation,
) -> Regulation:
    """停用（封存）法規：is_active=False"""
    if not reg.is_active:
        msg = "法規已停用"
        raise ValueError(msg)
    reg.is_active = False
    await session.flush()
    logger.info("法規停用 id=%s", reg.id)
    return reg


# ── 刪除 ─────────────────────────────────────────────────────────────────────

async def delete_regulation(
    session: AsyncSession,
    reg: Regulation,
) -> None:
    """永久刪除法規（僅允許尚未發布的草稿）"""
    if reg.published_at is not None:
        msg = "已發布的法規不可直接刪除，請先停用"
        raise ValueError(msg)
    await session.delete(reg)
    await session.flush()


# ── 條文管理 ─────────────────────────────────────────────────────────────────

async def add_article(
    session: AsyncSession,
    reg: Regulation,
    *,
    data: RegulationArticleCreate,
) -> RegulationArticle:
    """新增條文至法規"""
    article = RegulationArticle(
        regulation_id=reg.id,
        sort_index=data.sort_index,
        article_type=data.article_type,
        title=data.title,
        subtitle=data.subtitle,
        content=data.content,
        is_deleted=False,
    )
    session.add(article)
    await session.flush()
    logger.info("條文新增 reg_id=%s sort_index=%d", reg.id, data.sort_index)
    return article


async def update_article(
    session: AsyncSession,
    article: RegulationArticle,
    *,
    data: RegulationArticleUpdate,
) -> RegulationArticle:
    """更新條文內容"""
    for field in ("sort_index", "article_type", "title", "subtitle", "content", "is_deleted", "frozen_by"):
        val = getattr(data, field, None)
        if val is not None:
            setattr(article, field, val)
    await session.flush()
    return article


async def delete_article(
    session: AsyncSession,
    article: RegulationArticle,
    *,
    hard_delete: bool = False,
) -> None:
    """
    刪除條文。
    hard_delete=False：軟刪除（is_deleted=True，保留歷史）。
    hard_delete=True：硬刪除（物理移除）。
    """
    if hard_delete:
        await session.delete(article)
    else:
        article.is_deleted = True
    await session.flush()


async def get_article(
    session: AsyncSession,
    article_id: uuid.UUID,
) -> RegulationArticle | None:
    """以 ID 取得條文"""
    result = await session.execute(
        select(RegulationArticle).where(RegulationArticle.id == article_id)
    )
    return result.scalar_one_or_none()


async def list_regulation_revisions(
    session: AsyncSession,
    reg_id: uuid.UUID,
) -> list[RegulationRevision]:
    """取得法規所有修訂歷程（按版本號排序）"""
    result = await session.execute(
        select(RegulationRevision)
        .where(RegulationRevision.regulation_id == reg_id)
        .order_by(RegulationRevision.version)
    )
    return list(result.scalars().all())
