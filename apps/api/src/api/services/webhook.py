"""Webhook 訂閱與投遞業務邏輯。Phase D2。

實作層次：
- subscription CRUD + secret 一次性產生
- 投遞排程（建立 WebhookDelivery row、由 Celery 拉去送）
- HMAC-SHA256 簽章
- 重試 backoff 計算

實際 HTTP 投遞由 Celery task 執行（apps/api/src/api/services/webhook_tasks.py 之後補）。
本檔提供同步可測的核心邏輯。
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import desc, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.webhook import DeliveryStatus, WebhookDelivery, WebhookSubscription


def generate_signing_secret() -> str:
    """產生 HMAC secret（64 char URL-safe）。"""
    return secrets.token_urlsafe(48)


def sign_payload(secret: str, payload: bytes | str) -> str:
    """產生 X-Webhook-Signature 值。

    格式：`sha256=<hex>`
    """
    if isinstance(payload, str):
        payload = payload.encode("utf-8")
    mac = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return f"sha256={mac}"


# Exponential backoff 表（秒）：5min, 25min, 2h, 12h, 1d, 3d, 7d
_BACKOFF_TABLE = [300, 1500, 7200, 43200, 86400, 259200, 604800]


def next_backoff_seconds(attempt: int) -> int:
    """attempt 從 1 開始；超過表長度則回傳最後一筆。"""
    if attempt <= 0:
        return _BACKOFF_TABLE[0]
    idx = min(attempt - 1, len(_BACKOFF_TABLE) - 1)
    return _BACKOFF_TABLE[idx]


# ── Subscription CRUD ─────────────────────────────────────────────


async def create_subscription(
    db: AsyncSession,
    *,
    owner_user_id: uuid.UUID,
    name: str,
    url: str,
    events: list[str],
    description: str | None,
    max_retries: int,
) -> tuple[WebhookSubscription, str]:
    """建立 subscription、回傳 (model row, 一次性 secret 明文)。"""
    raw_secret = generate_signing_secret()
    row = WebhookSubscription(
        name=name,
        owner_user_id=owner_user_id,
        url=url,
        events=list(events),
        secret=raw_secret,
        is_active=True,
        max_retries=max_retries,
        description=description,
    )
    db.add(row)
    await db.flush()
    return row, raw_secret


async def list_subscriptions(
    db: AsyncSession,
    *,
    owner_user_id: uuid.UUID | None = None,
    only_active: bool = False,
) -> list[WebhookSubscription]:
    stmt = select(WebhookSubscription).order_by(desc(WebhookSubscription.created_at))
    if owner_user_id is not None:
        stmt = stmt.where(WebhookSubscription.owner_user_id == owner_user_id)
    if only_active:
        stmt = stmt.where(WebhookSubscription.is_active.is_(True))
    return list((await db.execute(stmt)).scalars().all())


async def get_subscription(
    db: AsyncSession, subscription_id: uuid.UUID
) -> WebhookSubscription | None:
    return await db.get(WebhookSubscription, subscription_id)


async def update_subscription(
    db: AsyncSession,
    subscription_id: uuid.UUID,
    *,
    name: str | None = None,
    url: str | None = None,
    events: list[str] | None = None,
    description: str | None = None,
    is_active: bool | None = None,
    max_retries: int | None = None,
) -> WebhookSubscription:
    row = await db.get(WebhookSubscription, subscription_id)
    if row is None:
        raise ValueError("subscription not found")
    if name is not None:
        row.name = name
    if url is not None:
        row.url = url
    if events is not None:
        row.events = list(events)
    if description is not None:
        row.description = description
    if is_active is not None:
        row.is_active = is_active
    if max_retries is not None:
        row.max_retries = max_retries
    await db.flush()
    return row


async def delete_subscription(db: AsyncSession, subscription_id: uuid.UUID) -> None:
    row = await db.get(WebhookSubscription, subscription_id)
    if row is None:
        return
    await db.delete(row)
    await db.flush()


# ── Delivery 排程 / 重試 ────────────────────────────────────────────


async def enqueue_event(
    db: AsyncSession,
    *,
    event_type: str,
    payload: dict[str, Any],
) -> list[WebhookDelivery]:
    """對所有訂閱該 event_type 的 active subscription 排一筆 delivery。

    呼叫端：service 層在資料變更後呼叫。
    回傳：新建立的 WebhookDelivery 列表。
    """
    stmt = select(WebhookSubscription).where(WebhookSubscription.is_active.is_(True))
    subs = (await db.execute(stmt)).scalars().all()
    targets = [s for s in subs if event_type in (s.events or [])]
    if not targets:
        return []

    now = datetime.now(UTC)
    deliveries: list[WebhookDelivery] = []
    for sub in targets:
        delivery = WebhookDelivery(
            subscription_id=sub.id,
            event_type=event_type,
            payload=payload,
            status=DeliveryStatus.PENDING.value,
            attempt_count=0,
            scheduled_at=now,
        )
        db.add(delivery)
        deliveries.append(delivery)
    await db.flush()
    return deliveries


async def list_due_deliveries(db: AsyncSession, *, limit: int = 100) -> list[WebhookDelivery]:
    """Celery worker 拉取待送的 delivery。"""
    now = datetime.now(UTC)
    stmt = (
        select(WebhookDelivery)
        .where(WebhookDelivery.status == DeliveryStatus.PENDING.value)
        .where(WebhookDelivery.scheduled_at <= now)
        .order_by(WebhookDelivery.scheduled_at)
        .limit(limit)
    )
    return list((await db.execute(stmt)).scalars().all())


async def mark_succeeded(
    db: AsyncSession,
    delivery_id: uuid.UUID,
    *,
    response_status: int,
    response_snippet: str | None,
) -> None:
    now = datetime.now(UTC)
    await db.execute(
        update(WebhookDelivery)
        .where(WebhookDelivery.id == delivery_id)
        .values(
            status=DeliveryStatus.SUCCEEDED.value,
            succeeded_at=now,
            last_attempted_at=now,
            response_status=response_status,
            response_snippet=(response_snippet or "")[:2000] or None,
            attempt_count=WebhookDelivery.attempt_count + 1,
        )
    )
    await db.flush()


async def mark_failed_and_schedule_retry(
    db: AsyncSession,
    delivery_id: uuid.UUID,
    *,
    response_status: int | None,
    response_snippet: str | None,
    error_message: str | None,
    max_retries: int,
) -> bool:
    """更新失敗紀錄；若可重試回 True，否則標 DEAD 回 False。"""
    row = await db.get(WebhookDelivery, delivery_id)
    if row is None:
        return False
    row.attempt_count += 1
    row.last_attempted_at = datetime.now(UTC)
    row.response_status = response_status
    row.response_snippet = (response_snippet or "")[:2000] or None
    row.error_message = (error_message or "")[:2000] or None
    if row.attempt_count >= max_retries:
        row.status = DeliveryStatus.DEAD.value
        await db.flush()
        return False
    row.status = DeliveryStatus.PENDING.value
    row.scheduled_at = datetime.now(UTC) + timedelta(
        seconds=next_backoff_seconds(row.attempt_count)
    )
    await db.flush()
    return True


def serialize_payload(payload: dict[str, Any]) -> bytes:
    """投遞用 canonical body：JSON sort_keys 確保 signature 可重現。"""
    return json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")


__all__ = [
    "create_subscription",
    "delete_subscription",
    "enqueue_event",
    "generate_signing_secret",
    "get_subscription",
    "list_due_deliveries",
    "list_subscriptions",
    "mark_failed_and_schedule_retry",
    "mark_succeeded",
    "next_backoff_seconds",
    "serialize_payload",
    "sign_payload",
    "update_subscription",
]
