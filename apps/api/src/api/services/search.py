"""Global search service with Meilisearch first and SQL fallback."""

from __future__ import annotations

import logging
from typing import Any, Literal

import httpx
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.models.announcement import Announcement
from api.models.document import Document
from api.models.meeting import Meeting
from api.models.regulation import Regulation

logger = logging.getLogger(__name__)

SearchKind = Literal["document", "regulation", "meeting", "announcement"]


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


async def search(db: AsyncSession, query: str, *, limit: int = 10) -> list[dict[str, Any]]:
    q = query.strip()
    if meili_enabled():
        try:
            payload = await _meili_request(
                "POST",
                f"/indexes/{_index_name()}/search",
                {"q": q, "limit": limit, "attributesToHighlight": ["title", "summary"]},
            )
            return list(payload.get("hits", []))
        except Exception:
            logger.warning("Meilisearch query failed; falling back to SQL", exc_info=True)

    return await _sql_fallback(db, q, limit=limit)


async def _sql_fallback(db: AsyncSession, query: str, *, limit: int) -> list[dict[str, Any]]:
    if not query:
        return []
    pattern = f"%{query}%"
    results: list[dict[str, Any]] = []

    docs = (
        await db.execute(
            select(Document)
            .where(or_(Document.title.ilike(pattern), Document.content.ilike(pattern)))
            .limit(limit)
        )
    ).scalars()
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

    regs = (
        await db.execute(
            select(Regulation)
            .where(or_(Regulation.title.ilike(pattern), Regulation.content.ilike(pattern)))
            .limit(limit)
        )
    ).scalars()
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

    meetings = (
        await db.execute(select(Meeting).where(Meeting.title.ilike(pattern)).limit(limit))
    ).scalars()
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

    anns = (
        await db.execute(select(Announcement).where(Announcement.title.ilike(pattern)).limit(limit))
    ).scalars()
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
    documents: list[dict[str, Any]] = []

    for doc in (await db.execute(select(Document))).scalars():
        documents.append(
            {
                "id": f"document-{doc.id}",
                "kind": "document",
                "title": doc.title,
                "summary": doc.content[:300],
                "href": f"/documents/{doc.id}",
                "content": doc.content,
                "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
            }
        )

    for reg in (await db.execute(select(Regulation))).scalars():
        documents.append(
            {
                "id": f"regulation-{reg.id}",
                "kind": "regulation",
                "title": reg.title,
                "summary": reg.content[:300],
                "href": f"/regulations/{reg.id}",
                "content": reg.content,
                "updated_at": reg.updated_at.isoformat() if reg.updated_at else None,
            }
        )

    for meeting in (await db.execute(select(Meeting))).scalars():
        documents.append(
            {
                "id": f"meeting-{meeting.id}",
                "kind": "meeting",
                "title": meeting.title,
                "summary": meeting.description or "",
                "href": f"/meetings/{meeting.id}",
                "content": meeting.description or "",
                "updated_at": meeting.updated_at.isoformat() if meeting.updated_at else None,
            }
        )

    for ann in (await db.execute(select(Announcement))).scalars():
        documents.append(
            {
                "id": f"announcement-{ann.id}",
                "kind": "announcement",
                "title": ann.title,
                "summary": "",
                "href": f"/announcements/{ann.id}",
                "content": str(ann.content or ""),
                "updated_at": ann.updated_at.isoformat() if ann.updated_at else None,
            }
        )

    if not meili_enabled():
        return {"enabled": False, "indexed": len(documents)}

    await _meili_request("POST", f"/indexes/{_index_name()}/documents", documents)
    return {"enabled": True, "index": _index_name(), "indexed": len(documents)}
