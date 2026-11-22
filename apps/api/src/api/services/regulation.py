"""法規查詢、來源匯入、公布與修訂快照。"""

from __future__ import annotations

import logging
import re
import uuid
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import and_, case, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only, selectinload

from api.models.document import Document, DocumentStatus
from api.models.regulation import (
    ArticleType,
    Regulation,
    RegulationArticle,
    RegulationCategory,
    RegulationRevision,
    RegulationWorkflowStatus,
)
from api.schemas.regulation import (
    ReferenceWarningOut,
    RegulationArticleOut,
    RegulationPublishRequest,
    RegulationTimeMachineOut,
    RegulationTreeNodeOut,
)
from api.services.dashboard import invalidate_dashboard_cache
from api.services.regulation_import import (
    ImportedRegulationDraft,
    parse_history_date_info,
    split_history_events,
)

logger = logging.getLogger(__name__)
_PUBLICATION_DOCUMENT_STATUSES = (DocumentStatus.APPROVED, DocumentStatus.ARCHIVED)


# ── 查詢輔助 ─────────────────────────────────────────────────────────────────


def _reg_query_with_relations():
    """帶入條文、修訂歷程、審議日誌與所屬組織的標準查詢"""
    return select(Regulation).options(
        selectinload(Regulation.org),
        selectinload(Regulation.creator),
        selectinload(Regulation.articles),
        selectinload(Regulation.revisions).selectinload(RegulationRevision.amender),
        selectinload(Regulation.revisions).selectinload(RegulationRevision.published_document),
        selectinload(Regulation.workflow_logs),
    )


def _reg_query_for_public_detail():
    """公開法規詳情查詢，載入版本所連結的公布公文摘要。"""
    return select(Regulation).options(
        selectinload(Regulation.creator),
        selectinload(Regulation.articles),
        selectinload(Regulation.revisions).selectinload(RegulationRevision.amender),
        selectinload(Regulation.revisions).selectinload(RegulationRevision.published_document),
        selectinload(Regulation.workflow_logs),
    )


def _reg_query_for_detail():
    """登入後詳情同樣只載入回應需要的關聯，保留草稿資料本身。"""
    return _reg_query_for_public_detail()


def _attach_display_names(regs: list[Regulation]) -> list[Regulation]:
    for reg in regs:
        creator = reg.__dict__.get("creator")
        imported_from_file = (reg.proposal_metadata or "").startswith("__file_import__")
        reg.__dict__["created_by_name"] = (
            "不詳" if imported_from_file else getattr(creator, "display_name", None)
        )
        revisions = reg.__dict__.get("revisions") or []
        for rev in revisions:
            amender = rev.__dict__.get("amender")
            rev.__dict__["amended_by_name"] = getattr(amender, "display_name", None)
    return regs


def _where_publicly_effective(q):
    """限定為「現行有效且已公布」的法規。

    停用 / 廢止 / 被修正版本取代（is_active=False）的法規不再對外現行有效，
    必須排除，否則公開列表會同時出現修正前與修正後兩個版本。

    公布文（published_document_id）為「選填」：經主席公布流程的法規會掛上一份公布
    令公文；但匯入既有現行法規（publish_imported_regulation）等路徑不會建立公文，
    這些法規在現實中早已制定生效，仍應對外公開。因此用 outer join，只在「公布文
    存在但尚未核定（draft/under_review）」時排除，避免公布程序進行中的法規提早外洩。
    """
    return q.outerjoin(Document, Regulation.published_document_id == Document.id).where(
        Regulation.is_active.is_(True),
        Regulation.published_at.is_not(None),
        or_(
            Regulation.published_document_id.is_(None),
            Document.status.in_(_PUBLICATION_DOCUMENT_STATUSES),
        ),
    )


async def is_publicly_effective(session: AsyncSession, reg: Regulation) -> bool:
    """現行有效且已公布即對外公開；若掛有公布令公文，則該公文須已核定。"""
    if not reg.is_active or reg.published_at is None:
        return False
    if reg.published_document_id is None:
        return True
    result = await session.execute(
        select(Document.status).where(Document.id == reg.published_document_id)
    )
    return result.scalar_one_or_none() in _PUBLICATION_DOCUMENT_STATUSES


def _normalize_type(v: ArticleType) -> ArticleType:
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


