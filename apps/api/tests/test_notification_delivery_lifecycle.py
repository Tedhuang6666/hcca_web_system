"""通知提交／傳遞生命週期：獨立 PostgreSQL 連線驗證真正的提交可見性。"""

from __future__ import annotations

import asyncio
import os
import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
import pytest_asyncio
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from api.core import database as database_core
from api.core.database import Base
from api.models.notification import Notification
from api.models.outbox import OutboxEvent, OutboxStatus
from api.models.user import User
from api.services import digest_tasks, notification, notification_tasks, outbox, outbox_tasks

pytestmark = pytest.mark.asyncio
_TYPE = "petition_updated"


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def delivery_sessions():
    url = os.environ.get("TEST_DATABASE_URL", "")
    if not url.startswith("postgresql+asyncpg://"):
        pytest.skip("提交可見性測試需要獨立連線的 PostgreSQL 測試資料庫")
    # 不使用 db_session 的外層交易／SAVEPOINT；另一個連線須真的能讀到 commit。
    # 獨立 schema 也避免本檔已提交資料干擾其他測試的全表查詢。
    schema = f"test_notification_delivery_{uuid.uuid4().hex}"
    engine = create_async_engine(
        url, poolclass=NullPool, connect_args={"server_settings": {"search_path": schema}}
    )
    async with engine.begin() as connection:
        await connection.execute(text("SELECT pg_advisory_xact_lock(947210001)"))
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        await connection.run_sync(Base.metadata.create_all)
    try:
        yield async_sessionmaker(engine, expire_on_commit=False)
    finally:
        async with engine.begin() as connection:
            await connection.execute(text("SELECT pg_advisory_xact_lock(947210001)"))
            await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await engine.dispose()


@pytest_asyncio.fixture(autouse=True)
async def isolate_delivery_rows(delivery_sessions):
    yield
    async with delivery_sessions.begin() as session:
        await session.execute(delete(OutboxEvent))
        await session.execute(delete(Notification))
        await session.execute(delete(User))


@pytest.fixture(autouse=True)
def transports(monkeypatch):
    adapters = SimpleNamespace(websocket=AsyncMock(), push=AsyncMock(return_value=0), batch=Mock())
    monkeypatch.setattr(notification, "publish_room_from_worker", adapters.websocket)
    monkeypatch.setattr(notification, "send_to_user", adapters.push)
    monkeypatch.setattr(notification.send_notification_email_batch, "apply_async", adapters.batch)
    return adapters


@pytest_asyncio.fixture
async def fastkick(monkeypatch):
    enqueue = AsyncMock()
    monkeypatch.setattr(outbox, "_enqueue_after_commit", enqueue)
    yield enqueue
    await asyncio.sleep(0)


def _preferences(*, inapp=True, email=True, digest="off"):
    return {
        _TYPE: {"inapp": inapp, "email": email, "line": False, "discord": False},
        "__digest_frequency": digest,
    }


async def _user(factory, *, preferences=None):
    async with factory.begin() as session:
        user = User(
            email=f"lifecycle-{uuid.uuid4().hex}@school.edu",
            display_name="生命週期測試",
            is_active=True,
            notification_preferences=preferences or _preferences(),
        )
        session.add(user)
        await session.flush()
        return user.id


async def _create(factory, user_id, *, title="生命週期通知", email_allowed=True):
    async with factory.begin() as session:
        await notification.create_notification(
            session,
            user_id=user_id,
            type=_TYPE,
            title=title,
            body=title,
            email_allowed=email_allowed,
        )


async def _events(factory):
    async with factory() as reader:
        return list(await reader.scalars(select(OutboxEvent).order_by(OutboxEvent.created_at)))


async def test_rollback_discards_intents_without_external_io(
    delivery_sessions, fastkick, transports
):
    user_id = await _user(delivery_sessions)
    async with delivery_sessions() as session:
        await notification.create_notification(
            session, user_id=user_id, type=_TYPE, title="應回滾的通知"
        )
        assert not fastkick.called
        transports.websocket.assert_not_awaited()
        transports.push.assert_not_awaited()
        transports.batch.assert_not_called()
        await session.rollback()
        # 同一 Session 的下一次成功交易不可沿用已回滾的通知標記。
        await session.execute(text("SELECT 1"))
        await session.commit()
    await asyncio.sleep(0)

    fastkick.assert_not_awaited()
    assert await _events(delivery_sessions) == []
    async with delivery_sessions() as reader:
        assert await reader.scalar(select(Notification.id)) is None


