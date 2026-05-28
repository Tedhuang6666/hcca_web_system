"""法規服務層 - CRUD / 發布 / 停用 / 條文管理 / 全文搜尋 / 修訂歷程"""

from __future__ import annotations

import logging
import re
import uuid
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.document import Document, DocumentStatus
from api.models.regulation import (
    ArticleType,
    Regulation,
    RegulationAmendmentType,
    RegulationArticle,
    RegulationCategory,
    RegulationRevision,
    RegulationWorkflowLog,
    RegulationWorkflowStatus,
)
from api.schemas.regulation import (
    AmendmentComparisonRowOut,
    ArticleReorderRequest,
    ReferenceWarningOut,
    RegulationArticleCreate,
    RegulationArticleOut,
    RegulationArticleUpdate,
    RegulationCreate,
    RegulationPublishRequest,
    RegulationTimeMachineOut,
    RegulationTreeNodeOut,
    RegulationUpdate,
)
from api.services.regulation_import import ImportedRegulationDraft, parse_regulation_text

logger = logging.getLogger(__name__)
_PUBLICATION_DOCUMENT_STATUSES = (DocumentStatus.APPROVED, DocumentStatus.ARCHIVED)
# Service 層編輯保護：僅 DRAFT 或 REJECTED 可被 update_regulation 修改，
# 其他狀態（UNDER_REVIEW / SCHEDULED / COUNCIL_APPROVED / PUBLISHED / ARCHIVED）
# 必須先 fork_regulation_draft 開新草案。
_EDITABLE_WORKFLOW_STATUSES: frozenset[RegulationWorkflowStatus] = frozenset(
    {RegulationWorkflowStatus.DRAFT, RegulationWorkflowStatus.REJECTED}
)
_PARENT_RULES: dict[ArticleType | None, set[ArticleType]] = {
    None: {ArticleType.VOLUME, ArticleType.CHAPTER, ArticleType.SECTION, ArticleType.ARTICLE},
    ArticleType.VOLUME: {ArticleType.CHAPTER},
    ArticleType.CHAPTER: {ArticleType.SECTION, ArticleType.ARTICLE},
    ArticleType.SECTION: {ArticleType.ARTICLE},
    ArticleType.ARTICLE: {ArticleType.PARAGRAPH},
    ArticleType.PARAGRAPH: {ArticleType.SUBPARAGRAPH},
    ArticleType.SUBPARAGRAPH: {ArticleType.ITEM},
    ArticleType.ITEM: set(),
    ArticleType.SPECIAL_CLAUSE: set(),
}


# ── 查詢輔助 ─────────────────────────────────────────────────────────────────


def _reg_query_with_relations():
    """帶入條文、修訂歷程、審議日誌與所屬組織的標準查詢"""
    return select(Regulation).options(
        selectinload(Regulation.org),
        selectinload(Regulation.creator),
        selectinload(Regulation.articles),
        selectinload(Regulation.revisions).selectinload(RegulationRevision.amender),
        selectinload(Regulation.workflow_logs),
    )


def _attach_display_names(regs: list[Regulation]) -> list[Regulation]:
    for reg in regs:
        creator = reg.__dict__.get("creator")
        reg.__dict__["created_by_name"] = getattr(creator, "display_name", None)
        revisions = reg.__dict__.get("revisions") or []
        for rev in revisions:
            amender = rev.__dict__.get("amender")
            rev.__dict__["amended_by_name"] = getattr(amender, "display_name", None)
    return regs


def _where_publicly_effective(q):
    """Require both legal publication metadata and a completed publication document.

    停用 / 廢止 / 被修正版本取代（is_active=False）的法規不再對外現行有效，
    必須排除，否則公開列表會同時出現修正前與修正後兩個版本。
    """
    return q.join(Document, Regulation.published_document_id == Document.id).where(
        Regulation.is_active.is_(True),
        Regulation.published_at.is_not(None),
        Regulation.published_document_id.is_not(None),
        Document.status.in_(_PUBLICATION_DOCUMENT_STATUSES),
    )


