"""Discord 指令領域 handler。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from api.models.user import User
from api.schemas.announcement import AnnouncementAudience, AnnouncementCreate
from api.schemas.survey import SurveyCreate
from api.services import announcement as announcement_svc
from api.services import survey as survey_svc
from api.services.discord_command_common import (
    DiscordCommandError,
    _audit,
    _has_permission,
    _primary_org,
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
    if operation in {"announcement_create", "survey_create"}:
        permission = {
            "announcement_create": "announcement:create",
            "survey_create": "survey:create",
        }[operation]
        if not _has_permission(user, codes, permission):
            raise DiscordCommandError("你沒有建立此項目的權限。")
        org_id = await _primary_org(db, user.id)
        if operation == "announcement_create":
            created = await announcement_svc.create_announcement(
                db,
                data=AnnouncementCreate(
                    title=str(arguments["title"]),
                    content={
                        "type": "doc",
                        "content": [
                            {
                                "type": "paragraph",
                                "content": [{"type": "text", "text": str(arguments["body"])}],
                            }
                        ],
                    },
                    is_urgent=bool(arguments.get("is_urgent")),
                    org_id=org_id,
                    audience_type=AnnouncementAudience.ALL,
                ),
                created_by=user.id,
            )
        else:
            created = await survey_svc.create_survey(
                db,
                data=SurveyCreate(
                    title=str(arguments["title"]),
                    description=arguments.get("description"),
                    is_anonymous=bool(arguments.get("is_anonymous")),
                    org_id=org_id,
                    closes_at=datetime.now(UTC) + timedelta(days=7),
                ),
                created_by=user.id,
            )
        await _audit(
            db,
            user,
            interaction_id=interaction_id,
            guild_id=guild_id,
            entity_type=operation.removesuffix("_create"),
            entity_id=str(created.id),
            action=f"discord.{operation.replace('_', '.')}",
            summary=f"Discord 建立「{created.title}」",
        )
        return {"id": str(created.id), "title": created.title}
    if operation == "moderation_audit":
        if not _has_permission(user, codes, "admin:all"):
            raise DiscordCommandError("你沒有 Discord 社群管理權限。")
        await _audit(
            db,
            user,
            interaction_id=interaction_id,
            guild_id=guild_id,
            entity_type="discord_guild",
            entity_id=guild_id or "dm",
            action=str(arguments["action"]),
            summary=str(arguments["summary"]),
            meta=dict(arguments.get("meta") or {}),
        )
        return {}
    return None