async def test_commit_publishes_readable_intents_and_kicks_once(
    delivery_sessions, monkeypatch, transports
):
    user_id = await _user(delivery_sessions)
    observed = []
    kicked = asyncio.Event()

    async def enqueue():
        # 以不同連線模擬 worker，不能沿用產生通知的 Session。
        async with delivery_sessions() as reader:
            observed.append(
                (
                    len(list(await reader.scalars(select(Notification.id)))),
                    len(list(await reader.scalars(select(OutboxEvent.id)))),
                )
            )
        kicked.set()

    monkeypatch.setattr(outbox, "_enqueue_after_commit", enqueue)
    async with delivery_sessions() as session:
        for title in ("同交易通知一", "同交易通知二"):
            await notification.create_notification(
                session, user_id=user_id, type=_TYPE, title=title
            )
        assert observed == []
        await session.commit()
    await asyncio.wait_for(kicked.wait(), timeout=5)
    await asyncio.sleep(0)

    assert observed == [(2, 6)]
    assert not outbox._after_commit_tasks
    assert {event.event_type for event in await _events(delivery_sessions)} == {
        "notification.websocket",
        "notification.web_push",
        "notification.email_batch",
    }
    transports.websocket.assert_not_awaited()
    transports.push.assert_not_awaited()
    transports.batch.assert_not_called()


async def test_nested_savepoint_waits_for_root_commit(delivery_sessions, fastkick):
    user_id = await _user(delivery_sessions)
    async with delivery_sessions.begin() as session:
        async with session.begin_nested():
            await notification.create_notification(
                session, user_id=user_id, type=_TYPE, title="SAVEPOINT 中的通知"
            )
        await asyncio.sleep(0)
        fastkick.assert_not_awaited()
        assert await _events(delivery_sessions) == []
    await asyncio.sleep(0)

    fastkick.assert_awaited_once()
    assert len(await _events(delivery_sessions)) == 3


async def test_nested_rollback_keeps_outer_intent_without_delivering_inner(
    delivery_sessions, fastkick
):
    user_id = await _user(delivery_sessions)
    async with delivery_sessions.begin() as session:
        await notification.create_notification(
            session, user_id=user_id, type=_TYPE, title="外層通知"
        )
        nested = await session.begin_nested()
        await notification.create_notification(
            session, user_id=user_id, type=_TYPE, title="內層回滾通知"
        )
        await nested.rollback()
    await asyncio.sleep(0)

    fastkick.assert_awaited_once()
    async with delivery_sessions() as reader:
        assert list(await reader.scalars(select(Notification.title))) == ["外層通知"]
    assert len(await _events(delivery_sessions)) == 3


async def test_external_transaction_session_commit_is_only_a_savepoint(delivery_sessions, fastkick):
    user_id = await _user(delivery_sessions)
    engine = delivery_sessions.kw["bind"]
    async with engine.connect() as connection:
        transaction = await connection.begin()
        async with AsyncSession(
            bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False
        ) as session:
            await notification.create_notification(
                session, user_id=user_id, type=_TYPE, title="外部交易中的通知"
            )
            await session.commit()
        await asyncio.sleep(0)
        fastkick.assert_not_awaited()
        assert await _events(delivery_sessions) == []
        await transaction.commit()

    # 外部 Connection 自行提交沒有 Session hook；已提交 intent 由週期掃描恢復。
    fastkick.assert_not_awaited()
    assert len(await _events(delivery_sessions)) == 3


async def test_broker_failure_keeps_committed_events_pending(delivery_sessions, monkeypatch):
    enqueue = outbox._enqueue_after_commit
    monkeypatch.setattr(outbox, "_enqueue_after_commit", AsyncMock())
    broker = Mock(side_effect=OSError("test broker unavailable"))
    monkeypatch.setattr(outbox_tasks.process_outbox, "delay", broker)
    user_id = await _user(delivery_sessions)
    await _create(delivery_sessions, user_id)
    await asyncio.sleep(0)

    await enqueue()

    broker.assert_called_once()
    events = await _events(delivery_sessions)
    assert len(events) == 3
    assert all(event.status == OutboxStatus.PENDING for event in events)


async def test_email_batch_dispatch_preserves_five_minute_countdown(
    delivery_sessions, fastkick, transports
):
    user_id = await _user(delivery_sessions, preferences=_preferences(inapp=False))
    await _create(delivery_sessions, user_id)
    events = await _events(delivery_sessions)
    assert [event.event_type for event in events] == ["notification.email_batch"]

    async with delivery_sessions() as worker:
        await outbox._dispatch(worker, events[0])

    transports.batch.assert_called_once_with(args=[str(user_id), _TYPE], countdown=300)
    transports.websocket.assert_not_awaited()
    transports.push.assert_not_awaited()


@pytest.mark.parametrize("change", ["email_disabled", "daily_digest", "inactive"])
async def test_email_delivery_rechecks_current_recipient_state(
    delivery_sessions, fastkick, transports, change
):
    user_id = await _user(delivery_sessions, preferences=_preferences(inapp=False))
    await _create(delivery_sessions, user_id)
    events = await _events(delivery_sessions)
    async with delivery_sessions.begin() as session:
        user = await session.get(User, user_id)
        if change == "inactive":
            user.is_active = False
        else:
            user.notification_preferences = _preferences(
                inapp=False,
                email=change != "email_disabled",
                digest="daily" if change == "daily_digest" else "off",
            )
    async with delivery_sessions() as worker:
        await outbox._dispatch(worker, events[0])

    transports.batch.assert_not_called()