async def get_regulation_detail_by_identifier(
    session: AsyncSession,
    identifier: uuid.UUID | str,
) -> Regulation | None:
    """以 UUID 或法規中文全名取得詳情，避免載入未使用的公布公文關聯。"""
    query = _reg_query_for_detail()
    if isinstance(identifier, uuid.UUID):
        query = query.where(Regulation.id == identifier)
    else:
        try:
            query = query.where(Regulation.id == uuid.UUID(identifier))
        except ValueError:
            query = query.where(Regulation.title == identifier).order_by(
                Regulation.is_active.desc(), Regulation.updated_at.desc()
            )
    result = await session.execute(query.limit(1))
    reg = result.scalar_one_or_none()
    if reg is None:
        return None
    _attach_display_names([reg])
    return reg


async def get_public_regulation_by_identifier(
    session: AsyncSession,
    identifier: uuid.UUID | str,
) -> Regulation | None:
    """取得可公開的現行法規，將公開條件併入主查詢避免額外狀態查詢。"""
    query = _where_publicly_effective(_reg_query_for_public_detail())
    if isinstance(identifier, uuid.UUID):
        query = query.where(Regulation.id == identifier)
    else:
        try:
            query = query.where(Regulation.id == uuid.UUID(identifier))
        except ValueError:
            query = query.where(Regulation.title == identifier).order_by(
                Regulation.is_active.desc(), Regulation.updated_at.desc()
            )
    result = await session.execute(query.limit(1))
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
    q = select(Regulation).options(
        load_only(
            Regulation.id,
            Regulation.title,
            Regulation.category,
            Regulation.version,
            Regulation.is_active,
            Regulation.is_repealed,
            Regulation.workflow_status,
            Regulation.org_id,
            Regulation.published_at,
            Regulation.effective_date,
            Regulation.repealed_date,
            Regulation.freeze_reason,
            Regulation.freeze_at,
            Regulation.created_at,
            Regulation.updated_at,
        )
    )
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
        pattern = f"%{keyword}%"
        if session.get_bind().dialect.name == "sqlite":
            q = q.where(
                or_(
                    Regulation.title.ilike(pattern),
                    Regulation.content.ilike(pattern),
                    Regulation.preface.ilike(pattern),
                )
            )
        else:
            # 一般輸入以 plainto_tsquery 解析，避免引號／括號變成 tsquery 語法。
            # 保留多詞 AND 與原有空白查詢行為；SQL 仍使用綁定參數。
            if keyword.strip():
                q = q.where(
                    Regulation.search_vector.op("@@")(func.plainto_tsquery("simple", keyword))
                )
            else:
                q = q.where(
                    or_(
                        Regulation.title.ilike(pattern),
                        Regulation.content.ilike(pattern),
                        Regulation.preface.ilike(pattern),
                    )
                )
    latest_history_date = (
        select(func.max(RegulationRevision.amended_at))
        .where(RegulationRevision.regulation_id == Regulation.id)
        .scalar_subquery()
    )
    sort_date = func.coalesce(latest_history_date, Regulation.updated_at)
    category_order = case(
        (Regulation.category == RegulationCategory.CONSTITUTION, 0),
        (Regulation.category == RegulationCategory.ORDINANCE, 1),
        (Regulation.category == RegulationCategory.PROCEDURE, 2),
        else_=3,
    )
    q = q.order_by(category_order, sort_date.desc(), Regulation.title).limit(limit).offset(offset)
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

    # 搜尋法規主體。搜尋結果只需要列表欄位與命中條文，避免載入完整修訂歷程、
    # 審議日誌、建立者與公布公文等詳情關聯。
    article_match = and_(
        RegulationArticle.is_deleted.is_(False),
        or_(
            RegulationArticle.title.ilike(pattern),
            RegulationArticle.subtitle.ilike(pattern),
            RegulationArticle.content.ilike(pattern),
        ),
    )
    q = select(Regulation).options(
        load_only(
            Regulation.id,
            Regulation.title,
            Regulation.category,
            Regulation.version,
            Regulation.is_active,
            Regulation.is_repealed,
            Regulation.workflow_status,
            Regulation.org_id,
            Regulation.published_at,
            Regulation.effective_date,
            Regulation.repealed_date,
            Regulation.freeze_reason,
            Regulation.freeze_at,
            Regulation.created_at,
            Regulation.updated_at,
        ),
        selectinload(Regulation.articles.and_(article_match)),
    )
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
            Regulation.id.in_(select(RegulationArticle.regulation_id).where(article_match)),
        )
    )
    latest_history_date = (
        select(func.max(RegulationRevision.amended_at))
        .where(RegulationRevision.regulation_id == Regulation.id)
        .scalar_subquery()
    )
    category_order = case(
        (Regulation.category == RegulationCategory.CONSTITUTION, 0),
        (Regulation.category == RegulationCategory.ORDINANCE, 1),
        (Regulation.category == RegulationCategory.PROCEDURE, 2),
        else_=3,
    )
    q = q.order_by(
        category_order,
        func.coalesce(latest_history_date, Regulation.updated_at).desc(),
        Regulation.title,
    ).limit(limit)
    result = await session.execute(q)
    regs = list(result.scalars().unique().all())
    for reg in regs:
        reg.__dict__["matched_articles"] = list(reg.articles)
    return regs


