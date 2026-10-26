"""Discord 指令領域 handler。"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from api.models.announcement import Announcement
from api.models.document import Document
from api.models.regulation import Regulation, RegulationArticle
from api.models.survey import Survey, SurveyStatus
from api.models.user import User
from api.services.discord_bot import (
    create_open_url,
)
from api.services.discord_command_common import (
    DiscordCommandError,
)


async def handle(
    db: AsyncSession,
    user: User,
    codes: frozenset[str],
    *,
    operation: str,
    discord_user_id: str,
    interaction_id: str,
    guild_id: str | None,
    arguments: dict[str, Any],
) -> dict[str, Any] | None:
    if operation == "browse_announcements":
        statement = (
            select(Announcement)
            .where(Announcement.is_published.is_(True))
            .order_by(Announcement.published_at.desc().nullslast())
            .limit(10)
        )
        if arguments.get("urgent_only"):
            statement = statement.where(Announcement.is_urgent.is_(True))
        rows = (await db.execute(statement)).scalars()
        return {
            "items": [
                {
                    "title": row.title,
                    "is_urgent": row.is_urgent,
                    "published_at": row.published_at.isoformat() if row.published_at else None,
                    "url": await create_open_url(user.id, f"/announcements/{row.id}"),
                }
                for row in rows
            ]
        }
    if operation in {"browse_surveys", "survey_choices"}:
        rows = (
            await db.execute(
                select(Survey)
                .where(Survey.status == SurveyStatus.OPEN)
                .order_by(Survey.closes_at.asc().nullslast())
                .limit(25 if operation == "survey_choices" else 10)
            )
        ).scalars()
        return {
            "items": [
                {
                    "id": str(row.id),
                    "title": row.title,
                    "closes_at": row.closes_at.isoformat() if row.closes_at else None,
                    "is_anonymous": row.is_anonymous,
                    "url": await create_open_url(user.id, f"/surveys/{row.id}"),
                }
                for row in rows
            ]
        }
    if operation in {"browse_regulations", "regulation_choices"}:
        statement = (
            select(Regulation)
            .options(
                load_only(
                    Regulation.id,
                    Regulation.title,
                    Regulation.version,
                    Regulation.workflow_status,
                    Regulation.published_at,
                    Regulation.updated_at,
                )
            )
            .where(Regulation.is_active.is_(True))
            .order_by(Regulation.updated_at.desc())
            .limit(25 if operation == "regulation_choices" else 10)
        )
        query = str(arguments.get("query") or "").lower()
        if query:
            statement = statement.where(func.lower(Regulation.title).contains(query))
        rows = (await db.execute(statement)).scalars()
        return {
            "items": [
                {
                    "id": str(row.id),
                    "title": row.title,
                    "version": row.version,
                    "workflow_status": str(row.workflow_status),
                    "published": row.published_at is not None,
                    "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                    "url": await create_open_url(user.id, f"/regulations/{row.id}"),
                }
                for row in rows
            ]
        }
    if operation == "search":
        query = str(arguments["query"])
        if len(query) < 2:
            raise DiscordCommandError("關鍵字至少 2 個字。")
        scope = str(arguments.get("scope") or "all")
        needle = f"%{query}%"
        items: list[dict[str, Any]] = []
        if scope in {"all", "announcement"}:
            rows = (
                await db.execute(
                    select(Announcement)
                    .where(
                        Announcement.title.ilike(needle),
                        Announcement.is_published.is_(True),
                    )
                    .order_by(Announcement.published_at.desc().nullslast())
                    .limit(5)
                )
            ).scalars()
            for row in rows:
                items.append(
                    {
                        "type": "announcement",
                        "title": row.title,
                        "url": await create_open_url(user.id, f"/announcements/{row.id}"),
                    }
                )
        if scope in {"all", "document"}:
            rows = (
                await db.execute(
                    select(Document)
                    .where(
                        or_(
                            Document.title.ilike(needle),
                            Document.subject.ilike(needle),
                            Document.serial_number.ilike(needle),
                        )
                    )
                    .order_by(Document.updated_at.desc())
                    .limit(5)
                )
            ).scalars()
            for row in rows:
                items.append(
                    {
                        "type": "document",
                        "title": row.title,
                        "subtitle": row.serial_number,
                        "url": await create_open_url(user.id, f"/documents/{row.id}"),
                    }
                )
        if scope in {"all", "regulation"}:
            rows = (
                await db.execute(
                    select(Regulation)
                    .options(load_only(Regulation.id, Regulation.title, Regulation.version))
                    .where(
                        Regulation.title.ilike(needle),
                        Regulation.is_active.is_(True),
                    )
                    .order_by(Regulation.updated_at.desc())
                    .limit(5)
                )
            ).scalars()
            for row in rows:
                items.append(
                    {
                        "type": "regulation",
                        "title": row.title,
                        "subtitle": f"v{row.version}",
                        "url": await create_open_url(user.id, f"/regulations/{row.id}"),
                    }
                )
        return {"items": items}
    if operation == "regulation_quote":
        regulation = await db.get(Regulation, uuid.UUID(str(arguments["regulation_id"])))
        if regulation is None:
            raise DiscordCommandError("找不到這條法規。")
        statement = (
            select(RegulationArticle)
            .where(
                RegulationArticle.regulation_id == regulation.id,
                RegulationArticle.is_deleted.is_(False),
                RegulationArticle.content.is_not(None),
            )
            .order_by(RegulationArticle.sort_index)
        )
        if arguments.get("article_no"):
            statement = statement.where(
                RegulationArticle.legal_number == str(arguments["article_no"]).strip()
            )
        article = await db.scalar(statement.limit(1))
        if article is None:
            raise DiscordCommandError("找不到可顯示的條文。")
        return {
            "title": regulation.title,
            "legal_number": article.legal_number,
            "subtitle": article.subtitle,
            "content": article.content,
            "url": await create_open_url(user.id, f"/regulations/{regulation.id}"),
        }
    return None
