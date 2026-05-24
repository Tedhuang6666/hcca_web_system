"""LINE Bot 綁定服務測試"""

from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.line_account import LineAccountLink
from api.models.user import User
from api.services import line_bot


class FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def set(self, key: str, value: str, *, ex: int, nx: bool) -> bool:
        if nx and key in self.store:
            return False
        self.store[key] = value
        return True

    async def setex(self, key: str, ttl: int, value: str) -> None:
        self.store[key] = value

    async def get(self, key: str) -> str | None:
        return self.store.get(key)

    async def delete(self, key: str) -> None:
        self.store.pop(key, None)


@pytest.mark.asyncio
async def test_create_link_code_stores_user_id(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeRedis()
    monkeypatch.setattr(line_bot, "redis_client", fake)
    user_id = uuid.uuid4()

    code, expires_at = await line_bot.create_link_code(user_id)

    raw = await fake.get(f"line:link:{code}")
    assert raw is not None
    assert json.loads(raw)["user_id"] == str(user_id)
    assert expires_at.tzinfo is not None


@pytest.mark.asyncio
async def test_bind_line_user_replaces_previous_links(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = FakeRedis()
    monkeypatch.setattr(line_bot, "redis_client", fake)
    user_a = User(email="a@example.com", display_name="A", is_active=True)
    user_b = User(email="b@example.com", display_name="B", is_active=True)
    db_session.add_all([user_a, user_b])
    await db_session.flush()

    await fake.set(
        "line:link:111111",
        json.dumps({"user_id": str(user_a.id)}),
        ex=600,
        nx=True,
    )
    await line_bot._bind_line_user(  # noqa: SLF001
        db_session,
        line_user_id="U123",
        code="111111",
    )
    await fake.set(
        "line:link:222222",
        json.dumps({"user_id": str(user_b.id)}),
        ex=600,
        nx=True,
    )
    await line_bot._bind_line_user(  # noqa: SLF001
        db_session,
        line_user_id="U123",
        code="222222",
    )

    rows = (await db_session.execute(select(LineAccountLink))).scalars().all()
    assert len(rows) == 1
    assert rows[0].user_id == user_b.id
    assert rows[0].line_user_id == "U123"
    assert rows[0].is_active is True