# ── 建立 ─────────────────────────────────────────────────────────────────────


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
        proposal_metadata="__file_import__",
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


def _history_dates(history: str | None) -> list[datetime]:
    return [
        parsed
        for event in split_history_events(history)
        if (parsed := parse_history_date_info(event)[0]) is not None
    ]


def _latest_regulation_history_date(reg: Regulation) -> datetime | None:
    history_dates = _history_dates(reg.legislative_history)
    if history_dates:
        return max(history_dates)
    revision_dates = [revision.amended_at for revision in reg.revisions if revision.amended_at]
    if revision_dates:
        return max(revision_dates)
    return reg.published_at or reg.updated_at


async def _find_current_regulation_for_import(
    session: AsyncSession,
    *,
    title: str,
    org_id: uuid.UUID,
) -> Regulation | None:
    result = await session.execute(
        _reg_query_with_relations()
        .where(
            Regulation.title == title,
            Regulation.org_id == org_id,
            Regulation.is_active.is_(True),
            Regulation.workflow_status == RegulationWorkflowStatus.PUBLISHED,
        )
        .order_by(Regulation.updated_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _update_existing_regulation_from_import(
    session: AsyncSession,
    reg: Regulation,
    *,
    data: ImportedRegulationDraft,
    category: RegulationCategory,
    updated_by: uuid.UUID,
) -> Regulation | None:
    events = split_history_events(data.legislative_history)
    history_info = [parse_history_date_info(event) for event in events]
    imported_dates = [info[0] for info in history_info if info[0] is not None]
    latest_imported_date = max(imported_dates, default=None)
    latest_existing_date = _latest_regulation_history_date(reg)
    if (
        latest_imported_date is None
        or latest_existing_date is None
        or latest_imported_date <= latest_existing_date
    ):
        return None

    new_events = [
        (event, info)
        for event, info in zip(events, history_info, strict=True)
        if info[0] is not None and info[0] > latest_existing_date
    ]
    if not new_events:
        return None

    existing_history_dates = _history_dates(reg.legislative_history)
    # 更新同名法規時保留既有分類；匯入表單的分類只適用於新建法規。
    reg.content = data.content
    reg.preface = data.preface
    reg.legislative_history = data.legislative_history
    reg.workflow_status = RegulationWorkflowStatus.PUBLISHED
    reg.is_active = True
    reg.published_at = min(existing_history_dates + imported_dates)

    reg.articles.clear()
    await session.flush()
    imported_articles = await _add_imported_articles(session, reg_id=reg.id, data=data)
    reg.articles.extend(imported_articles)
    await session.flush()

    base_version = max(
        [reg.version, *(revision.version for revision in reg.revisions)],
        default=reg.version,
    )
    article_snapshot = _article_snapshot_json(reg.articles)
    for offset, (event, info) in enumerate(new_events, start=1):
        version = base_version + offset
        is_latest = offset == len(new_events)
        reg.revisions.append(
            RegulationRevision(
                regulation_id=reg.id,
                version=version,
                change_brief=event[:500],
                is_total_amendment=is_latest,
                content_snapshot=data.content if is_latest else "",
                article_snapshot=article_snapshot if is_latest else "[]",
                proposal_metadata_snapshot=reg.proposal_metadata,
                amended_at=info[0],
                amended_at_precision=info[1],
                amended_year=info[2],
                amended_by=updated_by,
            )
        )
    reg.version = base_version + len(new_events)
    await session.flush()
    await session.execute(
        update(Regulation).where(Regulation.id == reg.id).values(updated_at=latest_imported_date)
    )
    await session.refresh(reg, attribute_names=["updated_at"])
    logger.info(
        "法規 DOCX 匯入更新既有法規 id=%s title=%s version=%d",
        reg.id,
        reg.title,
        reg.version,
    )
    loaded = await get_regulation(session, reg.id)
    return loaded or reg


async def import_regulation_document(
    session: AsyncSession,
    *,
    data: ImportedRegulationDraft,
    category: RegulationCategory,
    org_id: uuid.UUID,
    created_by: uuid.UUID,
    publish_immediately: bool,
    change_brief: str = "匯入既有現行法規",
    update_existing: bool = False,
) -> Regulation:
    """匯入一份法規；批量立即發布時可依沿革日期更新同名現行法規。"""
    if update_existing and publish_immediately:
        existing = await _find_current_regulation_for_import(
            session,
            title=data.title,
            org_id=org_id,
        )
        if existing is not None:
            updated = await _update_existing_regulation_from_import(
                session,
                existing,
                data=data,
                category=category,
                updated_by=created_by,
            )
            if updated is not None:
                return updated
            # 同版或較舊的來源不應再建立第二筆同名現行法規。
            return existing

    reg = await create_regulation_from_import(
        session,
        data=data,
        category=category,
        org_id=org_id,
        created_by=created_by,
    )
    if publish_immediately:
        return await publish_imported_regulation(
            session,
            reg,
            published_by=created_by,
            change_brief=change_brief,
        )
    return reg


def _resolve_history_dates(raw_dates: list[datetime | None], now: datetime) -> list[datetime]:
    """將逐筆沿革事件的（可能缺漏的）日期補成單調可排序的具體日期。

    已解析者保留原值；未解析者以前一筆 forward-fill、開頭缺漏者 backfill；
    若全數缺漏則以 now 為終點向前每筆退一天，確保版本順序穩定。
    """
    resolved: list[datetime | None] = list(raw_dates)
    last: datetime | None = None
    for index, value in enumerate(resolved):
        if value is not None:
            last = value
        elif last is not None:
            resolved[index] = last
    nxt: datetime | None = None
    for index in range(len(resolved) - 1, -1, -1):
        if resolved[index] is not None:
            nxt = resolved[index]
        elif nxt is not None:
            resolved[index] = nxt
    if any(value is None for value in resolved):
        total = len(resolved)
        return [now - timedelta(days=total - 1 - index) for index in range(total)]
    return [value for value in resolved if value is not None]


async def publish_imported_regulation(
    session: AsyncSession,
    reg: Regulation,
    *,
    published_by: uuid.UUID,
    change_brief: str = "匯入既有現行法規",
) -> Regulation:
    """將剛匯入的既有法規標記為現行有效，並把沿革逐筆寫入版本歷程。

    沿革（legislative_history）會被拆成逐筆事件，每筆建立一個 RegulationRevision
    （version 由舊到新遞增）。最新一筆掛上現行全文與條文快照；較早的歷史事件僅保留
    沿革摘要（因無逐版舊文本）。若文件無沿革，則退回建立單一初始快照。
    """
    now = datetime.now(UTC)
    events = split_history_events(reg.legislative_history)
    history_info = [parse_history_date_info(event) for event in events]
    history_dates = [info[0] for info in history_info if info[0] is not None]
    reg.workflow_status = RegulationWorkflowStatus.PUBLISHED
    reg.published_at = min(history_dates, default=now)
    reg.updated_at = max(history_dates, default=now)

    content_snapshot = reg.content
    article_snapshot = _article_snapshot_json(reg.articles)

    if events:
        amended_dates = _resolve_history_dates([item[0] for item in history_info], now)
        total = len(events)
        for version, (event, amended_at) in enumerate(
            zip(events, amended_dates, strict=True), start=1
        ):
            is_latest = version == total
            # reg.revisions.append 而非只 session.add：reg 傳入時通常已被呼叫端
            # selectinload 過 revisions，只 session.add 不會反向同步這個已載入的
            # in-memory collection，回傳物件的 revisions 會看不到剛建立的沿革快照。
            reg.revisions.append(
                RegulationRevision(
                    regulation_id=reg.id,
                    version=version,
                    change_brief=event[:500],
                    # 首筆（制定）與最新一筆視為全文版本
                    is_total_amendment=version == 1 or is_latest,
                    content_snapshot=content_snapshot if is_latest else "",
                    article_snapshot=article_snapshot if is_latest else "[]",
                    proposal_metadata_snapshot=reg.proposal_metadata if is_latest else None,
                    amended_at=amended_at,
                    amended_at_precision=history_info[version - 1][1],
                    amended_year=history_info[version - 1][2],
                    amended_by=published_by,
                )
            )
        reg.version = total
    else:
        reg.version = 1
        reg.revisions.append(
            RegulationRevision(
                regulation_id=reg.id,
                version=1,
                change_brief=change_brief,
                is_total_amendment=True,
                content_snapshot=content_snapshot,
                article_snapshot=article_snapshot,
                proposal_metadata_snapshot=reg.proposal_metadata,
                amended_at=now,
                amended_by=published_by,
            )
        )

    await session.flush()
    loaded = await get_regulation(session, reg.id)
    await invalidate_dashboard_cache()
    return loaded or reg


# ── 更新 ─────────────────────────────────────────────────────────────────────


# ── 發布 ─────────────────────────────────────────────────────────────────────


async def publish_regulation(
    session: AsyncSession,
    reg: Regulation,
    *,
    data: RegulationPublishRequest,
    published_by: uuid.UUID,
) -> Regulation:
    """公布既有來源資料，保留版本快照，不啟動起草或審議流程。"""
    if reg.workflow_status == RegulationWorkflowStatus.PUBLISHED:
        raise ValueError("此法規已公布")
    if reg.is_repealed or reg.workflow_status == RegulationWorkflowStatus.ARCHIVED:
        raise ValueError("已廢止或封存的法規不可公布")
    if not (reg.content or "").strip() and not any(
        not article.is_deleted and article.article_type == "article" for article in reg.articles
    ):
        raise ValueError("法規尚無可公布的內容")

    change_brief = data.change_brief.strip() or "公布法規"
    now = datetime.now(UTC)
    reg.workflow_status = RegulationWorkflowStatus.PUBLISHED
    reg.workflow_note = None
    reg.is_active = True
    reg.published_at = now
    reg.version = max([reg.version, *(revision.version + 1 for revision in reg.revisions)])
    reg.revisions.append(
        RegulationRevision(
            regulation_id=reg.id,
            version=reg.version,
            change_brief=change_brief,
            is_total_amendment=data.is_total_amendment,
            content_snapshot=reg.content,
            article_snapshot=_article_snapshot_json(reg.articles),
            proposal_metadata_snapshot=reg.proposal_metadata,
            resolution_link=data.resolution_link,
            amended_at=now,
            amended_by=published_by,
        )
    )
    await session.flush()
    logger.info("法規公布 id=%s title=%s", reg.id, reg.title)
    loaded = await get_regulation(session, reg.id)
    await invalidate_dashboard_cache()
    return loaded or reg


# ── 停用 ─────────────────────────────────────────────────────────────────────


# ── 刪除 ─────────────────────────────────────────────────────────────────────


# ── 條文管理 ─────────────────────────────────────────────────────────────────


async def list_regulation_revisions(
    session: AsyncSession,
    reg_id: uuid.UUID,
) -> list[RegulationRevision]:
    """取得法規所有修訂歷程（按版本號排序）"""
    result = await session.execute(
        select(RegulationRevision)
        .options(selectinload(RegulationRevision.published_document))
        .where(RegulationRevision.regulation_id == reg_id)
        .order_by(RegulationRevision.version)
    )
    return list(result.scalars().all())


# ── 審議流程 ─────────────────────────────────────────────────────────────────

# 合法的狀態轉移映射


# ── 條文批次重排 ─────────────────────────────────────────────────────────────


async def get_article_tree(
    session: AsyncSession,
    reg: Regulation,
) -> list[RegulationTreeNodeOut]:
    _ = session
    return _build_tree_nodes(reg.articles)


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
