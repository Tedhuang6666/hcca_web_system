"""Automatic owner error reports.

Celery beat scans sanitized API error events persisted in Redis, gathers nearby
connection/task health signals, and emails a concise incident report to
OWNER_EMAILS. It intentionally avoids request bodies, cookies, and tokens.
"""

from __future__ import annotations

import asyncio
import html
import json
import logging
import time
from datetime import UTC, datetime
from typing import Any

from redis import Redis
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from api.core.celery_app import celery_app
from api.core.config import settings
from api.services import feature_flag

logger = logging.getLogger(__name__)

_QUEUES = ("default", "email", "meal", "backup", "documents", "recovery")
ERROR_REPORT_EMAIL_FLAG = "email_error_report"


@celery_app.task(
    name="api.services.error_report_tasks.send_owner_error_report",
    bind=True,
    max_retries=3,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
)
def send_owner_error_report(self) -> dict[str, Any]:  # type: ignore[type-arg]
    """Periodic task: send an owner report when new server errors are detected."""
    try:
        return asyncio.run(_run())
    except Exception:
        logger.exception("owner error report task failed (attempt %d)", self.request.retries + 1)
        raise


async def _run() -> dict[str, Any]:
    if not settings.ERROR_REPORT_EMAIL_ENABLED:
        return {"ok": True, "skipped": "disabled"}
    if not settings.OWNER_EMAILS:
        return {"ok": True, "skipped": "no_owner_emails"}
    if not settings.RESEND_API_KEY:
        return {"ok": True, "skipped": "no_resend_api_key"}

    client = Redis.from_url(
        str(settings.REDIS_URL),
        decode_responses=True,
        socket_timeout=settings.REDIS_SOCKET_TIMEOUT,
        socket_connect_timeout=settings.REDIS_SOCKET_TIMEOUT,
    )
    try:
        now = time.time()
        last_sent = _read_last_sent(client, now)
        events = _read_new_error_events(client, last_sent, now)
        dlq = _read_recent_dlq(client, last_sent)
        if not events and not dlq:
            return {"ok": True, "sent": False, "reason": "no_new_errors"}

        # 為本次 asyncio.run 建立專屬 engine（NullPool）。Celery worker 每次
        # asyncio.run 都是新 event loop，沿用全域 AsyncSessionLocal 的持久連線池
        # 會在第一個 DB 操作丟 RuntimeError（連線綁在前一個 loop），導致報告誤報
        # 「DB 異常 RuntimeError」。與其他 celery async task 一致：自建 + dispose。
        engine = create_async_engine(str(settings.DATABASE_URL), poolclass=NullPool)
        session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        try:
            async with session_factory() as session:
                if not await feature_flag.is_enabled(session, ERROR_REPORT_EMAIL_FLAG):
                    return {"ok": True, "skipped": "feature_flag_disabled"}
            diagnostics = await _collect_diagnostics(client, session_factory)
        finally:
            await engine.dispose()
        subject = _subject(events, dlq)
        body = _render_html_report(
            events=events,
            dlq=dlq,
            diagnostics=diagnostics,
            last_sent=last_sent,
            generated_at=now,
        )

        from api.services.mail import send_email_now

        await send_email_now(settings.OWNER_EMAILS, subject, body)
        client.set(settings.ERROR_REPORT_STATE_KEY, str(now), ex=30 * 86400)
        logger.info(
            "owner error report sent owners=%d errors=%d dlq=%d",
            len(settings.OWNER_EMAILS),
            len(events),
            len(dlq),
        )
        return {"ok": True, "sent": True, "errors": len(events), "dlq": len(dlq)}
    finally:
        client.close()


def _read_last_sent(client: Redis, now: float) -> float:
    raw = client.get(settings.ERROR_REPORT_STATE_KEY)
    if raw:
        try:
            return float(raw)
        except ValueError:
            pass
    return now - settings.ERROR_REPORT_WINDOW_SECONDS


