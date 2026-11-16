"""抽獎路由：同一 token 重複抽獎回傳原結果、重設留下稽核紀錄。"""

from __future__ import annotations

from collections.abc import Callable

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.audit_log import AuditLog
from api.models.user import User


async def _open_event(ac: AsyncClient) -> str:
    created = await ac.post(
        "/raffles",
        json={
            "title": "校慶抽獎",
            "access_code": "8642",
            "prizes": [{"tier": "Z", "name": "參加獎", "total_quantity": None}],
        },
    )
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]
    opened = await ac.patch(f"/raffles/{event_id}", json={"status": "open"})
    assert opened.status_code == 200, opened.text
    return event_id


async def test_second_draw_with_same_token_returns_original_result(
    client: AsyncClient,
    admin_user: User,
    authed_client_factory: Callable[[User], AsyncClient],
) -> None:
    await _open_event(authed_client_factory(admin_user))
    joined = await client.post("/raffles/join", json={"access_code": "8642"})
    token = joined.json()["session_token"]

    first = await client.post(
        "/raffles/draw", json={"session_token": token, "idempotency_key": "first-draw-key"}
    )
    second = await client.post(
        "/raffles/draw", json={"session_token": token, "idempotency_key": "second-draw-key"}
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]


async def test_reset_keeps_cleared_draws_in_audit_log(
    client: AsyncClient,
    db_session: AsyncSession,
    admin_user: User,
    authed_client_factory: Callable[[User], AsyncClient],
) -> None:
    admin = authed_client_factory(admin_user)
    event_id = await _open_event(admin)
    token = (await client.post("/raffles/join", json={"access_code": "8642"})).json()[
        "session_token"
    ]
    await client.post(
        "/raffles/draw", json={"session_token": token, "idempotency_key": "reset-draw-key"}
    )

    reset = await admin.post(f"/raffles/{event_id}/reset")

    assert reset.status_code == 200
    entry = await db_session.scalar(
        select(AuditLog).where(AuditLog.action == "raffle.reset", AuditLog.entity_id == event_id)
    )
    assert entry is not None
    assert len(entry.meta["previous_draws"]) == 1
