"""Automatic owner error reports.

Celery beat scans sanitized API error events persisted in Redis, gathers nearby
connection/task health signals, and emails a concise incident report to
OWNER_EMAILS. It intentionally avoids request bodies, cookies, and tokens.
"""

from __future__ import annotations

import asyncio
import hashlib
import html
import json
import logging
import time
from dataclasses import dataclass
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
_SEVERITY_RANK = {"info": 0, "warning": 1, "error": 2, "critical": 3}
_OPTIONAL_INTEGRATION_MARKERS = (
    "尚未設定",
    "尚未啟用",
    "離線或尚未回報伺服器清單",
)
_EXPECTED_AUTH_ERRORS = {
    ("/auth/discord/login", "Discord OAuth 尚未設定"),
    ("/auth/google/one-tap", "尚未設定 Google Client ID"),
    ("/auth/refresh", "登入服務暫時不可用，請稍後再試"),
    ("/discord/login", "Discord OAuth 尚未設定"),
    ("/discord/available-guilds", "Discord 模組尚未啟用"),
    ("/discord/available-guilds", "Discord Bot 離線或尚未回報伺服器清單"),
    ("/line/webhook", "LINE Bot 尚未設定，請聯絡管理員"),
    ("/email/resend/webhook", "RESEND_WEBHOOK_SECRET 未設定"),
}


@dataclass(frozen=True)
class ErrorEventBatch:
    events: list[dict[str, Any]]
    suppressed_occurrences: int = 0
    filtered_occurrences: int = 0


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
        batch = _read_new_error_events(client, last_sent, now)
        events = batch.events
        dlq_batch = _read_recent_dlq(client, last_sent, now)
        dlq = dlq_batch.events
        suppressed_occurrences = batch.suppressed_occurrences + dlq_batch.suppressed_occurrences
        if not events and not dlq:
            client.set(settings.ERROR_REPORT_STATE_KEY, str(now), ex=30 * 86400)
            return {
                "ok": True,
                "sent": False,
                "reason": "no_actionable_errors",
                "suppressed": suppressed_occurrences,
                "filtered": batch.filtered_occurrences,
            }

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
            suppressed_occurrences=suppressed_occurrences,
            filtered_occurrences=batch.filtered_occurrences,
        )

        from api.services.mail import send_email_now

        await send_email_now(settings.OWNER_EMAILS, subject, body)
        _mark_notified(
            client,
            [str(item["signature"]) for item in [*events, *dlq]],
            now,
        )
        client.set(settings.ERROR_REPORT_STATE_KEY, str(now), ex=30 * 86400)
        logger.info(
            "owner error report sent owners=%d errors=%d dlq=%d",
            len(settings.OWNER_EMAILS),
            len(events),
            len(dlq),
        )
        return {
            "ok": True,
            "sent": True,
            "errors": len(events),
            "dlq": len(dlq),
            "suppressed": suppressed_occurrences,
            "filtered": batch.filtered_occurrences,
        }
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


def _read_new_error_events(client: Redis, last_sent: float, now: float) -> ErrorEventBatch:
    raw_items = client.lrange(
        settings.ERROR_REPORT_REDIS_KEY, 0, settings.ERROR_REPORT_MAX_ITEMS * 5
    )
    candidates: list[dict[str, Any]] = []
    filtered_occurrences = 0
    oldest = now - settings.ERROR_REPORT_WINDOW_SECONDS
    for raw in raw_items:
        item = _safe_json(raw)
        if item is None:
            continue
        occurred_at = _float(item.get("occurred_at"))
        if occurred_at <= last_sent or occurred_at < oldest:
            continue
        if _is_expected_auth_error(item) or not _meets_min_severity(item):
            filtered_occurrences += 1
            continue
        candidates.append(item)
        if len(candidates) >= settings.ERROR_REPORT_MAX_ITEMS * 5:
            break
    grouped = _aggregate_events(candidates)
    suppressed = _read_suppressed_signatures(client, grouped, now)
    events: list[dict[str, Any]] = []
    suppressed_occurrences = 0
    for item in grouped:
        if item["signature"] in suppressed:
            suppressed_occurrences += int(item["occurrences"])
        else:
            events.append(item)
        if len(events) >= settings.ERROR_REPORT_MAX_ITEMS:
            break
    return ErrorEventBatch(
        events=events,
        suppressed_occurrences=suppressed_occurrences,
        filtered_occurrences=filtered_occurrences,
    )


def _is_expected_auth_error(item: dict[str, Any]) -> bool:
    if (
        str(item.get("category") or "").lower() != "http"
        or str(item.get("exc_type") or "") != "HTTPException"
        or int(item.get("status_code") or 0) != 503
    ):
        return False
    path = str(item.get("path") or "")
    message = str(item.get("message") or "")
    return any(
        path == expected_path and message.endswith(detail)
        for expected_path, detail in _EXPECTED_AUTH_ERRORS
    )


