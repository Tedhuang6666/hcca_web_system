"""Web Push 真實訂閱資料與外部傳送 adapter 的重試契約。"""

from __future__ import annotations

import threading
import uuid
from types import SimpleNamespace

import pytest
from pywebpush import WebPushException
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.user import User
from api.models.web_push import WebPushSubscription
from api.services import web_push


async def _subscriptions(db: AsyncSession, count: int) -> list[WebPushSubscription]:
    user = User(email=f"push-{uuid.uuid4().hex}@school.edu", display_name="推播測試")
    db.add(user)
    await db.flush()
    subscriptions = [
        WebPushSubscription(
            user_id=user.id,
            endpoint=f"https://push.example.test/{index}",
            p256dh="test-public-key",
            auth="test-auth",
        )
        for index in range(count)
    ]
    db.add_all(subscriptions)
    await db.flush()
    return subscriptions


@pytest.fixture(autouse=True)
def enable_test_push(monkeypatch):
    monkeypatch.setattr(web_push, "web_push_enabled", lambda: True)
    monkeypatch.setattr(web_push.settings, "VAPID_PRIVATE_KEY", "test-private-key")
    monkeypatch.setattr(web_push.settings, "VAPID_SUBJECT", "mailto:push@example.test")


async def test_push_transport_runs_outside_event_loop(db_session, monkeypatch):
    subscriptions = await _subscriptions(db_session, 1)
    loop_thread = threading.get_ident()
    delivery_threads = []

    def deliver(**kwargs):
        delivery_threads.append(threading.get_ident())
        assert kwargs["subscription_info"]["endpoint"] == subscriptions[0].endpoint
        assert '"title": "測試"' in kwargs["data"]

    monkeypatch.setattr("pywebpush.webpush", deliver)
    assert await web_push.send_to_user(db_session, subscriptions[0].user_id, {"title": "測試"}) == 1
    assert delivery_threads and all(value != loop_thread for value in delivery_threads)
    await db_session.refresh(subscriptions[0])
    assert subscriptions[0].last_used_at is not None


@pytest.mark.parametrize("status_code", [404, 410])
async def test_expired_push_subscription_is_disabled(db_session, monkeypatch, status_code):
    subscriptions = await _subscriptions(db_session, 1)

    def expired(**kwargs):
        raise WebPushException("expired", response=SimpleNamespace(status_code=status_code))

    monkeypatch.setattr("pywebpush.webpush", expired)
    assert await web_push.send_to_user(db_session, subscriptions[0].user_id, {}) == 0
    await db_session.refresh(subscriptions[0])
    assert subscriptions[0].is_active is False
    assert subscriptions[0].last_used_at is None


@pytest.mark.parametrize("failure", ["provider", "network"])
async def test_temporary_push_failure_reaches_retry_after_trying_other_devices(
    db_session, monkeypatch, failure
):
    subscriptions = await _subscriptions(db_session, 2)
    attempted = []
    error = (
        WebPushException("temporary", response=SimpleNamespace(status_code=503))
        if failure == "provider"
        else OSError("network unavailable")
    )

    def deliver(**kwargs):
        endpoint = kwargs["subscription_info"]["endpoint"]
        attempted.append(endpoint)
        if endpoint == subscriptions[0].endpoint:
            raise error

    monkeypatch.setattr("pywebpush.webpush", deliver)
    with pytest.raises(type(error)) as captured:
        await web_push.send_to_user(db_session, subscriptions[0].user_id, {})
    assert captured.value is error
    assert set(attempted) == {subscription.endpoint for subscription in subscriptions}
    for subscription in subscriptions:
        await db_session.refresh(subscription)
        assert subscription.is_active is True
    assert subscriptions[0].last_used_at is None
    assert subscriptions[1].last_used_at is not None
