"""Webhook 投遞 Celery worker。

兩個 task：
1. process_webhook_deliveries（每 30 秒）— 拉取 due 的 delivery 並逐一送出
2. deliver_webhook（單筆送出）— 由上述 task 派發、可獨立 retry

行為：
- POST JSON 到 target URL
- header: Content-Type / User-Agent / X-Webhook-Event / X-Webhook-Delivery-Id /
  X-Webhook-Signature (HMAC-SHA256)
- timeout 10 秒
- 成功（2xx）：mark_succeeded
- 失敗：mark_failed_and_schedule_retry（exponential backoff）
- 達 max_retries：標 DEAD（會出現在 deliveries 列表給 admin）

"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.celery_app import celery_app
from api.core.prometheus_metrics import record_webhook_delivery
from api.services import webhook as webhook_svc

logger = logging.getLogger(__name__)

HTTP_TIMEOUT_SECONDS = 10
USER_AGENT = "HCCA-Webhook/1.0 (+https://hcca.example/legal/security-policy)"


@asynccontextmanager
async def _task_session() -> AsyncIterator[AsyncSession]:
    """每次 asyncio.run() 以新 loop 專屬 engine 開 session 並 dispose。

    Celery task 每呼叫一次 asyncio.run() 就是一個新的 event loop。若沿用模組層級
    共享的 async engine，其 pooled asyncpg 連線會綁定到上一個（已關閉的）loop，
    再次使用時拋 "got Future attached to a different loop"。
    """
    from sqlalchemy.ext.asyncio import create_async_engine

    from api.core.config import settings

    engine = create_async_engine(str(settings.DATABASE_URL), echo=False)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            yield session
    finally:
        await engine.dispose()


async def _deliver_one_async(delivery_id: str) -> dict:
    """送出單一 delivery、處理結果。回傳 summary dict。"""
    from api.models.webhook import WebhookDelivery, WebhookSubscription

    async with _task_session() as db:
        import uuid as _uuid

        delivery = await db.get(WebhookDelivery, _uuid.UUID(delivery_id))
        if delivery is None:
            return {"status": "skipped", "reason": "delivery not found"}
        sub = await db.get(WebhookSubscription, delivery.subscription_id)
        if sub is None or not sub.is_active:
            return {"status": "skipped", "reason": "subscription gone or inactive"}

        body_bytes = webhook_svc.serialize_payload(delivery.payload)
        signature = webhook_svc.sign_payload(sub.secret, body_bytes)
        headers = {
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
            "X-Webhook-Event": delivery.event_type,
            "X-Webhook-Delivery-Id": str(delivery.id),
            "X-Webhook-Signature": signature,
        }

        try:
            async with httpx.AsyncClient(
                timeout=HTTP_TIMEOUT_SECONDS, follow_redirects=False
            ) as client:
                resp = await client.post(sub.url, content=body_bytes, headers=headers)
            snippet = resp.text[:2000] if resp.text else None
        except httpx.RequestError as exc:
            ok = await webhook_svc.mark_failed_and_schedule_retry(
                db,
                delivery.id,
                response_status=None,
                response_snippet=None,
                error_message=f"{type(exc).__name__}: {exc}",
                max_retries=sub.max_retries,
            )
            await db.commit()
            record_webhook_delivery(delivery.event_type, "retry" if ok else "dead")
            return {
                "status": "retry" if ok else "dead",
                "delivery_id": str(delivery.id),
                "error": str(exc),
            }

        if 200 <= resp.status_code < 300:
            await webhook_svc.mark_succeeded(
                db,
                delivery.id,
                response_status=resp.status_code,
                response_snippet=snippet,
            )
            await db.commit()
            record_webhook_delivery(delivery.event_type, "success")
            return {
                "status": "ok",
                "delivery_id": str(delivery.id),
                "response_status": resp.status_code,
            }

        ok = await webhook_svc.mark_failed_and_schedule_retry(
            db,
            delivery.id,
            response_status=resp.status_code,
            response_snippet=snippet,
            error_message=f"HTTP {resp.status_code}",
            max_retries=sub.max_retries,
        )
        await db.commit()
        record_webhook_delivery(delivery.event_type, "retry" if ok else "dead")
        return {
            "status": "retry" if ok else "dead",
            "delivery_id": str(delivery.id),
            "response_status": resp.status_code,
        }


@celery_app.task(name="api.services.webhook_tasks.deliver_webhook")
def deliver_webhook(delivery_id: str) -> dict:
    """送出單筆 delivery。可由 worker 單獨呼叫。"""
    return asyncio.run(_deliver_one_async(delivery_id))


async def _process_due_async(batch_size: int) -> dict:
    """批次拉取 due deliveries、為每筆 enqueue 一個 deliver_webhook task。"""
    async with _task_session() as db:
        rows = await webhook_svc.list_due_deliveries(db, limit=batch_size)
        for row in rows:
            try:
                deliver_webhook.delay(str(row.id))
            except Exception:
                logger.exception("dispatch deliver_webhook failed id=%s", row.id)
    return {"status": "ok", "dispatched": len(rows)}


@celery_app.task(name="api.services.webhook_tasks.process_webhook_deliveries")
def process_webhook_deliveries(batch_size: int = 100) -> dict:
    """掃 due 的 webhook delivery、派發投遞。每 30 秒跑一次（建議）。"""
    return asyncio.run(_process_due_async(batch_size))


__all__ = ["deliver_webhook", "process_webhook_deliveries"]