def _safe_json(raw: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _read_new_error_events(client: Redis, last_sent: float, now: float) -> list[dict[str, Any]]:
    raw_items = client.lrange(
        settings.ERROR_REPORT_REDIS_KEY, 0, settings.ERROR_REPORT_MAX_ITEMS * 5
    )
    events: list[dict[str, Any]] = []
    oldest = now - settings.ERROR_REPORT_WINDOW_SECONDS
    for raw in raw_items:
        item = _safe_json(raw)
        if item is None:
            continue
        occurred_at = _float(item.get("occurred_at"))
        if occurred_at <= last_sent or occurred_at < oldest:
            continue
        events.append(item)
        if len(events) >= settings.ERROR_REPORT_MAX_ITEMS:
            break
    return events


def _read_recent_dlq(client: Redis, last_sent: float) -> list[dict[str, Any]]:
    raw_items = client.lrange(settings.CELERY_DLQ_REDIS_KEY, 0, settings.ERROR_REPORT_MAX_ITEMS - 1)
    items: list[dict[str, Any]] = []
    for raw in raw_items:
        item = _safe_json(raw)
        if item is None:
            continue
        timestamp = _parse_timestamp(item.get("timestamp"))
        if timestamp is not None and timestamp <= last_sent:
            continue
        items.append(item)
    return items


async def _collect_diagnostics(
    client: Redis, session_factory: async_sessionmaker[AsyncSession]
) -> dict[str, Any]:
    return {
        "db": await _check_db(session_factory),
        "redis": _check_redis(client),
        "queues": _queue_depths(client),
        "outbox_dead": await _outbox_dead_count(session_factory),
    }


async def _check_db(session_factory: async_sessionmaker[AsyncSession]) -> dict[str, Any]:
    try:
        async with session_factory() as session:
            await session.execute(text("SELECT 1"))
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": exc.__class__.__name__}


def _check_redis(client: Redis) -> dict[str, Any]:
    try:
        info = client.info("clients")
        return {
            "ok": True,
            "connected_clients": int(info.get("connected_clients", 0)),
            "blocked_clients": int(info.get("blocked_clients", 0)),
        }
    except Exception as exc:
        return {"ok": False, "error": exc.__class__.__name__}


def _queue_depths(client: Redis) -> list[dict[str, Any]]:
    depths: list[dict[str, Any]] = []
    for name in _QUEUES:
        try:
            pending = int(client.llen(name))
        except Exception:
            pending = -1
        depths.append({"name": name, "pending": pending})
    return depths


async def _outbox_dead_count(
    session_factory: async_sessionmaker[AsyncSession],
) -> dict[str, Any]:
    from api.models.outbox import OutboxEvent, OutboxStatus

    try:
        async with session_factory() as session:
            count = int(
                (
                    await session.execute(
                        select(func.count()).where(OutboxEvent.status == OutboxStatus.DEAD)
                    )
                ).scalar_one()
            )
        return {"ok": True, "count": count}
    except Exception as exc:
        return {"ok": False, "error": exc.__class__.__name__}


def _subject(events: list[dict[str, Any]], dlq: list[dict[str, Any]]) -> str:
    if events:
        first = events[0]
        path = str(first.get("path") or "unknown")
        return f"[HCCA] 自動錯誤報告：{len(events)} 筆 API 錯誤（{path}）"
    return f"[HCCA] 自動錯誤報告：{len(dlq)} 筆 Celery 失敗"


def _render_html_report(
    *,
    events: list[dict[str, Any]],
    dlq: list[dict[str, Any]],
    diagnostics: dict[str, Any],
    last_sent: float,
    generated_at: float,
) -> str:
    generated = _fmt_time(generated_at)
    since = _fmt_time(last_sent)
    return f"""
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.55;color:#172033">
      <h2>HCCA 自動錯誤報告</h2>
      <p>時間範圍：{html.escape(since)} 到 {html.escape(generated)}</p>
      <p>
        <a href="{html.escape(settings.FRONTEND_BASE_URL.rstrip("/"))}/admin/system">
          開啟系統防護管理
        </a>
      </p>
      {_render_diagnostics(diagnostics)}
      {_render_api_errors(events)}
      {_render_dlq(dlq)}
      <p style="color:#64748b;font-size:12px">
        報告只包含已過濾摘要：request id、IP、user-agent、路徑、狀態碼、例外類型與截斷 stack。
        不包含 cookie、token 或 request body。
      </p>
    </div>
    """


def _render_diagnostics(diagnostics: dict[str, Any]) -> str:
    db = diagnostics["db"]
    redis = diagnostics["redis"]
    outbox = diagnostics["outbox_dead"]
    queues = diagnostics["queues"]
    queue_rows = "".join(
        f"<tr><td>{_e(q['name'])}</td><td>{_e(q['pending'])}</td></tr>" for q in queues
    )
    return f"""
    <h3>關聯連線與佇列狀態</h3>
    <ul>
      <li>DB：{_status(db)}</li>
      <li>Redis：{_status(redis)}</li>
      <li>Outbox dead：{_e(outbox.get("count", outbox.get("error", "unknown")))}</li>
    </ul>
    <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse">
      <thead><tr><th>Queue</th><th>Pending</th></tr></thead>
      <tbody>{queue_rows}</tbody>
    </table>
    """


def _render_api_errors(events: list[dict[str, Any]]) -> str:
    if not events:
        return "<h3>API 錯誤</h3><p>沒有新的 API 5xx 錯誤。</p>"
    rows = []
    for item in events:
        rows.append(
            "<tr>"
            f"<td>{_e(_fmt_time(_float(item.get('occurred_at'))))}</td>"
            f"<td>{_e(item.get('error_id'))}</td>"
            f"<td>{_e(item.get('request_id'))}</td>"
            f"<td>{_e(item.get('method'))} {_e(item.get('path'))}</td>"
            f"<td>{_e(item.get('status_code'))}</td>"
            f"<td>{_e(item.get('client_ip'))}</td>"
            f"<td>{_e(item.get('exc_type'))}: {_e(item.get('message'))}</td>"
            "</tr>"
        )
    trace = _e(events[0].get("traceback_head") or "")
    return f"""
    <h3>API 錯誤</h3>
    <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse">
      <thead>
        <tr><th>時間</th><th>錯誤代碼</th><th>請求代碼</th><th>路徑</th><th>狀態</th><th>IP</th><th>例外</th></tr>
      </thead>
      <tbody>{"".join(rows)}</tbody>
    </table>
    <h4>最新 stack 摘要</h4>
    <pre style="white-space:pre-wrap;background:#f8fafc;padding:12px;border-radius:6px">{trace}</pre>
    """


def _render_dlq(dlq: list[dict[str, Any]]) -> str:
    if not dlq:
        return "<h3>Celery Dead Letter</h3><p>沒有新的 Celery dead-letter。</p>"
    rows = []
    for item in dlq:
        rows.append(
            "<tr>"
            f"<td>{_e(item.get('timestamp'))}</td>"
            f"<td>{_e(item.get('task'))}</td>"
            f"<td>{_e(item.get('task_id'))}</td>"
            f"<td>{_e(item.get('exception_type'))}: {_e(item.get('exception'))}</td>"
            "</tr>"
        )
    return f"""
    <h3>Celery Dead Letter</h3>
    <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse">
      <thead><tr><th>時間</th><th>Task</th><th>Task ID</th><th>例外</th></tr></thead>
      <tbody>{"".join(rows)}</tbody>
    </table>
    """


def _status(value: dict[str, Any]) -> str:
    if value.get("ok"):
        return "正常"
    return f"異常：{_e(value.get('error', 'unknown'))}"


def _e(value: object) -> str:
    return html.escape("" if value is None else str(value))


def _float(value: object) -> float:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.0


def _parse_timestamp(value: object) -> float | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _fmt_time(value: float) -> str:
    if value <= 0:
        return "-"
    return datetime.fromtimestamp(value, UTC).astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")
