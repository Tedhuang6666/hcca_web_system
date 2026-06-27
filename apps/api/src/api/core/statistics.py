"""Statistics and Summary Caching - Pre-computed aggregates for dashboard/reporting"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.cache import cache_get, cache_set
from api.models.document import Document, DocumentCategory, DocumentStatus
from api.models.org import Org


async def get_document_count_by_status(
    db: AsyncSession,
    org_id: uuid.UUID | None = None,
) -> dict[str, int]:
    """
    Get document count per status (cached).
    Used for dashboard summary widgets.

    Cache pattern: doc:count:status:{org_id or 'all'}
    TTL: 300s (regenerate on org change)
    """
    cache_key = f"doc:count:status:{org_id or 'all'}"
    cached = await cache_get(cache_key)
    if cached is not None:
        return cached

    q = select(DocumentStatus, func.count(Document.id)).group_by(DocumentStatus)
    if org_id:
        q = q.where(Document.org_id == org_id)

    result = await db.execute(q)
    counts = dict(result.fetchall())

    # Convert enum keys to string for JSON serialization
    result_dict = {str(status.value): count for status, count in counts.items()}
    await cache_set(cache_key, result_dict, ttl=300)
    return result_dict


async def get_document_count_by_category(
    db: AsyncSession,
    org_id: uuid.UUID | None = None,
) -> dict[str, int]:
    """
    Get document count per category (cached).
    Used for document type analytics.

    Cache pattern: doc:count:category:{org_id or 'all'}
    TTL: 300s (regenerate on org change)
    """
    cache_key = f"doc:count:category:{org_id or 'all'}"
    cached = await cache_get(cache_key)
    if cached is not None:
        return cached

    q = select(DocumentCategory, func.count(Document.id)).group_by(DocumentCategory)
    if org_id:
        q = q.where(Document.org_id == org_id)

    result = await db.execute(q)
    counts = dict(result.fetchall())

    # Convert enum keys to string
    result_dict = {str(category.value): count for category, count in counts.items()}
    await cache_set(cache_key, result_dict, ttl=300)
    return result_dict


async def get_org_summary(
    db: AsyncSession,
    org_id: uuid.UUID,
) -> dict[str, int | str]:
    """
    Get organization summary (document + user counts).
    Useful for org profile pages.

    Cache pattern: org:summary:{org_id}
    TTL: 600s (regenerate infrequently)
    """
    cache_key = f"org:summary:{org_id}"
    cached = await cache_get(cache_key)
    if cached is not None:
        return cached

    org_result = await db.execute(select(Org).where(Org.id == org_id))
    org = org_result.scalar_one_or_none()
    if not org:
        return {}

    doc_count_result = await db.execute(
        select(func.count(Document.id)).where(Document.org_id == org_id)
    )
    doc_count = doc_count_result.scalar() or 0

    result = {
        "org_id": str(org_id),
        "org_name": org.name,
        "document_count": doc_count,
    }
    await cache_set(cache_key, result, ttl=300)
    return result


async def invalidate_statistics_cache(org_id: uuid.UUID | None = None) -> None:
    """Clear cached statistics when data changes"""
    from api.core.cache import cache_invalidate

    if org_id:
        await cache_invalidate(f"doc:count:status:{org_id}")
        await cache_invalidate(f"doc:count:category:{org_id}")
        await cache_invalidate(f"org:summary:{org_id}")
    else:
        # Invalidate all org stats
        await cache_invalidate("doc:count:status:*")
        await cache_invalidate("doc:count:category:*")
        await cache_invalidate("org:summary:*")
