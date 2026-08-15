"""Global search service with Meilisearch first and SQL fallback."""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator, Callable
from typing import Any, Literal

import httpx
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only, selectinload

from api.core.clock import local_today
from api.core.config import settings
from api.models.announcement import Announcement
from api.models.document import Document
from api.models.meeting import Meeting
from api.models.org import Position, UserPosition
from api.models.regulation import Regulation
from api.models.user import User
from api.services.document._access import _build_visibility_filter, _get_active_descendant_org_ids
from api.services.permission import active_tenure_filter
from api.services.school_class import get_user_active_class_ids

logger = logging.getLogger(__name__)

SearchKind = Literal["document", "regulation", "meeting", "announcement"]
_REBUILD_BATCH_SIZE = 500
_FILTERABLE_ATTRIBUTES = [
    "kind",
    "is_public",
    "visibility_level",
    "org_id",
    "created_by",
    "approval_user_ids",
    "recipient_user_ids",
    "recipient_org_ids",
    "recipient_class_ids",
    "recipient_emails",
    "is_published",
    "audience_type",
    "status",
]


def _index_name() -> str:
    return f"{settings.MEILISEARCH_INDEX_PREFIX}_global"


def meili_enabled() -> bool:
    return bool(settings.MEILISEARCH_URL)


async def _meili_request(method: str, path: str, json: Any | None = None) -> dict[str, Any]:
    headers = {"Content-Type": "application/json"}
    if settings.MEILISEARCH_API_KEY:
        headers["Authorization"] = f"Bearer {settings.MEILISEARCH_API_KEY}"
    async with httpx.AsyncClient(
        base_url=settings.MEILISEARCH_URL.rstrip("/"), timeout=10
    ) as client:
        res = await client.request(method, path, headers=headers, json=json)
        res.raise_for_status()
        return res.json() if res.content else {}


async def _viewer_visibility(
    db: AsyncSession, viewer_id: uuid.UUID
) -> tuple[set[uuid.UUID], set[uuid.UUID], set[uuid.UUID], str | None]:
    """取得 Meilisearch filter 所需的即時身分範圍。

    索引只保存可重建的識別欄位；組織任期與班級成員資格必須每次搜尋從
    PostgreSQL 讀取，避免權限異動後仍沿用舊的前端或搜尋快取。
    """
    viewer = await db.get(User, viewer_id)
    org_result = await db.execute(
        select(Position.org_id)
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(UserPosition.user_id == viewer_id, *active_tenure_filter(local_today()))
        .distinct()
    )
    org_ids = set(org_result.scalars().all())
    subject_org_ids = set(await _get_active_descendant_org_ids(db, list(org_ids)))
    class_ids = await get_user_active_class_ids(db, viewer_id)
    return org_ids, subject_org_ids, class_ids, viewer.email if viewer else None


