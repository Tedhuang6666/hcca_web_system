"""Discord 指令領域 handler。"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from api.services.discord_bot import (
    get_user_by_discord_id,
)
from api.services.discord_command_common import _actor
from api.services.discord_regulation import lookup_citation, parse_citations


async def handle_identity(
    db: AsyncSession, *, operation: str, discord_user_id: str, arguments: dict[str, Any]
) -> dict[str, Any] | None:
    if operation == "context":
        user, codes = await _actor(db, discord_user_id)
        return {
            "id": str(user.id),
            "display_name": user.display_name,
            "email": user.email,
            "permissions": sorted(codes),
            "is_superuser": user.is_superuser,
        }
    if operation == "user_lookup":
        target = await get_user_by_discord_id(db, str(arguments["discord_user_id"]))
        return {
            "linked": target is not None,
            "display_name": target.display_name if target else None,
            "email": target.email if target else None,
        }
    if operation == "regulation_citations":
        results = []
        for citation in parse_citations(str(arguments.get("content") or ""), limit=3):
            found = await lookup_citation(db, citation)
            if found is None:
                continue
            regulation, article = found
            results.append(
                {
                    "title": regulation.title,
                    "legal_number": article.legal_number,
                    "subtitle": article.subtitle,
                    "content": article.content,
                    "url": f"/regulations/{regulation.id}",
                }
            )
        return {"items": results}
    return None
