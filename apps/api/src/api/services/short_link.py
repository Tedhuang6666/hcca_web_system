"""班聯短網址的資料存取與 slug 規則。"""

from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.short_link import ShortLink
from api.schemas.short_link import ShortLinkCreate, ShortLinkUpdate


class ShortLinkConflictError(Exception):
    """slug 已被使用或與網站既有路由衝突。"""


class ShortLinkNotFoundError(Exception):
    """管理端指定的短網址不存在。"""


class ShortLinkSlugUnavailableError(Exception):
    """slug 目前未啟用或不存在。"""


# Next.js 靜態路由優先於 /[slug]，保留所有現有一層網站路徑，避免建立無法導向的短網址。
RESERVED_ROOT_SLUGS = frozenset(
    {
        "about",
        "admin",
        "analytics",
        "announcements",
        "articles",
        "api",
        "apple-icon",
        "audit-logs",
        "auth",
        "backoffice",
        "blocked",
        "contact",
        "council-proposals",
        "credential",
        "dashboard",
        "document-templates",
        "documents",
        "email",
        "exam-papers",
        "finance",
        "judicial-petitions",
        "legal",
        "links",
        "live",
        "login",
        "maintenance",
        "merchandise-submissions",
        "module-status",
        "news",
        "notifications",
        "opengraph-image",
        "officers",
        "operations",
        "orgs",
        "pages",
        "partner-map",
        "petitions",
        "profile",
        "public",
        "publications",
        "qr-code",
        "raffle",
        "recommended-vendors",
        "regulations",
        "search",
        "seating",
        "serial-templates",
        "settings",
        "shop",
        "surveys",
        "system-info",
        "tasks",
        "unsubscribe",
        "work-items",
        "icon",
    }
)
SERIAL_DOCUMENT_SLUG_RE = re.compile(r"^[一-鿿]+字(?:第)?[0-9]+號$")


async def list_short_links(db: AsyncSession) -> list[ShortLink]:
    result = await db.scalars(
        select(ShortLink).order_by(ShortLink.created_at.desc(), ShortLink.slug)
    )
    return list(result.all())


async def create_short_link(db: AsyncSession, data: ShortLinkCreate) -> ShortLink:
    if data.slug in RESERVED_ROOT_SLUGS or SERIAL_DOCUMENT_SLUG_RE.fullmatch(data.slug):
        raise ShortLinkConflictError("這個路徑已由網站功能使用")

    short_link = ShortLink(
        slug=data.slug,
        title=data.title,
        target_url=str(data.target_url),
    )
    db.add(short_link)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ShortLinkConflictError("這個短網址路徑已存在") from exc
    return short_link


async def update_short_link(db: AsyncSession, link_id: UUID, data: ShortLinkUpdate) -> ShortLink:
    short_link = await db.get(ShortLink, link_id)
    if short_link is None:
        raise ShortLinkNotFoundError

    updates = data.model_dump(exclude_unset=True)
    if "target_url" in updates:
        updates["target_url"] = str(updates["target_url"])
    for field, value in updates.items():
        setattr(short_link, field, value)
    await db.flush()
    return short_link


async def resolve_short_link(db: AsyncSession, slug: str) -> ShortLink:
    result = await db.scalar(
        select(ShortLink).where(ShortLink.slug == slug, ShortLink.is_active.is_(True))
    )
    if result is None:
        raise ShortLinkSlugUnavailableError
    return result