@pytest.mark.parametrize("change", ["inapp_disabled", "inactive"])
async def test_inapp_delivery_rechecks_current_recipient_state(
    delivery_sessions, fastkick, transports, change
):
    user_id = await _user(delivery_sessions, preferences=_preferences(email=False))
    await _create(delivery_sessions, user_id)
    events = await _events(delivery_sessions)
    assert {event.event_type for event in events} == {
        "notification.websocket",
        "notification.web_push",
    }
    async with delivery_sessions.begin() as session:
        user = await session.get(User, user_id)
        if change == "inactive":
            user.is_active = False
        else:
            user.notification_preferences = _preferences(inapp=False, email=False)
    async with delivery_sessions() as worker:
        for event in events:
            await outbox._dispatch(worker, event)

    transports.websocket.assert_not_awaited()
    transports.push.assert_not_awaited()


async def test_failed_websocket_does_not_block_push_or_email_intents(
    delivery_sessions, fastkick, transports, monkeypatch
):
    user_id = await _user(delivery_sessions)
    await _create(delivery_sessions, user_id)
    transports.websocket.side_effect = OSError("test websocket unavailable")

    @asynccontextmanager
    async def task_session():
        async with delivery_sessions() as session:
            yield session

    monkeypatch.setattr(database_core, "task_session", task_session)

    await outbox.process_pending_outbox()

    events = {event.event_type: event for event in await _events(delivery_sessions)}
    websocket = events["notification.websocket"]
    assert websocket.status == OutboxStatus.PENDING
    assert websocket.retry_count == 1 and websocket.next_attempt_at is not None
    assert events["notification.web_push"].status == OutboxStatus.PROCESSED
    assert events["notification.email_batch"].status == OutboxStatus.PROCESSED
    transports.push.assert_awaited_once()
    transports.batch.assert_called_once()


async def test_digest_email_only_notification_is_hidden_and_not_immediately_scheduled(
    delivery_sessions, fastkick, transports
):
    user_id = await _user(delivery_sessions, preferences=_preferences(inapp=False, digest="daily"))
    await _create(delivery_sessions, user_id)

    assert await _events(delivery_sessions) == []
    async with delivery_sessions() as reader:
        row = await reader.scalar(select(Notification))
        assert row is not None and not row.is_inapp_visible
        assert row.email_queued_at is None
        payload = {"notification_id": str(row.id)}
    # 即使有舊 intent，也不能推送本來就只供摘要使用的隱藏通知。
    async with delivery_sessions() as worker:
        for event_type in ("notification.websocket", "notification.web_push"):
            await notification.deliver_notification(worker, event_type, payload)
    transports.websocket.assert_not_awaited()
    transports.push.assert_not_awaited()
    transports.batch.assert_not_called()


@pytest.mark.parametrize("notification_id", [str(uuid.uuid4()), "invalid-id"])
async def test_missing_notification_is_skipped(
    delivery_sessions, fastkick, transports, notification_id
):
    async with delivery_sessions() as worker:
        for event_type in (
            "notification.websocket",
            "notification.web_push",
            "notification.email_batch",
        ):
            await notification.deliver_notification(
                worker, event_type, {"notification_id": notification_id}
            )

    transports.websocket.assert_not_awaited()
    transports.push.assert_not_awaited()
    transports.batch.assert_not_called()


@pytest.mark.parametrize("digest", ["off", "daily"])
async def test_email_disallowed_row_is_excluded_from_shared_batch_or_digest(
    delivery_sessions, fastkick, monkeypatch, digest
):
    user_id = await _user(delivery_sessions, preferences=_preferences(digest=digest))
    await _create(delivery_sessions, user_id, title="允許寄出的通知")
    await _create(delivery_sessions, user_id, title="禁止寄出的通知", email_allowed=False)

    @asynccontextmanager
    async def task_session():
        async with delivery_sessions() as session:
            yield session

    async with delivery_sessions() as reader:
        rows = {row.title: row for row in await reader.scalars(select(Notification))}
        assert rows["允許寄出的通知"].email_queued_at is None
        assert rows["禁止寄出的通知"].email_queued_at is not None

    if digest == "off":
        sender = Mock()
        monkeypatch.setattr(notification_tasks, "task_session", task_session)
        monkeypatch.setattr(notification_tasks, "send_branded_email", sender)
        result = await notification_tasks._send_notification_batch(user_id, _TYPE)
        assert result == {"sent": 1, "notifications": 1}
        content = sender.call_args.kwargs["context"]["body_text"]
    else:
        sender = Mock()
        monkeypatch.setattr(digest_tasks, "task_session", task_session)
        monkeypatch.setattr(digest_tasks, "enqueue_email", sender)
        await digest_tasks._process_digest("daily", 24)
        sender.assert_called_once()
        content = sender.call_args.kwargs["body"]
    assert "允許寄出的通知" in content
    assert "禁止寄出的通知" not in content
