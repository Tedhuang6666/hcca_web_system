"""名冊學生姓名須跨首次登入、再次登入及人員同步保留。"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.models.org import UserPosition
from api.models.person import Person
from api.models.user import User
from api.models.user_identity import UserIdentity
from api.services import person as person_svc


async def test_first_google_login_uses_recorded_name_and_repeat_oauth_preserves_it(
    db_session: AsyncSession, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import api.routers.auth as auth_module

    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "test-roster-client")
    person = Person(
        student_id="510001",
        email="g0510001@hchs.hc.edu.tw",
        display_name="名冊姓名",
        legal_name="名冊姓名",
    )
    db_session.add(person)
    await db_session.flush()
    names = ["Google 帳號暱稱", "再次改過的 Google 暱稱"]

    def google_info(name: str) -> dict[str, Any]:
        return {
            "sub": "roster-school-sub",
            "email": person.email,
            "email_verified": True,
            "name": name,
        }

    monkeypatch.setattr(
        auth_module.google_id_token,
        "verify_oauth2_token",
        lambda *args, **kwargs: google_info(names[0]),
    )
    first = await client.post("/auth/google/one-tap", json={"credential": "test-token"})
    assert first.status_code == 200
    assert first.json()["user"]["display_name"] == "名冊姓名"
    await db_session.refresh(person)
    user_id = person.user_id
    assert user_id is not None
    user = await db_session.get(User, user_id)
    assert (user.display_name, person.display_name, person.legal_name) == ("名冊姓名",) * 3

    async def authorize(*args, **kwargs):
        return {"userinfo": google_info(names[1])}

    monkeypatch.setattr(auth_module.google, "authorize_access_token", authorize)
    repeat = await client.get(
        "/auth/google/callback?code=test-code&state=test-state", follow_redirects=False
    )
    assert repeat.status_code == 307
    assert "/auth/callback" in repeat.headers["location"]
    await db_session.refresh(user)
    await db_session.refresh(person)
    assert user.id == user_id and person.user_id == user_id
    assert (user.display_name, person.display_name, person.legal_name) == ("名冊姓名",) * 3
    identity = await db_session.scalar(select(UserIdentity).where(UserIdentity.user_id == user_id))
    # 原始供應者快照可隨 Google 更新，但不能成為平台人員姓名。
    assert identity.display_name == names[1]
    assert await db_session.scalar(select(func.count()).select_from(User)) == 1
    assert await db_session.scalar(select(func.count()).select_from(UserPosition)) == 0


async def test_existing_account_with_linked_person_without_account_student_id_uses_roster_name(
    db_session: AsyncSession,
) -> None:
    user = User(email="linked@example.com", display_name="Google 暱稱")
    db_session.add(user)
    await db_session.flush()
    person = Person(
        user_id=user.id, student_id="510001", display_name="舊姓名", legal_name="名冊姓名"
    )
    db_session.add(person)
    await db_session.flush()
    assert await person_svc.ensure_person_for_user(db_session, user) is person
    assert (user.display_name, person.display_name, user.student_id) == (
        "名冊姓名",
        "名冊姓名",
        None,
    )


async def test_existing_account_and_people_sync_restore_confirmed_name(
    db_session: AsyncSession,
) -> None:
    user = User(email="g0510001@hchs.hc.edu.tw", student_id="510001", display_name="Google 暱稱")
    db_session.add(user)
    await db_session.flush()
    person = Person(
        user_id=user.id,
        student_id=user.student_id,
        display_name="舊人員姓名",
        legal_name="名冊姓名",
    )
    db_session.add(person)
    await db_session.flush()
    await person_svc.ensure_person_for_user(db_session, user)
    assert (user.display_name, person.display_name) == ("名冊姓名", "名冊姓名")
    user.display_name = "另一個中文暱稱"
    person.display_name = "另一個舊姓名"
    await db_session.flush()
    await person_svc.sync_people_from_existing_data(db_session)
    assert (user.display_name, person.display_name, person.legal_name) == ("名冊姓名",) * 3
    assert await db_session.scalar(select(func.count()).select_from(UserPosition)) == 0


@pytest.mark.parametrize("legal_name", [None, "", "   "])
async def test_unconfirmed_name_does_not_replace_account_name(
    db_session: AsyncSession,
    legal_name: str | None,
) -> None:
    user = User(email="g0510001@hchs.hc.edu.tw", student_id="510001", display_name="既有姓名")
    db_session.add(user)
    await db_session.flush()
    person = Person(
        user_id=user.id,
        student_id=user.student_id,
        display_name="待核對人員姓名",
        legal_name=legal_name,
    )
    db_session.add(person)
    await db_session.flush()
    await person_svc.ensure_person_for_user(db_session, user)
    assert user.display_name == "既有姓名"
    assert person.display_name == "待核對人員姓名"


async def test_roster_name_cannot_be_applied_to_another_users_account(
    db_session: AsyncSession,
) -> None:
    owner = User(email="owner@example.com", display_name="本人姓名")
    other = User(email="other@example.com", student_id="510001", display_name="另一人")
    db_session.add_all([owner, other])
    await db_session.flush()
    person = Person(
        user_id=owner.id,
        student_id="510001",
        display_name="本人姓名",
        legal_name="名冊姓名",
        email=owner.email,
    )
    db_session.add(person)
    await db_session.flush()
    await person_svc.ensure_person_for_user(db_session, other)
    assert (owner.display_name, other.display_name, person.display_name) == (
        "本人姓名",
        "另一人",
        "本人姓名",
    )
    assert person.user_id == owner.id


async def test_non_student_legal_name_does_not_force_display_name(db_session: AsyncSession) -> None:
    user = User(email="staff@example.com", display_name="職員顯示名稱")
    db_session.add(user)
    await db_session.flush()
    person = Person(user_id=user.id, display_name=user.display_name, legal_name="職員本名")
    db_session.add(person)
    await db_session.flush()
    await person_svc.ensure_person_for_user(db_session, user)
    assert user.display_name == person.display_name == "職員顯示名稱"


async def test_chinese_name_order_uses_roster_instead_of_google_order(
    db_session: AsyncSession,
) -> None:
    user = User(email="g0510001@hchs.hc.edu.tw", student_id="510001", display_name="小明王")
    db_session.add(user)
    await db_session.flush()
    person = Person(
        user_id=user.id, student_id=user.student_id, display_name="小明王", legal_name="王小明"
    )
    db_session.add(person)
    await db_session.flush()
    await person_svc.ensure_person_for_user(db_session, user)
    assert user.display_name == person.display_name == "王小明"


async def test_linked_person_with_different_student_id_is_not_a_name_source(
    db_session: AsyncSession,
) -> None:
    user = User(email="g0510001@hchs.hc.edu.tw", student_id="510001", display_name="帳號姓名")
    db_session.add(user)
    await db_session.flush()
    person = Person(
        user_id=user.id, student_id="510002", display_name="人員姓名", legal_name="另一學號姓名"
    )
    db_session.add(person)
    await db_session.flush()
    await person_svc.ensure_person_for_user(db_session, user)
    assert user.display_name == "帳號姓名" and person.display_name == "人員姓名"
    assert (user.student_id, person.student_id) == ("510001", "510002")