def _event_signature(item: dict[str, Any]) -> str:
    fields = (
        str(item.get("category") or ""),
        str(item.get("exc_type") or ""),
        str(item.get("method") or ""),
        str(item.get("path") or ""),
        str(item.get("status_code") or ""),
        str(item.get("message") or ""),
    )
    payload = json.dumps(fields, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def _severity_for_event(item: dict[str, Any]) -> str:
    category = str(item.get("category") or "").lower()
    message = str(item.get("message") or "")
    status_code = int(item.get("status_code") or 500)
    if category in {"db", "redis"} or "Redis unavailable" in message:
        return "critical"
    if "登入服務暫時不可用" in message:
        return "critical"
    if status_code >= 500 and any(marker in message for marker in _OPTIONAL_INTEGRATION_MARKERS):
        return "warning"
    if status_code >= 500:
        return "critical" if status_code >= 500 and category == "unhandled" else "error"
    return "info"


def _meets_min_severity(item: dict[str, Any]) -> bool:
    severity = _severity_for_event(item)
    minimum = str(settings.ERROR_REPORT_MIN_SEVERITY).lower()
    return _SEVERITY_RANK.get(severity, 0) >= _SEVERITY_RANK.get(minimum, 2)


def _aggregate_events(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for item in items:
        signature = _event_signature(item)
        occurred_at = _float(item.get("occurred_at"))
        current = grouped.get(signature)
        if current is None:
            current = dict(item)
            current["signature"] = signature
            current["severity"] = _severity_for_event(item)
            current["occurrences"] = 0
            current["first_seen"] = occurred_at
            current["last_seen"] = occurred_at
            current["request_ids"] = []
            grouped[signature] = current
        current["occurrences"] += 1
        current["first_seen"] = min(float(current["first_seen"]), occurred_at)
        current["last_seen"] = max(float(current["last_seen"]), occurred_at)
        request_id = item.get("request_id")
        if request_id and request_id not in current["request_ids"]:
            current["request_ids"].append(request_id)
            current["request_ids"] = current["request_ids"][:3]
    return sorted(grouped.values(), key=lambda item: float(item["last_seen"]), reverse=True)


def _read_suppressed_signatures(
    client: Redis, events: list[dict[str, Any]], now: float
) -> set[str]:
    cooldown = settings.ERROR_REPORT_REPEAT_COOLDOWN_SECONDS
    if cooldown <= 0 or not events:
        return set()
    stored = client.hgetall(settings.ERROR_REPORT_SUPPRESSION_KEY)
    suppressed: set[str] = set()
    stale: list[str] = []
    for item in events:
        signature = str(item["signature"])
        notified_at = _float(stored.get(signature))
        if notified_at and now - notified_at < cooldown:
            suppressed.add(signature)
    for signature, value in stored.items():
        if now - _float(value) >= cooldown * 2:
            stale.append(signature)
    if stale:
        client.hdel(settings.ERROR_REPORT_SUPPRESSION_KEY, *stale)
    return suppressed


def _mark_notified(client: Redis, signatures: list[str], now: float) -> None:
    if not signatures or settings.ERROR_REPORT_REPEAT_COOLDOWN_SECONDS <= 0:
        return
    client.hset(
        settings.ERROR_REPORT_SUPPRESSION_KEY,
        mapping={signature: str(now) for signature in signatures},
    )
    client.expire(
        settings.ERROR_REPORT_SUPPRESSION_KEY,
        max(settings.ERROR_REPORT_REPEAT_COOLDOWN_SECONDS * 2, 86400),
    )


def _read_recent_dlq(client: Redis, last_sent: float, now: float) -> ErrorEventBatch:
    raw_items = client.lrange(settings.CELERY_DLQ_REDIS_KEY, 0, settings.ERROR_REPORT_MAX_ITEMS - 1)
    candidates: list[dict[str, Any]] = []
    for raw in raw_items:
        item = _safe_json(raw)
        if item is None:
            continue
        timestamp = _parse_timestamp(item.get("timestamp"))
        if timestamp is not None and timestamp <= last_sent:
            continue
        candidates.append(item)
    grouped: dict[str, dict[str, Any]] = {}
    for item in candidates:
        signature = _dlq_signature(item)
        timestamp = _parse_timestamp(item.get("timestamp")) or now
        current = grouped.get(signature)
        if current is None:
            current = dict(item)
            current["signature"] = signature
            current["occurrences"] = 0
            current["first_seen"] = timestamp
            current["last_seen"] = timestamp
            current["task_ids"] = []
            grouped[signature] = current
        current["occurrences"] += 1
        current["first_seen"] = min(float(current["first_seen"]), timestamp)
        current["last_seen"] = max(float(current["last_seen"]), timestamp)
        task_id = item.get("task_id")
        if task_id and task_id not in current["task_ids"]:
            current["task_ids"].append(task_id)
            current["task_ids"] = current["task_ids"][:3]
    grouped_items = sorted(
        grouped.values(), key=lambda item: float(item["last_seen"]), reverse=True
    )
    suppressed = _read_suppressed_signatures(client, grouped_items, now)
    events = [item for item in grouped_items if item["signature"] not in suppressed]
    return ErrorEventBatch(
        events=events[: settings.ERROR_REPORT_MAX_ITEMS],
        suppressed_occurrences=sum(
            int(item["occurrences"]) for item in grouped_items if item["signature"] in suppressed
        ),
    )


def _dlq_signature(item: dict[str, Any]) -> str:
    fields = (
        "celery-dlq",
        str(item.get("task") or ""),
        str(item.get("exception_type") or ""),
        str(item.get("exception") or ""),
    )
    payload = json.dumps(fields, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


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
    parts: list[str] = []
    if events:
        highest = max(
            (str(item.get("severity") or "error") for item in events),
            key=lambda value: _SEVERITY_RANK.get(value, 0),
        )
        parts.append(f"API {len(events)} 個問題/{highest}")
    if dlq:
        parts.append(f"Celery {len(dlq)} 個失敗")
    return f"[HCCA] 系統異常摘要｜{'、'.join(parts)}"


def _render_html_report(
    *,
    events: list[dict[str, Any]],
    dlq: list[dict[str, Any]],
    diagnostics: dict[str, Any],
    last_sent: float,
    generated_at: float,
    suppressed_occurrences: int = 0,
    filtered_occurrences: int = 0,
) -> str:
    generated = _fmt_time(generated_at)
    since = _fmt_time(last_sent)
    return f"""
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.55;color:#172033">
      <h2>HCCA 系統異常摘要</h2>
      <p>時間範圍：{html.escape(since)} 到 {html.escape(generated)}</p>
      <ul>
        <li>本次通報 API 問題：{len(events)} 個</li>
        <li>已合併的重複事件：{_e(suppressed_occurrences)} 次</li>
        <li>低於通報門檻而略過：{_e(filtered_occurrences)} 次</li>
      </ul>
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
        return "<h3>API 異常</h3><p>沒有新的可通報 API 異常。</p>"
    rows = []
    for item in events:
        request_ids = ", ".join(str(value) for value in item.get("request_ids", []))
        rows.append(
            "<tr>"
            f"<td><strong>{_e(item.get('severity'))}</strong></td>"
            f"<td>{_e(item.get('occurrences'))}</td>"
            f"<td>{_e(_fmt_time(_float(item.get('first_seen'))))}</td>"
            f"<td>{_e(_fmt_time(_float(item.get('last_seen'))))}</td>"
            f"<td>{_e(item.get('method'))} {_e(item.get('path'))} ({_e(item.get('status_code'))})</td>"
            f"<td>{_e(item.get('exc_type'))}: {_e(item.get('message'))}</td>"
            f"<td>{_e(request_ids)}</td>"
            "</tr>"
        )
    traces = []
    for item in events[:5]:
        traces.append(
            "<details>"
            f"<summary>{_e(item.get('severity'))} · {_e(item.get('method'))} "
            f"{_e(item.get('path'))} · {_e(item.get('occurrences'))} 次</summary>"
            f'<pre style="white-space:pre-wrap;background:#f8fafc;padding:12px;border-radius:6px">'
            f"{_e(item.get('traceback_head') or '')}</pre></details>"
        )
    return f"""
    <h3>API 異常</h3>
    <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse">
      <thead>
        <tr><th>嚴重度</th><th>次數</th><th>首次</th><th>最近</th><th>端點</th><th>錯誤</th><th>代表請求代碼</th></tr>
      </thead>
      <tbody>{"".join(rows)}</tbody>
    </table>
    <h4>Stack 摘要（最多顯示 5 個問題）</h4>
    {"".join(traces)}
    """


def _render_dlq(dlq: list[dict[str, Any]]) -> str:
    if not dlq:
        return ""
    rows = []
    for item in dlq:
        task_ids = ", ".join(str(value) for value in item.get("task_ids", []))
        rows.append(
            "<tr>"
            f"<td>{_e(item.get('occurrences'))}</td>"
            f"<td>{_e(_fmt_time(_float(item.get('first_seen'))))}</td>"
            f"<td>{_e(_fmt_time(_float(item.get('last_seen'))))}</td>"
            f"<td>{_e(item.get('task'))}</td>"
            f"<td>{_e(task_ids)}</td>"
            f"<td>{_e(item.get('exception_type'))}: {_e(item.get('exception'))}</td>"
            "</tr>"
        )
    return f"""
    <h3>Celery Dead Letter</h3>
    <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse">
      <thead><tr><th>次數</th><th>首次</th><th>最近</th><th>Task</th><th>代表 Task ID</th><th>例外</th></tr></thead>
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
