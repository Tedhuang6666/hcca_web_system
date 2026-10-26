"""Discord 指令領域 handler。"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from api.models.petition import PetitionStatus
from api.models.user import User
from api.schemas.petition import PetitionCreate, PetitionInternalNoteCreate, PetitionStatusUpdate
from api.services import petition as petition_svc
from api.services.discord_bot import (
    create_open_url,
    enqueue_petition_private_channel,
)
from api.services.discord_command_common import (
    DiscordCommandError,
    _audit,
    _has_permission,
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
    if operation == "petition_create":
        types = await petition_svc.list_types(db, active_only=True)
        if not types:
            raise DiscordCommandError("目前沒有可用的陳情類型。")
        case_obj, _share_token = await petition_svc.create_case(
            db,
            data=PetitionCreate(
                type_id=types[0].id,
                title=str(arguments["title"]),
                content=str(arguments["content"]),
            ),
            submitter=user,
        )
        await enqueue_petition_private_channel(db, case_obj)
        await _audit(
            db,
            user,
            interaction_id=interaction_id,
            guild_id=guild_id,
            entity_type="petition_case",
            entity_id=str(case_obj.id),
            action="discord.petition.create",
            summary=f"Discord 建立陳情案件 {case_obj.case_number}",
            meta={"case_number": case_obj.case_number},
        )
        return {"case_number": case_obj.case_number}
    if operation in {"petitions_pending", "petition_choices"}:
        cases = await petition_svc.list_cases(db, assigned_to_id=user.id, limit=25)
        return {
            "items": [
                {
                    "id": str(item.id),
                    "case_number": item.case_number,
                    "title": item.title,
                    "status": str(item.status),
                    "open_url": await create_open_url(user.id, f"/petitions/manage?case={item.id}"),
                }
                for item in cases
            ]
        }
    if operation in {"petition_note", "petition_channel", "petition_in_progress"}:
        if not _has_permission(user, codes, "petition:handle"):
            raise DiscordCommandError("你沒有處理陳情權限。")
        case_obj = await petition_svc.get_case(db, uuid.UUID(str(arguments["case_id"])))
        if case_obj is None:
            raise DiscordCommandError("找不到此陳情案件。")
        if not await petition_svc.can_view_case(db, case_obj, user):
            raise DiscordCommandError("無權查看此陳情案件。")
        if operation == "petition_note":
            await petition_svc.add_internal_note(
                db,
                case_obj,
                data=PetitionInternalNoteCreate(content=str(arguments["content"])),
                actor_id=user.id,
            )
        elif operation == "petition_channel":
            if not await enqueue_petition_private_channel(db, case_obj, force=True):
                raise DiscordCommandError("此案件已有頻道，或後台尚未完成頻道設定。")
        else:
            case_obj = await petition_svc.update_status(
                db,
                case_obj,
                data=PetitionStatusUpdate(
                    status=PetitionStatus.IN_PROGRESS,
                    internal_note="Discord 標記處理中",
                ),
                actor_id=user.id,
            )
        await _audit(
            db,
            user,
            interaction_id=interaction_id,
            guild_id=guild_id,
            entity_type="petition_case",
            entity_id=str(case_obj.id),
            action=f"discord.{operation.replace('_', '.')}",
            summary=f"Discord 更新陳情案件 {case_obj.case_number}",
        )
        return {"case_number": case_obj.case_number}
    return None