async def is_publicly_effective(session: AsyncSession, reg: Regulation) -> bool:
    """A law is public only after its publication decree is actually completed."""
    if not reg.is_active or reg.published_at is None or reg.published_document_id is None:
        return False
    result = await session.execute(
        select(Document.status).where(Document.id == reg.published_document_id)
    )
    return result.scalar_one_or_none() in _PUBLICATION_DOCUMENT_STATUSES


def _normalize_type(v: ArticleType) -> ArticleType:
    if v == ArticleType.CLAUSE:
        return ArticleType.ARTICLE
    if v == ArticleType.SUBSECTION:
        return ArticleType.SUBPARAGRAPH
    return v


def _build_tree_nodes(articles: list[RegulationArticle]) -> list[RegulationTreeNodeOut]:
    active = [a for a in articles if not a.is_deleted]
    by_parent: dict[uuid.UUID | None, list[RegulationArticle]] = defaultdict(list)
    for a in active:
        by_parent[a.parent_id].append(a)
    for siblings in by_parent.values():
        siblings.sort(key=lambda x: (x.order_index, x.sort_index))

    def _walk(parent_id: uuid.UUID | None) -> list[RegulationTreeNodeOut]:
        return [
            RegulationTreeNodeOut(
                id=a.id,
                type=a.article_type,
                title=a.title,
                content=a.content,
                order_index=a.order_index,
                parent_id=a.parent_id,
                legal_number=a.legal_number,
                children=_walk(a.id),
            )
            for a in by_parent.get(parent_id, [])
        ]

    return _walk(None)


def _article_snapshot_json(articles: list[RegulationArticle]) -> str:
    import json

    payload = [
        RegulationArticleOut.model_validate(a).model_dump(mode="json")
        for a in articles
        if not a.is_deleted
    ]
    return json.dumps(payload, ensure_ascii=False)


async def _add_imported_articles(
    session: AsyncSession,
    *,
    reg_id: uuid.UUID,
    data: ImportedRegulationDraft,
) -> list[RegulationArticle]:
    id_map: dict[str, uuid.UUID] = {}
    articles: list[RegulationArticle] = []
    for row in data.articles:
        article_id = uuid.uuid4()
        id_map[row.key] = article_id
        article = RegulationArticle(
            id=article_id,
            regulation_id=reg_id,
            sort_index=row.sort_index,
            order_index=row.order_index,
            parent_id=id_map.get(row.parent_key) if row.parent_key else None,
            article_type=row.article_type,
            title=row.title,
            subtitle="",
            legal_number=row.legal_number,
            content=row.content,
            is_deleted=False,
        )
        session.add(article)
        articles.append(article)
    return articles


async def _structure_text_content_if_possible(
    session: AsyncSession,
    reg: Regulation,
    *,
    content: str,
) -> bool:
    if not content.strip():
        return False
    if any(not a.is_deleted for a in reg.articles):
        return False
    try:
        parsed = parse_regulation_text(title=reg.title, content=content, preface=reg.preface)
    except ValueError:
        return False
    reg.articles.extend(await _add_imported_articles(session, reg_id=reg.id, data=parsed))
    return True


# ── 查詢 ─────────────────────────────────────────────────────────────────────


async def get_regulation(session: AsyncSession, reg_id: uuid.UUID) -> Regulation | None:
    """以 ID 取得法規（含條文與修訂歷程）"""
    result = await session.execute(_reg_query_with_relations().where(Regulation.id == reg_id))
    reg = result.scalar_one_or_none()
    if reg is None:
        return None
    _attach_display_names([reg])
    return reg


async def get_regulation_by_identifier(
    session: AsyncSession,
    identifier: uuid.UUID | str,
) -> Regulation | None:
    """以 UUID 或法規中文全名取得法規（含條文與修訂歷程）。"""
    if isinstance(identifier, uuid.UUID):
        return await get_regulation(session, identifier)

    try:
        return await get_regulation(session, uuid.UUID(identifier))
    except ValueError:
        pass

    result = await session.execute(
        _reg_query_with_relations()
        .where(Regulation.title == identifier)
        .order_by(Regulation.is_active.desc(), Regulation.updated_at.desc())
        .limit(1)
    )
    reg = result.scalar_one_or_none()
    if reg is None:
        return None
    _attach_display_names([reg])
    return reg