def _quoted(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _meili_visibility_filter(
    *,
    viewer_id: uuid.UUID,
    org_ids: set[uuid.UUID],
    subject_org_ids: set[uuid.UUID],
    class_ids: set[uuid.UUID],
    email: str | None,
) -> str:
    viewer = _quoted(str(viewer_id))
    document_conditions = [
        'visibility_level = "publicly_open"',
        "is_public = true",
        'visibility_level = "public"',
        f"created_by = {viewer}",
        f"approval_user_ids = {viewer}",
        f"recipient_user_ids = {viewer}",
    ]
    if email:
        document_conditions.append(f"recipient_emails = {_quoted(email)}")
    if org_ids:
        values = ", ".join(_quoted(str(value)) for value in org_ids)
        document_conditions.append(f'(visibility_level = "org_only" AND org_id IN [{values}])')
    if subject_org_ids:
        values = ", ".join(_quoted(str(value)) for value in subject_org_ids)
        document_conditions.append(f'(visibility_level = "subject_only" AND org_id IN [{values}])')
    if class_ids:
        values = ", ".join(_quoted(str(value)) for value in class_ids)
        document_conditions.append(f"recipient_class_ids IN [{values}]")

    document_filter = " AND ".join(['kind = "document"', f"({' OR '.join(document_conditions)})"])
    return " OR ".join(
        [
            f"({document_filter})",
            '(kind = "regulation" AND is_published = true)',
            '(kind = "meeting" AND status != "draft")',
            '(kind = "announcement" AND is_published = true AND audience_type = "all")',
        ]
    )


def _escape_like(value: str) -> str:
    """Escape LIKE/ILIKE metacharacters to prevent wildcard injection."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def search(
    db: AsyncSession,
    query: str,
    *,
    limit: int = 10,
    viewer_id: uuid.UUID | None = None,
    is_superuser: bool = False,
) -> list[dict[str, Any]]:
    # 去除 NUL：0x00 進到 PostgreSQL ILIKE 後備查詢會丟 CharacterNotInRepertoireError → 500。
    q = query.replace("\x00", "").strip()
    if meili_enabled():
        try:
            filter_expression = None
            if not is_superuser:
                if viewer_id is None:
                    filter_expression = (
                        '(kind = "document" AND (visibility_level = "publicly_open" OR is_public = true)) '
                        'OR (kind = "regulation" AND is_published = true) '
                        'OR (kind = "announcement" AND is_published = true AND audience_type = "all") '
                        'OR (kind = "meeting" AND status != "draft")'
                    )
                else:
                    org_ids, subject_org_ids, class_ids, email = await _viewer_visibility(
                        db, viewer_id
                    )
                    filter_expression = _meili_visibility_filter(
                        viewer_id=viewer_id,
                        org_ids=org_ids,
                        subject_org_ids=subject_org_ids,
                        class_ids=class_ids,
                        email=email,
                    )
            body: dict[str, Any] = {
                "q": q,
                "limit": limit,
                "attributesToHighlight": ["title", "summary"],
            }
            if filter_expression:
                body["filter"] = filter_expression
            payload = await _meili_request(
                "POST",
                f"/indexes/{_index_name()}/search",
                body,
            )
            return list(payload.get("hits", []))
        except Exception:
            logger.warning("Meilisearch query failed; falling back to SQL", exc_info=True)

    return await _sql_fallback(db, q, limit=limit, viewer_id=viewer_id, is_superuser=is_superuser)


async def _sql_fallback(
    db: AsyncSession,
    query: str,
    *,
    limit: int,
    viewer_id: uuid.UUID | None = None,
    is_superuser: bool = False,
) -> list[dict[str, Any]]:
    if not query:
        return []
    escaped = _escape_like(query)
    pattern = f"%{escaped}%"
    results: list[dict[str, Any]] = []

    doc_q = select(Document).where(
        or_(
            Document.title.ilike(pattern, escape="\\"),
            Document.content.ilike(pattern, escape="\\"),
        )
    )
    if not is_superuser:
        if viewer_id is None:
            doc_q = doc_q.where(
                or_(
                    Document.visibility_level == "publicly_open",
                    Document.is_public.is_(True),
                )
            )
        else:
            visibility_filter = await _build_visibility_filter(db, viewer_id)
            if visibility_filter:
                doc_q = doc_q.where(or_(*visibility_filter))
            else:
                doc_q = doc_q.where(False)
    docs = (await db.execute(doc_q.limit(limit))).scalars()
    results.extend(
        {
            "id": str(doc.id),
            "kind": "document",
            "title": doc.title,
            "summary": doc.content[:160],
            "href": f"/documents/{doc.id}",
        }
        for doc in docs
    )

    reg_q = (
        select(Regulation)
        .options(load_only(Regulation.id, Regulation.title, Regulation.content))
        .where(
            or_(
                Regulation.title.ilike(pattern, escape="\\"),
                Regulation.content.ilike(pattern, escape="\\"),
            )
        )
    )
    if not is_superuser:
        reg_q = reg_q.where(Regulation.published_at.is_not(None))
    regs = (await db.execute(reg_q.limit(limit))).scalars()
    results.extend(
        {
            "id": str(reg.id),
            "kind": "regulation",
            "title": reg.title,
            "summary": reg.content[:160],
            "href": f"/regulations/{reg.id}",
        }
        for reg in regs
    )

    meeting_q = select(Meeting).where(
        Meeting.title.ilike(pattern, escape="\\"), Meeting.status != "draft"
    )
    meetings = (await db.execute(meeting_q.limit(limit))).scalars()
    results.extend(
        {
            "id": str(meeting.id),
            "kind": "meeting",
            "title": meeting.title,
            "summary": meeting.description or "",
            "href": f"/meetings/{meeting.id}",
        }
        for meeting in meetings
    )

    ann_q = select(Announcement).where(Announcement.title.ilike(pattern, escape="\\"))
    if not is_superuser:
        ann_q = ann_q.where(
            Announcement.is_published == True,  # noqa: E712
            Announcement.audience_type == "all",
        )
    anns = (await db.execute(ann_q.limit(limit))).scalars()
    results.extend(
        {
            "id": str(ann.id),
            "kind": "announcement",
            "title": ann.title,
            "summary": "",
            "href": f"/announcements/{ann.id}",
        }
        for ann in anns
    )
    return results[:limit]


async def rebuild_index(db: AsyncSession) -> dict[str, Any]:
    indexed = 0

    if meili_enabled():
        await _meili_request(
            "PUT",
            f"/indexes/{_index_name()}/settings/filterable-attributes",
            _FILTERABLE_ATTRIBUTES,
        )

    async def batches(
        model: type[Any],
        builder: Callable[[Any], dict[str, Any]],
        *,
        options: tuple[Any, ...] = (),
    ) -> AsyncIterator[list[dict[str, Any]]]:
        last_created_at = None
        last_id = None
        while True:
            query = select(model).options(*options)
            if last_created_at is not None and last_id is not None:
                query = query.where(
                    or_(
                        model.created_at > last_created_at,
                        and_(model.created_at == last_created_at, model.id > last_id),
                    )
                )
            rows = list(
                (
                    await db.execute(
                        query.order_by(model.created_at.asc(), model.id.asc()).limit(
                            _REBUILD_BATCH_SIZE
                        )
                    )
                )
                .scalars()
                .all()
            )
            if not rows:
                return
            yield [builder(row) for row in rows]
            last_created_at, last_id = rows[-1].created_at, rows[-1].id

    def document_payload(doc: Document) -> dict[str, Any]:
        return {
            "id": f"document-{doc.id}",
            "kind": "document",
            "title": doc.title,
            "summary": doc.content[:300],
            "href": f"/documents/{doc.id}",
            "content": doc.content,
            "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
            "visibility_level": getattr(doc.visibility_level, "value", str(doc.visibility_level)),
            "is_public": doc.is_public,
            "org_id": str(doc.org_id),
            "created_by": str(doc.created_by),
            "approval_user_ids": list(
                {
                    str(value)
                    for approval in doc.approvals
                    for value in (approval.approver_id, approval.delegate_id)
                    if value
                }
            ),
            "recipient_user_ids": [
                str(row.target_user_id) for row in doc.recipients if row.target_user_id
            ],
            "recipient_org_ids": [
                str(row.target_org_id) for row in doc.recipients if row.target_org_id
            ],
            "recipient_class_ids": [
                str(row.target_class_id) for row in doc.recipients if row.target_class_id
            ],
            "recipient_emails": [row.email for row in doc.recipients if row.email],
        }

    def regulation_payload(reg: Regulation) -> dict[str, Any]:
        return {
            "id": f"regulation-{reg.id}",
            "kind": "regulation",
            "title": reg.title,
            "summary": reg.content[:300],
            "href": f"/regulations/{reg.id}",
            "content": reg.content,
            "updated_at": reg.updated_at.isoformat() if reg.updated_at else None,
            "is_published": reg.published_at is not None,
        }

    def meeting_payload(meeting: Meeting) -> dict[str, Any]:
        return {
            "id": f"meeting-{meeting.id}",
            "kind": "meeting",
            "title": meeting.title,
            "summary": meeting.description or "",
            "href": f"/meetings/{meeting.id}",
            "content": meeting.description or "",
            "updated_at": meeting.updated_at.isoformat() if meeting.updated_at else None,
            "status": getattr(meeting.status, "value", str(meeting.status)),
        }

    def announcement_payload(ann: Announcement) -> dict[str, Any]:
        return {
            "id": f"announcement-{ann.id}",
            "kind": "announcement",
            "title": ann.title,
            "summary": "",
            "href": f"/announcements/{ann.id}",
            "content": str(ann.content or ""),
            "updated_at": ann.updated_at.isoformat() if ann.updated_at else None,
            "is_published": ann.is_published,
            "audience_type": ann.audience_type,
        }

    sources = (
        (
            Document,
            document_payload,
            (selectinload(Document.approvals), selectinload(Document.recipients)),
        ),
        (Regulation, regulation_payload, ()),
        (Meeting, meeting_payload, ()),
        (Announcement, announcement_payload, ()),
    )
    for model, builder, options in sources:
        async for batch in batches(model, builder, options=options):
            indexed += len(batch)
            if meili_enabled():
                await _meili_request("POST", f"/indexes/{_index_name()}/documents", batch)

    result: dict[str, Any] = {"enabled": meili_enabled(), "indexed": indexed}
    if meili_enabled():
        result["index"] = _index_name()
    return result
