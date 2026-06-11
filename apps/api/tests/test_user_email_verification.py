"""使用者自助連結 Email 驗證流程。"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies.auth import get_current_active_user
from api.main import app
from api.models.user import User
from api.models.user_identity import UserIdentity
from api.services import user_email_verification as verification_svc


class FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def set(
        self,
        key: str,
        value: str,
        *,
        ex: int | None = None,
        nx: bool = False,
    ) -> bool:
        if nx and key in self.store:
            return False
        self.store[key] = value
        return True

    async def setex(self, key: str, _ttl: int, value: str) -> None:
        self.store[key] = value

    async def get(self, key: str) -> str | None:
        return self.store.get(key)

    async def delete(self, key: str) -> None:
        self.store.pop(key, None)


def _override_user(user: User) -> None:
    async def override() -> User:
        return user

    app.dependency_overrides[get_current_active_user] = override


@pytest.mark.asyncio
async def test_user_verifies_email_before_it_is_linked(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = User(
        email="primary@hchs.hc.edu.tw",
        display_name="自助綁定",
        is_active=True,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    _override_user(user)

    fake_redis = FakeRedis()
    sent_to: list[str] = []
    monkeypatch.setattr(verification_svc, "redis_client", fake_redis)
    monkeypatch.setattr(verification_svc.secrets, "randbelow", lambda _limit: 123456)
    monkeypatch.setattr(
        verification_svc,
        "send_branded_email",
        lambda recipients, *_args, **_kwargs: sent_to.extend(recipients) or ["task-id"],
    )

    request_response = await client.post(
        "/users/me/emails/verification",
        json={"email": "private@gmail.com"},
    )

    assert request_response.status_code == 202
    assert sent_to == ["private@gmail.com"]
    assert (
        await db_session.scalar(
            select(UserIdentity).where(UserIdentity.email == "private@gmail.com")
        )
        is None
    )

    wrong_response = await client.post(
        "/users/me/emails/verify",
        json={"email": "private@gmail.com", "code": "000000"},
    )
    assert wrong_response.status_code == 400

    verify_response = await client.post(
        "/users/me/emails/verify",
        json={"email": "private@gmail.com", "code": "123456"},
    )

    assert verify_response.status_code == 200
    assert verify_response.json()["emails"] == [
        "primary@hchs.hc.edu.tw",
        "private@gmail.com",
    ]
    identity = await db_session.scalar(
        select(UserIdentity).where(UserIdentity.email == "private@gmail.com")
    )
    assert identity is not None
    assert identity.user_id == user.id
