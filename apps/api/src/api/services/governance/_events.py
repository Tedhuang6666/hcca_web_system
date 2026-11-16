"""時間軸事件 / 任務 / 決議"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from api.models.governance import (
    TimelineEvent,
)
from api.models.user import User


async def record_event(
    db: AsyncSession,
    *,
    matter_id: uuid.UUID | None,
    event_type: str,
    title: str,
    actor: User | None = None,
    actor_id: uuid.UUID | None = None,
    actor_email: str | None = None,
    case_id: uuid.UUID | None = None,
    body: str | None = None,
    payload: dict | None = None,
) -> TimelineEvent:
    # actor（User 物件）優先；audit 橋接只有 id/email 字串時走 actor_id/actor_email。
    resolved_actor_id = actor.id if actor else actor_id
    resolved_actor_email = actor.email if actor else actor_email
    event = TimelineEvent(
        matter_id=matter_id,
        case_id=case_id,
        event_type=str(event_type),
        title=title,
        body=body,
        actor_id=resolved_actor_id,
        actor_email=resolved_actor_email,
        payload=json.loads(json.dumps(payload or {}, default=str)),
        created_at=datetime.now(UTC),
    )
    db.add(event)
    await db.flush()
    return event
