"""Discord 指令領域 handler。"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from api.models.user import User
from api.schemas.document import RejectMode
from api.services import document as document_svc
from api.services.discord_bot import (
    create_open_url,
)
from api.services.discord_command_common import (
    DiscordCommandError,
    _audit,
    _has_permission,
    _task,
)
from api.services.task_inbox import build_task_inbox


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
    if operation == "documents_pending":
        inbox = await build_task_inbox(db, user)
        docs = [item for item in inbox.items if item.module == "document"][:5]
        return {
            "items": [
                {
                    **_task(item),
                    "document_id": item.id.split(":")[-1],
                    "open_url": await create_open_url(user.id, item.href),
                }
                for item in docs
            ]
        }
    if operation in {"document_approve", "document_reject"}:
        permission = "document:approve" if operation == "document_approve" else "document:reject"
        if not _has_permission(user, codes, permission):
            raise DiscordCommandError("你沒有處理此公文的權限。")
        document = await document_svc.get_document(db, uuid.UUID(str(arguments["document_id"])))
        if document is None:
            raise DiscordCommandError("找不到此公文。")
        try:
            if operation == "document_approve":
                updated = await document_svc.approve_document(
                    db, document, approver_id=user.id, comment="Discord 核准"
                )
            else:
                updated = await document_svc.reject_document(
                    db,
                    document,
                    approver_id=user.id,
                    comment=str(arguments["comment"]),
                    mode=(
                        RejectMode.TO_PREVIOUS
                        if arguments.get("mode") == RejectMode.TO_PREVIOUS
                        else RejectMode.TO_CREATOR
                    ),
                )
        except (PermissionError, ValueError) as exc:
            raise DiscordCommandError(str(exc)) from exc
        await _audit(
            db,
            user,
            interaction_id=interaction_id,
            guild_id=guild_id,
            entity_type="document",
            entity_id=str(updated.id),
            action=f"discord.{operation.replace('_', '.')}",
            summary=f"Discord {'核准' if operation == 'document_approve' else '退回'}公文「{updated.title}」",
        )
        return {"title": updated.title}
    return None