async def list_regulations(
    session: AsyncSession,
    *,
    org_id: uuid.UUID | None = None,
    category: RegulationCategory | None = None,
    is_active: bool | None = None,
    published_only: bool = False,
    workflow_status: RegulationWorkflowStatus | None = None,
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
    if workflow_status is not None:
        q = q.where(Regulation.workflow_status == workflow_status)
    if published_only:
        q = _where_publicly_effective(q)
    if keyword:
        # 使用 tsvector 全文搜尋；對包含特殊字符的查詢 fallback 到 LIKE
        try:
            # 簡單的 AND 查詢：keyword 的每個詞都必須出現
            tsquery_str = " & ".join(word.strip() for word in keyword.split() if word.strip())
            if tsquery_str:
                q = q.where(
                    Regulation.search_vector.op("@@")(func.to_tsquery("simple", tsquery_str))
                )
            else:
                # keyword 為空或只有空格，fallback 到 LIKE
                pattern = f"%{keyword}%"
                q = q.where(
                    or_(
                        Regulation.title.ilike(pattern),
                        Regulation.content.ilike(pattern),
                        Regulation.preface.ilike(pattern),
                    )
                )
        except Exception:
            # 若 tsvector 查詢失敗（如特殊字符），fallback 到傳統 LIKE
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
    published_only: bool = False,
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
    if published_only:
        q = _where_publicly_effective(q)
    q = q.where(
        or_(
            Regulation.title.ilike(pattern),
            Regulation.content.ilike(pattern),
            Regulation.preface.ilike(pattern),
            # 子查詢：標題/副標題/內容含關鍵字的條文所屬法規
            Regulation.id.in_(
                select(RegulationArticle.regulation_id).where(
                    or_(
                        RegulationArticle.title.ilike(pattern),
                        RegulationArticle.subtitle.ilike(pattern),
                        RegulationArticle.content.ilike(pattern),
                    ),
                    RegulationArticle.is_deleted.is_(False),
                )
            ),
        )
    )
    q = q.limit(limit)
    result = await session.execute(q)
    regs = _attach_display_names(list(result.scalars().unique().all()))

    # 挑出每部法規中命中關鍵字的條文，存入 matched_articles
    # （不覆寫 reg.articles，列表頁仍需完整條文做其他用途）
    needle = keyword.lower()
    for reg in regs:
        reg.__dict__["matched_articles"] = [
            a
            for a in reg.articles
            if not a.is_deleted
            and (
                needle in (a.title or "").lower()
                or needle in (a.subtitle or "").lower()
                or needle in (a.content or "").lower()
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
        amendment_type=data.amendment_type,
        amended_articles=data.amended_articles,
        effective_date=data.effective_date,
        legislative_history=data.legislative_history,
        legal_basis=data.legal_basis,
        proposal_metadata=data.proposal_metadata,
        org_id=data.org_id,
        created_by=created_by,
        version=1,
        is_active=True,
        workflow_status=RegulationWorkflowStatus.DRAFT,
    )
    session.add(reg)
    await session.flush()
    await _structure_text_content_if_possible(session, reg, content=data.content)
    logger.info("法規建立 id=%s title=%s", reg.id, reg.title)
    # 重新查詢以載入所有關聯（避免 async 環境下的 MissingGreenlet）
    loaded = await get_regulation(session, reg.id)
    return loaded or reg


async def create_regulation_from_import(
    session: AsyncSession,
    *,
    data: ImportedRegulationDraft,
    category: RegulationCategory,
    org_id: uuid.UUID,
    created_by: uuid.UUID,
) -> Regulation:
    """由 DOCX 匯入結果建立法規草稿與結構化條文。"""
    reg = Regulation(
        title=data.title,
        category=category,
        content=data.content,
        preface=data.preface,
        legislative_history=data.legislative_history,
        org_id=org_id,
        created_by=created_by,
        version=1,
        is_active=True,
        workflow_status=RegulationWorkflowStatus.DRAFT,
    )
    session.add(reg)
    await session.flush()

    await _add_imported_articles(session, reg_id=reg.id, data=data)

    await session.flush()
    logger.info(
        "法規 DOCX 匯入建立 id=%s title=%s articles=%d",
        reg.id,
        reg.title,
        len(data.articles),
    )
    loaded = await get_regulation(session, reg.id)
    return loaded or reg


async def publish_imported_regulation(
    session: AsyncSession,
    reg: Regulation,
    *,
    published_by: uuid.UUID,
    change_brief: str = "匯入既有現行法規",
) -> Regulation:
    """將剛匯入的既有法規直接標記為現行有效，並建立初始修訂快照。"""
    now = datetime.now(UTC)
    reg.workflow_status = RegulationWorkflowStatus.PUBLISHED
    reg.published_at = now
    session.add(
        RegulationRevision(
            regulation_id=reg.id,
            version=reg.version,
            change_brief=change_brief,
            is_total_amendment=True,
            content_snapshot=reg.content,
            article_snapshot=_article_snapshot_json(reg.articles),
            proposal_metadata_snapshot=reg.proposal_metadata,
            amended_at=now,
            amended_by=published_by,
        )
    )
    await session.flush()
    loaded = await get_regulation(session, reg.id)
    return loaded or reg


async def fork_regulation_draft(
    session: AsyncSession,
    reg: Regulation,
    *,
    created_by: uuid.UUID,
) -> Regulation:
    """
    由既有法規分支出一份新草案（workflow_status=DRAFT）。
    用於「已發布法規想新增草案」：避免對 published 直接做 workflow transition。

    會複製條文結構（含 parent 關係），並將 legacy clause/subsection 映射到 article/subparagraph。
    """
    # fork 出的草案若來自已發布法規，預設為「修正」而非繼承原 amendment_type
    # （避免修正案被誤判為新法）
    forked_amendment_type = (
        RegulationAmendmentType.AMEND if reg.published_at is not None else reg.amendment_type
    )
    new_reg = Regulation(
        title=reg.title,
        category=reg.category,
        content=reg.content,
        preface=reg.preface,
        amendment_type=forked_amendment_type,
        amended_articles=reg.amended_articles,
        effective_date=reg.effective_date,
        legislative_history=reg.legislative_history,
        legal_basis=reg.legal_basis,
        proposal_metadata=reg.proposal_metadata,
        org_id=reg.org_id,
        created_by=created_by,
        version=reg.version,
        is_active=True,
        workflow_status=RegulationWorkflowStatus.DRAFT,
        workflow_note=None,
        published_at=None,
        published_document_id=None,
        freeze_reason=None,
        freeze_at=None,
        freeze_document_id=None,
        source_regulation_id=reg.id,
    )
    session.add(new_reg)
    await session.flush()

    id_map: dict[uuid.UUID, uuid.UUID] = {}
    new_articles: list[RegulationArticle] = []
    src_articles = sorted([a for a in reg.articles if not a.is_deleted], key=lambda a: a.sort_index)
    for a in src_articles:
        na = RegulationArticle(
            regulation_id=new_reg.id,
            # 保留沿革識別碼：fork 出的條文與原條文視為同一條，
            # 重新排序時才不會被誤判為刪除＋新建。
            lineage_id=a.lineage_id,
            sort_index=a.sort_index,
            order_index=a.order_index,
            parent_id=None,
            article_type=_normalize_type(a.article_type),
            title=a.title,
            subtitle=a.subtitle,
            legal_number=a.legal_number,
            content=a.content,
            is_deleted=False,
            frozen_by=None,
        )
        session.add(na)
        await session.flush()
        id_map[a.id] = na.id
        new_articles.append(na)

    for na, old in zip(new_articles, src_articles, strict=True):
        if old.parent_id is not None and old.parent_id in id_map:
            na.parent_id = id_map[old.parent_id]

    src_revisions = sorted(reg.revisions, key=lambda r: (r.version, r.amended_at))
    for rev in src_revisions:
        session.add(
            RegulationRevision(
                regulation_id=new_reg.id,
                version=rev.version,
                change_brief=rev.change_brief,
                is_total_amendment=rev.is_total_amendment,
                content_snapshot=rev.content_snapshot,
                article_snapshot=rev.article_snapshot,
                proposal_metadata_snapshot=rev.proposal_metadata_snapshot,
                resolution_link=rev.resolution_link,
                amended_at=rev.amended_at,
                amended_by=rev.amended_by,
            )
        )
    await session.flush()

    loaded = await get_regulation(session, new_reg.id)
    return loaded or new_reg


# ── 更新 ─────────────────────────────────────────────────────────────────────


async def update_regulation(
    session: AsyncSession,
    reg: Regulation,
    *,
    data: RegulationUpdate,
    updated_by: uuid.UUID,
) -> Regulation:
    """更新法規內容，若有變更則遞增版本號並自動建立修訂快照草稿"""
    if reg.workflow_status not in _EDITABLE_WORKFLOW_STATUSES:
        raise ValueError(
            f"法規目前狀態為「{reg.workflow_status.value}」不可編輯，"
            "請改用 fork_regulation_draft 建立新草案"
        )
    changed = False
    for field in (
        "title",
        "category",
        "content",
        "preface",
        "amendment_type",
        "amended_articles",
        "effective_date",
        "legislative_history",
        "legal_basis",
        "proposal_metadata",
    ):
        val = getattr(data, field, None)
        if val is not None:
            setattr(reg, field, val)
            changed = True

    if changed and data.autosave:
        await session.flush()
        return reg

    if changed:
        if "content" in data.model_fields_set and data.content is not None:
            await _structure_text_content_if_possible(session, reg, content=data.content)
        reg.version += 1
        # 若有提供 change_brief，建立修訂快照記錄
        if data.change_brief:
            rev = RegulationRevision(
                regulation_id=reg.id,
                version=reg.version,
                change_brief=data.change_brief,
                is_total_amendment=False,
                content_snapshot=reg.content,
                article_snapshot=_article_snapshot_json(reg.articles),
                proposal_metadata_snapshot=reg.proposal_metadata,
                amended_at=datetime.now(UTC),
                amended_by=updated_by,
            )
            session.add(rev)

    await session.flush()
    return reg


async def structure_regulation_content(
    session: AsyncSession,
    reg: Regulation,
    *,
    content: str | None = None,
    replace_existing: bool = False,
) -> Regulation:
    """將法規全文文字解析成結構化條文，供歷史資料補結構使用。"""
    source_content = reg.content if content is None else content
    if not source_content.strip():
        raise ValueError("法規全文為空，無法建立結構化條文")

    existing_articles = [a for a in reg.articles if not a.is_deleted]
    if existing_articles and not replace_existing:
        raise ValueError("此法規已有結構化條文；若要覆蓋請設定 replace_existing=true")

    parsed = parse_regulation_text(
        title=reg.title,
        content=source_content,
        preface=reg.preface,
    )
    if replace_existing:
        for article in existing_articles:
            article.is_deleted = True
    if content is not None:
        reg.content = content

    await _add_imported_articles(session, reg_id=reg.id, data=parsed)
    await session.flush()
    loaded = await get_regulation(session, reg.id)
    return loaded or reg


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
    _ = (session, reg, data, published_by)
    raise ValueError("法規不可直接發布，請改用主席公布流程（president_publish）")


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
    reg.workflow_status = RegulationWorkflowStatus.ARCHIVED
    await session.flush()
    logger.info("法規停用 id=%s", reg.id)
    return reg


async def repeal_regulation(
    session: AsyncSession,
    reg: Regulation,
    reason: str,
    replacement_id: uuid.UUID | None = None,
) -> Regulation:
    """廢止法規"""
    if reg.is_repealed:
        msg = "法規已廢止"
        raise ValueError(msg)
    if not reg.is_active:
        msg = "非現行有效的法規不可廢止，請先重新啟用"
        raise ValueError(msg)

    reg.is_repealed = True
    reg.repealed_date = datetime.now(UTC)
    reg.repeal_reason = reason
    if replacement_id:
        reg.repeal_replacement_id = replacement_id
    reg.is_active = False

    await session.flush()
    logger.info("法規廢止 id=%s reason=%s", reg.id, reason)
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
    if data.article_type in (ArticleType.CLAUSE, ArticleType.SUBSECTION):
        raise ValueError("不可新建舊層級類型，請改用 article / subparagraph")
    if data.parent_id is not None:
        parent = next(
            (a for a in reg.articles if a.id == data.parent_id and not a.is_deleted), None
        )
        if parent is None:
            raise ValueError("父節點不存在")
        allowed = _PARENT_RULES.get(_normalize_type(parent.article_type), set())
        if _normalize_type(data.article_type) not in allowed:
            raise ValueError("此父節點不允許該層級子節點")
    else:
        allowed_root = _PARENT_RULES[None]
        if _normalize_type(data.article_type) not in allowed_root:
            raise ValueError("根層級不允許該節點類型")

    article = RegulationArticle(
        regulation_id=reg.id,
        sort_index=data.sort_index,
        order_index=data.order_index,
        parent_id=data.parent_id,
        article_type=data.article_type,
        title=data.title,
        subtitle=data.subtitle,
        legal_number=data.legal_number,
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
    for field in (
        "sort_index",
        "article_type",
        "title",
        "subtitle",
        "content",
        "is_deleted",
        "frozen_by",
    ):
        val = getattr(data, field, None)
        if val is not None:
            setattr(article, field, val)
    # parent_id 需區分「未提供」與「明確設為 null（移到頂層）」：
    # 用 model_fields_set 判斷，否則條文無法被移出原父節點。
    if "parent_id" in data.model_fields_set:
        article.parent_id = data.parent_id
    if data.order_index is not None:
        article.order_index = data.order_index
    if data.legal_number is not None:
        article.legal_number = data.legal_number
    await session.flush()
    return article


def _structural_level(article_type: object) -> int:
    """返回結構層級：編=3, 章=2, 節=1，其他=0（條/項/款/目）"""
    v = str(getattr(article_type, "value", article_type))
    return {"volume": 3, "chapter": 2, "section": 1}.get(v, 0)


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
    刪除編/章/節等結構性標題時，自動級聯刪除其下屬所有條文，
    直到遇到同級或更高層級的標題為止。
    """
    sub_result = await session.execute(
        select(RegulationArticle).where(
            RegulationArticle.regulation_id == article.regulation_id,
            RegulationArticle.is_deleted.is_(False),
        )
    )
    all_nodes = list(sub_result.scalars().all())
    child_map: dict[uuid.UUID, list[RegulationArticle]] = defaultdict(list)
    for n in all_nodes:
        if n.parent_id is not None:
            child_map[n.parent_id].append(n)

    stack = [article]
    subtree: list[RegulationArticle] = []
    while stack:
        node = stack.pop()
        subtree.append(node)
        stack.extend(child_map.get(node.id, []))

    for node in subtree:
        if hard_delete:
            await session.delete(node)
        else:
            node.is_deleted = True
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


# ── 審議流程 ─────────────────────────────────────────────────────────────────

# 合法的狀態轉移映射
_ALLOWED_TRANSITIONS: dict[RegulationWorkflowStatus, set[RegulationWorkflowStatus]] = {
    RegulationWorkflowStatus.DRAFT: {RegulationWorkflowStatus.UNDER_REVIEW},
    RegulationWorkflowStatus.UNDER_REVIEW: {
        RegulationWorkflowStatus.SCHEDULED,
        RegulationWorkflowStatus.REJECTED,
        RegulationWorkflowStatus.DRAFT,
    },  # 再修正（撤回）
    RegulationWorkflowStatus.SCHEDULED: {
        RegulationWorkflowStatus.COUNCIL_APPROVED,
        RegulationWorkflowStatus.REJECTED,
    },
    RegulationWorkflowStatus.COUNCIL_APPROVED: {
        RegulationWorkflowStatus.PUBLISHED,
        RegulationWorkflowStatus.REJECTED,
        RegulationWorkflowStatus.DRAFT,
    },  # 再修正（主席退回重新草擬）
    RegulationWorkflowStatus.REJECTED: {
        RegulationWorkflowStatus.DRAFT,
        RegulationWorkflowStatus.UNDER_REVIEW,
    },
    RegulationWorkflowStatus.PUBLISHED: {RegulationWorkflowStatus.ARCHIVED},
    RegulationWorkflowStatus.ARCHIVED: set(),
}


async def transition_workflow(
    session: AsyncSession,
    reg: Regulation,
    *,
    to_status: RegulationWorkflowStatus,
    actor_id: uuid.UUID,
    note: str | None = None,
) -> Regulation:
    """執行審議流程狀態轉移，並寫入流程日誌"""
    allowed = _ALLOWED_TRANSITIONS.get(reg.workflow_status, set())
    if to_status not in allowed:
        msg = f"無法從 {reg.workflow_status} 轉移至 {to_status}"
        raise ValueError(msg)
    if to_status == RegulationWorkflowStatus.REJECTED and (note is None or not note.strip()):
        raise ValueError("退回法規必須填寫退回原因")

    log = RegulationWorkflowLog(
        regulation_id=reg.id,
        from_status=reg.workflow_status,
        to_status=to_status,
        actor_id=actor_id,
        note=note,
    )
    session.add(log)

    reg.workflow_status = to_status
    reg.workflow_note = note
    await session.flush()
    logger.info("法規流程轉移 id=%s %s→%s", reg.id, log.from_status, to_status)
    return reg


async def list_workflow_logs(
    session: AsyncSession,
    reg_id: uuid.UUID,
) -> list[RegulationWorkflowLog]:
    result = await session.execute(
        select(RegulationWorkflowLog)
        .options(selectinload(RegulationWorkflowLog.actor))
        .where(RegulationWorkflowLog.regulation_id == reg_id)
        .order_by(RegulationWorkflowLog.created_at)
    )
    return list(result.scalars().all())


# ── 條文批次重排 ─────────────────────────────────────────────────────────────


async def reorder_articles(
    session: AsyncSession,
    reg: Regulation,
    data: ArticleReorderRequest,
) -> list[RegulationArticle]:
    """批次更新條文 sort_index（前端拖曳排序後送出）"""
    id_map = {a.id: a for a in reg.articles}
    for item in data.items:
        article = id_map.get(item.id)
        if article is None:
            msg = f"條文 {item.id} 不屬於此法規"
            raise ValueError(msg)
        article.sort_index = item.sort_index
    await session.flush()
    return sorted(reg.articles, key=lambda a: a.sort_index)


async def get_article_tree(
    session: AsyncSession,
    reg: Regulation,
) -> list[RegulationTreeNodeOut]:
    _ = session
    return _build_tree_nodes(reg.articles)


async def auto_renumber_articles(
    session: AsyncSession,
    reg: Regulation,
    *,
    include_special_number: bool = False,
) -> list[RegulationArticle]:
    articles = sorted(
        [
            a
            for a in reg.articles
            if not a.is_deleted and _normalize_type(a.article_type) == ArticleType.ARTICLE
        ],
        key=lambda a: (a.sort_index, a.order_index),
    )
    counter = 1
    for article in articles:
        if article.legal_number and "-" in article.legal_number and not include_special_number:
            continue
        article.legal_number = str(counter)
        counter += 1
    await session.flush()
    return articles


def _lineage_match_key(lineage_id: object, legal_number: object, title: object) -> str:
    """跨版本比對鍵：優先用 lineage_id（重新排序時穩定），
    舊快照無 lineage_id 時 fallback 到法號/標題。"""
    if lineage_id:
        return f"lin:{lineage_id}"
    return f"num:{str(legal_number or '').strip() or str(title or '').strip()}"


def _article_display_label(legal_number: object, title: object) -> str:
    ln = str(legal_number or "").strip()
    if ln:
        return f"第 {ln} 條"
    return str(title or "").strip() or "（未命名條文）"


async def compare_amendment(
    session: AsyncSession,
    reg: Regulation,
) -> list[AmendmentComparisonRowOut]:
    """比對目前條文與最近一次修訂快照，產生逐條對照。

    以 lineage_id 比對 → 重新排序（條號改變但仍為同一條）會正確標為「未變更」，
    不再被誤判為刪除＋新增。
    """
    result = await session.execute(
        select(RegulationRevision)
        .where(RegulationRevision.regulation_id == reg.id)
        .order_by(RegulationRevision.amended_at.desc())
        .limit(1)
    )
    latest = result.scalar_one_or_none()
    current_articles = [
        a
        for a in reg.articles
        if not a.is_deleted and _normalize_type(a.article_type) == ArticleType.ARTICLE
    ]

    previous: dict[str, dict[str, str]] = {}
    if latest:
        import json

        snapshot = json.loads(latest.article_snapshot or "[]")
        for row in snapshot:
            if row.get("is_deleted"):
                continue
            if row.get("article_type") not in (
                ArticleType.ARTICLE.value,
                ArticleType.CLAUSE.value,
            ):
                continue
            key = _lineage_match_key(
                row.get("lineage_id"), row.get("legal_number"), row.get("title")
            )
            previous[key] = {
                "label": _article_display_label(row.get("legal_number"), row.get("title")),
                "content": row.get("content") or "",
            }

    rows: list[AmendmentComparisonRowOut] = []
    seen: set[str] = set()
    for a in current_articles:
        key = _lineage_match_key(a.lineage_id, a.legal_number, a.title)
        seen.add(key)
        prev = previous.get(key)
        cur_content = a.content or ""
        cur_label = _article_display_label(a.legal_number, a.title)
        if prev is None:
            note = "新增"
        elif prev["content"].strip() != cur_content.strip():
            note = "修正"
        elif prev["label"] != cur_label:
            # 內容相同但條號變了（重新排序 / 插入造成）→ 條次調整，仍算一項變更
            note = "條次調整"
        else:
            note = "未變更"
        rows.append(
            AmendmentComparisonRowOut(
                article_key=cur_label,
                revised_text=cur_content,
                current_text=prev["content"] if prev else "",
                note=note,
            )
        )
    for key, prev in previous.items():
        if key in seen:
            continue
        rows.append(
            AmendmentComparisonRowOut(
                article_key=prev["label"],
                revised_text="",
                current_text=prev["content"],
                note="刪除",
            )
        )
    _ = session
    return rows


async def validate_references(
    session: AsyncSession,
    reg: Regulation,
) -> list[ReferenceWarningOut]:
    _ = session
    legal_numbers = {
        (a.legal_number or "").strip()
        for a in reg.articles
        if not a.is_deleted
        and _normalize_type(a.article_type) == ArticleType.ARTICLE
        and a.legal_number
    }
    warnings: list[ReferenceWarningOut] = []
    pattern = re.compile(r"第\s*(\d+(?:-\d+)?)\s*條")
    for article in reg.articles:
        if article.is_deleted or not article.content:
            continue
        refs = pattern.findall(article.content)
        for ref in refs:
            if ref not in legal_numbers:
                warnings.append(
                    ReferenceWarningOut(
                        source_article_id=article.id,
                        source_title=article.title,
                        referenced_legal_number=ref,
                        message=f"參照的第 {ref} 條不存在或已更名",
                    )
                )
    return warnings


async def get_time_machine_snapshot(
    session: AsyncSession,
    reg_id: uuid.UUID,
    *,
    as_of: datetime,
) -> RegulationTimeMachineOut:
    result = await session.execute(
        select(RegulationRevision)
        .where(RegulationRevision.regulation_id == reg_id, RegulationRevision.amended_at <= as_of)
        .order_by(RegulationRevision.amended_at.desc())
        .limit(1)
    )
    revision = result.scalar_one_or_none()
    if revision is None:
        raise ValueError("指定時間點找不到法規快照")
    import json

    article_rows: list[dict[str, Any]] = json.loads(revision.article_snapshot or "[]")
    by_parent: dict[str | None, list[dict[str, Any]]] = defaultdict(list)
    for row in article_rows:
        by_parent[row.get("parent_id")].append(row)
    for children in by_parent.values():
        children.sort(key=lambda x: (x.get("order_index", 0), x.get("sort_index", 0)))

    def build(parent_id: str | None) -> list[RegulationTreeNodeOut]:
        nodes: list[RegulationTreeNodeOut] = []
        for row in by_parent.get(parent_id, []):
            node_id = uuid.UUID(row["id"])
            nodes.append(
                RegulationTreeNodeOut(
                    id=node_id,
                    type=ArticleType(row["article_type"]),
                    title=row.get("title", ""),
                    content=row.get("content"),
                    order_index=row.get("order_index", 0),
                    parent_id=uuid.UUID(row["parent_id"]) if row.get("parent_id") else None,
                    legal_number=row.get("legal_number"),
                    children=build(str(node_id)),
                )
            )
        return nodes

    return RegulationTimeMachineOut(
        as_of=as_of,
        version=revision.version,
        amended_at=revision.amended_at,
        content_snapshot=revision.content_snapshot,
        tree=build(None),
    )
