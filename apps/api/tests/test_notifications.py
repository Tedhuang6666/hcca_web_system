"""通知路由測試 — 收件匣、偏好設定（channel / digest / 靜音模組）、Web Push、退訂連結。"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies.auth import get_current_active_user
from api.email.renderer import make_unsubscribe_token
from api.main import app
from api.models.notification import Notification
from api.models.user import User
from api.models.web_push import WebPushSubscription


def _override_user(user: User) -> None:
    async def override() -> User:
        return user

    app.dependency_overrides[get_current_active_user] = override


async def _seed_user(db: AsyncSession, email: str, **overrides: object) -> User:
    defaults: dict[str, object] = {
        "email": email,
        "display_name": "測試使用者",
        "is_active": True,
        "is_verified": True,
    }
    defaults.update(overrides)
    user = User(**defaults)
    db.add(user)
    await db.flush()
    return user


@pytest.mark.asyncio
async def test_list_notifications_without_auth_returns_401(client: AsyncClient) -> None:
    resp = await client.get("/notifications/inbox")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_list_notifications_returns_only_own(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "inbox-owner@school.edu")
    other = await _seed_user(db_session, "inbox-other@school.edu")
    db_session.add_all(
        [
            Notification(user_id=user.id, type="system", title="我的通知"),
            Notification(user_id=other.id, type="system", title="別人的通知"),
        ]
    )
    await db_session.flush()
    _override_user(user)

    resp = await client.get("/notifications/inbox")

    assert resp.status_code == 200
    assert [item["title"] for item in resp.json()] == ["我的通知"]


@pytest.mark.asyncio
async def test_list_notifications_unread_only_filters(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "unread-filter@school.edu")
    db_session.add_all(
        [
            Notification(user_id=user.id, type="system", title="已讀", is_read=True),
            Notification(user_id=user.id, type="system", title="未讀", is_read=False),
        ]
    )
    await db_session.flush()
    _override_user(user)

    resp = await client.get("/notifications/inbox", params={"unread_only": True})

    assert resp.status_code == 200
    assert [item["title"] for item in resp.json()] == ["未讀"]


@pytest.mark.asyncio
async def test_count_notifications_returns_unread_and_total(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "count-user@school.edu")
    db_session.add_all(
        [
            Notification(user_id=user.id, type="system", title="a", is_read=True),
            Notification(user_id=user.id, type="system", title="b", is_read=False),
            Notification(user_id=user.id, type="system", title="c", is_read=False),
        ]
    )
    await db_session.flush()
    _override_user(user)

    resp = await client.get("/notifications/inbox/count")

    assert resp.status_code == 200
    assert resp.json() == {"unread": 2, "total": 3}


@pytest.mark.asyncio
async def test_mark_read_updates_single_notification(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "mark-read@school.edu")
    n = Notification(user_id=user.id, type="system", title="待標記")
    db_session.add(n)
    await db_session.flush()
    _override_user(user)

    resp = await client.patch(f"/notifications/inbox/{n.id}/read")

    assert resp.status_code == 200
    assert resp.json()["is_read"] is True


@pytest.mark.asyncio
async def test_mark_read_missing_or_others_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "mark-read-404@school.edu")
    _override_user(user)

    resp = await client.patch(f"/notifications/inbox/{uuid.uuid4()}/read")

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_mark_all_read_marks_only_own_unread(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "mark-all@school.edu")
    other = await _seed_user(db_session, "mark-all-other@school.edu")
    db_session.add_all(
        [
            Notification(user_id=user.id, type="system", title="a", is_read=False),
            Notification(user_id=user.id, type="system", title="b", is_read=False),
            Notification(user_id=other.id, type="system", title="c", is_read=False),
        ]
    )
    await db_session.flush()
    _override_user(user)

    resp = await client.post("/notifications/inbox/read-all")

    assert resp.status_code == 200
    assert resp.json() == {"marked_read": 2}


@pytest.mark.asyncio
async def test_get_preferences_returns_defaults(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "prefs-get@school.edu")
    _override_user(user)

    resp = await client.get("/notifications/preferences")

    assert resp.status_code == 200
    assert resp.json()["document_pending"]["email"] is True


@pytest.mark.asyncio
async def test_update_preferences_persists_channel_choice(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "prefs-put@school.edu")
    _override_user(user)

    resp = await client.put(
        "/notifications/preferences",
        json={"system": {"inapp": False, "email": True, "line": False, "discord": False}},
    )

    assert resp.status_code == 200
    assert resp.json()["system"] == {
        "inapp": False,
        "email": True,
        "line": False,
        "discord": False,
    }


@pytest.mark.asyncio
async def test_get_digest_preference_defaults_to_off(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "digest-get@school.edu")
    _override_user(user)

    resp = await client.get("/notifications/preferences/digest")

    assert resp.status_code == 200
    assert resp.json()["frequency"] == "off"


@pytest.mark.asyncio
async def test_update_digest_preference_invalid_value_returns_400(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "digest-invalid@school.edu")
    _override_user(user)

    resp = await client.put("/notifications/preferences/digest", json={"frequency": "hourly"})

    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_update_digest_preference_succeeds(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "digest-valid@school.edu")
    _override_user(user)

    resp = await client.put("/notifications/preferences/digest", json={"frequency": "weekly"})

    assert resp.status_code == 200
    assert resp.json()["frequency"] == "weekly"


@pytest.mark.asyncio
async def test_get_muted_modules_defaults_empty(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "muted-get@school.edu")
    _override_user(user)

    resp = await client.get("/notifications/preferences/muted-modules")

    assert resp.status_code == 200
    assert resp.json()["muted_modules"] == []
    assert "email" in resp.json()["available_modules"] or resp.json()["available_modules"]


@pytest.mark.asyncio
async def test_update_muted_modules_rejects_unknown_module(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "muted-invalid@school.edu")
    _override_user(user)

    resp = await client.put(
        "/notifications/preferences/muted-modules",
        json={"muted_modules": ["not-a-real-module"]},
    )

    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_update_muted_modules_succeeds(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _seed_user(db_session, "muted-valid@school.edu")
    _override_user(user)
    known = await client.get("/notifications/preferences/muted-modules")
    module_code = next(iter(known.json()["available_modules"]))

    resp = await client.put(
        "/notifications/preferences/muted-modules",
        json={"muted_modules": [module_code]},
    )

    assert resp.status_code == 200
    assert resp.json()["muted_modules"] == [module_code]


@pytest.mark.asyncio
async def test_web_push_config_reports_disabled_without_vapid_keys(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """本機 .env 可能已設定 VAPID 金鑰，測試需明確清空以確保結果與環境無關。"""
    monkeypatch.setattr("api.services.web_push.settings.VAPID_PUBLIC_KEY", "")
    monkeypatch.setattr("api.services.web_push.settings.VAPID_PRIVATE_KEY", "")
    user = await _seed_user(db_session, "webpush-config@school.edu")
    _override_user(user)

    resp = await client.get("/notifications/web-push/config")

    assert resp.status_code == 200
    assert resp.json()["enabled"] is False


@pytest.mark.asyncio
async def test_save_and_list_web_push_subscription(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "webpush-save@school.edu")
    _override_user(user)

    created = await client.post(
        "/notifications/web-push/subscriptions",
        json={
            "endpoint": "https://push.example.org/abc",
            "keys": {"p256dh": "pkey", "auth": "akey"},
            "device_label": "我的手機",
        },
    )
    assert created.status_code == 200
    assert created.json()["device_label"] == "我的手機"

    listed = await client.get("/notifications/web-push/subscriptions")
    assert listed.status_code == 200
    assert len(listed.json()) == 1


@pytest.mark.asyncio
async def test_delete_web_push_subscription_missing_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "webpush-delete-404@school.edu")
    _override_user(user)

    resp = await client.delete(f"/notifications/web-push/subscriptions/{uuid.uuid4()}")

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_web_push_subscription_deactivates_own(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "webpush-delete@school.edu")
    sub = WebPushSubscription(
        user_id=user.id,
        endpoint="https://push.example.org/xyz",
        p256dh="p",
        auth="a",
    )
    db_session.add(sub)
    await db_session.flush()
    _override_user(user)

    resp = await client.delete(f"/notifications/web-push/subscriptions/{sub.id}")

    assert resp.status_code == 200
    await db_session.refresh(sub)
    assert sub.is_active is False


@pytest.mark.asyncio
async def test_web_push_test_returns_zero_sent_when_disabled(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """未設定 VAPID 金鑰時 send_to_user 直接短路回傳 0，不應嘗試真的呼叫瀏覽器推播服務。"""
    monkeypatch.setattr("api.services.web_push.settings.VAPID_PUBLIC_KEY", "")
    monkeypatch.setattr("api.services.web_push.settings.VAPID_PRIVATE_KEY", "")
    user = await _seed_user(db_session, "webpush-test@school.edu")
    _override_user(user)

    resp = await client.post("/notifications/web-push/test")

    assert resp.status_code == 200
    assert resp.json() == {"sent": 0}


@pytest.mark.asyncio
async def test_unsubscribe_via_token_disables_email_channel(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "unsub-target@school.edu")
    await db_session.flush()
    token = make_unsubscribe_token(user.id, "announcement")

    resp = await client.post("/notifications/unsubscribe", json={"token": token})

    assert resp.status_code == 200
    assert resp.json()["type"] == "announcement"
    await db_session.refresh(user)
    assert user.notification_preferences["announcement"]["email"] is False


@pytest.mark.asyncio
async def test_unsubscribe_via_invalid_token_returns_400(client: AsyncClient) -> None:
    resp = await client.post("/notifications/unsubscribe", json={"token": "not-a-real-token"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_send_email_notification_without_admin_permission_returns_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "email-notify-403@school.edu")
    _override_user(user)

    resp = await client.post(
        "/notifications/email",
        json={"to": ["target@example.org"], "subject": "s", "body": "b"},
    )

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_send_email_notification_as_superuser_queues_task(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin = await _seed_user(db_session, "email-notify-admin@school.edu", is_superuser=True)
    _override_user(admin)
    monkeypatch.setattr("api.routers.notifications.enqueue_email", lambda **kwargs: "fake-task-id")

    resp = await client.post(
        "/notifications/email",
        json={"to": ["target@example.org"], "subject": "s", "body": "b"},
    )

    assert resp.status_code == 200
    assert resp.json()["task_id"] == "fake-task-id"


@pytest.mark.asyncio
async def test_get_task_status_without_admin_permission_returns_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "task-status-403@school.edu")
    _override_user(user)

    resp = await client.get("/notifications/tasks/some-task-id")

    assert resp.status_code == 403
