"""模組自動修復：half-open 探測、跳閘通知分派、admin 手動恢復協調。

設計：
  - half-open 探測由 Celery beat 觸發（每 30s 掃 Redis ZSET module_probe_queue）；
    這檔提供探測/恢復的純函式，task 端只負責排程與呼叫。
  - 跳閘通知透過 outbox 三條事件分派：
      discord.channel_alert / email.send / admin.notification
    任一通道故障不阻塞跳閘流程（fire-and-forget + log）。
  - half-open 探測使用 httpx AsyncClient 打 self loopback 的 /{module}/__module_health__
    端點；通過則 clear_module_maintenance + set_module_reset；失敗則延長 cooldown 並排下一次。
"""

from __future__ import annotations

import logging
import time

import httpx

from api.core.config import settings
from api.core.maintenance import (
    clear_module_maintenance,
    get_module_maintenance,
    set_module_maintenance,
    set_module_reset,
)
from api.core.modules import MODULES, ModuleSpec

logger = logging.getLogger(__name__)

_PROBE_QUEUE_KEY = "module_probe_queue"
_PROBE_TIMEOUT = 5.0


def _probe_path_for(module_id: str) -> str | None:
    """每個模組對外 health 路徑 = 第一個 api_prefix + /__module_health__"""
    spec: ModuleSpec | None = MODULES.get(module_id)
    if spec is None or not spec.api_prefixes:
        return None
    return f"{spec.api_prefixes[0]}/__module_health__"


async def probe_module(module_id: str) -> tuple[bool, str]:
    """打模組自己的健康端點；回 (ok, reason)。網路/HTTP 錯誤都算失敗。"""
    path = _probe_path_for(module_id)
    if not path:
        return False, "module-not-registered"
    base = settings.MODULE_PROBE_BASE_URL.rstrip("/")
    url = f"{base}{path}"
    try:
        async with httpx.AsyncClient(timeout=_PROBE_TIMEOUT) as client:
            resp = await client.get(url)
        if resp.status_code == 200:
            return True, "ok"
        return False, f"status={resp.status_code}"
    except httpx.HTTPError as exc:
        return False, f"http-error:{type(exc).__name__}"
    except Exception as exc:
        return False, f"unexpected:{type(exc).__name__}"


async def attempt_recovery(module_id: str, *, force: bool = False) -> bool:
    """探測通過 → 解除維護；失敗 → 延長 cooldown 並重新排程。

    force=True：admin 點「強制恢復」時呼叫，跳過 manual 保護。
    回傳是否成功恢復。
    """
    if module_id not in MODULES:
        return False

    existing = await get_module_maintenance(module_id)
    if not existing or not existing.get("on"):
        return True  # 本來就沒在維護

    if existing.get("mode") == "closed":
        return False  # 管理員明確關閉，不可被健康探測自動恢復

    if not force and existing.get("source") == "manual":
        # manual 維護不在這裡自動解除（admin 必須走 force 路徑）
        return False

    ok, reason = await probe_module(module_id)
    if ok:
        # 重置健康計數窗 + 清維護旗標 + 清升級計數器
        await clear_module_maintenance(module_id)
        await set_module_reset(module_id, window_seconds=settings.MODULE_CIRCUIT_WINDOW_SECONDS)
        from api.core.module_health import clear_trip_count

        await clear_trip_count(module_id)
        logger.info("Module %s recovered (probe ok)", module_id)
        try:
            from api.core.ws_manager import manager as ws_manager

            await ws_manager.broadcast_all(
                {"type": "module_maintenance", "module": module_id, "on": False}
            )
        except Exception:
            logger.debug("ws broadcast after recovery failed", exc_info=True)
        await _emit_recovered_notification(module_id)
        return True

    # 探測失敗：延長 cooldown 並重新排程
    logger.warning("Module %s probe failed: %s", module_id, reason)
    next_cooldown = min(
        settings.MODULE_CIRCUIT_COOLDOWN_MAX_SECONDS,
        max(60, int((existing.get("until") or time.time()) - time.time()) * 2),
    )
    await set_module_maintenance(
        module_id,
        on=True,
        source="auto",
        reason=f"探測仍失敗（{reason}），延長 {next_cooldown}s 後重試",
        ttl=next_cooldown,
    )
    await schedule_half_open_probe(module_id, after_seconds=next_cooldown)
    return False


async def schedule_half_open_probe(module_id: str, *, after_seconds: int) -> None:
    """寫入 Redis ZSET 排程；recovery_tasks 會掃並執行。"""
    from api.core.security import redis_client

    try:
        await redis_client.zadd(_PROBE_QUEUE_KEY, {module_id: time.time() + after_seconds})
    except Exception:
        logger.debug("schedule_half_open_probe failed id=%s", module_id, exc_info=True)


async def pop_due_probes(*, max_items: int = 5) -> list[str]:
    """取出已到期的 probe（一次最多 N 個，避免一輪 worker 卡太久）。"""
    from api.core.security import redis_client

    now = time.time()
    try:
        ids = await redis_client.zrangebyscore(_PROBE_QUEUE_KEY, 0, now, start=0, num=max_items)
        if not ids:
            return []
        # 用 pipeline 移除已取走的項目；個別失敗不影響整體
        pipe = redis_client.pipeline()
        for mid in ids:
            pipe.zrem(_PROBE_QUEUE_KEY, mid)
        await pipe.execute()
        return [str(x) for x in ids]
    except Exception:
        logger.debug("pop_due_probes failed", exc_info=True)
        return []


async def notify_module_tripped(
    module_id: str,
    *,
    severity: str,
    count: int,
    cooldown_s: int,
    escalated: bool,
) -> None:
    """跳閘事件透過 outbox 分派三條通知。

    任一通知失敗不影響跳閘決策；單一通道故障也不會拖延其他通道。
    """
    label = MODULES[module_id].label if module_id in MODULES else module_id
    title_prefix = "🚨 模組升級為手動維護" if escalated else "⚠️ 模組自動跳閘"
    title = f"{title_prefix}：{label}"
    body_lines = [
        f"模組：{label} ({module_id})",
        f"嚴重度：{severity}",
        f"1h 內跳閘次數：{count}",
    ]
    if escalated:
        body_lines.append("狀態：已升級為手動維護，需管理員手動恢復")
    else:
        body_lines.append(f"自動恢復：{cooldown_s}s 後嘗試探測")
    body = "\n".join(body_lines)

    from api.core.database import AsyncSessionLocal

    # 用獨立 session 避免影響呼叫端事務
    try:
        async with AsyncSessionLocal() as session:
            try:
                await _dispatch_all_channels(
                    session, module_id=module_id, title=title, body=body, severity=severity
                )
                await session.commit()
            except Exception:
                logger.exception("notify_module_tripped commit failed")
                await session.rollback()
    except Exception:
        logger.exception("notify_module_tripped session failed")


async def _dispatch_all_channels(
    session,
    *,
    module_id: str,
    title: str,
    body: str,
    severity: str,
) -> None:
    """依序寫入各通知通道，避免同一 AsyncSession 並行 flush。"""
    from api.services import outbox

    # 1. Discord 頻道告警
    channel_id = settings.MODULE_ALERT_DISCORD_CHANNEL_ID
    if channel_id:
        await outbox.emit(
            session,
            event_type="discord.channel_alert",
            payload={
                "channel_id": channel_id,
                "title": title,
                "body": body,
                "severity": severity,
                "module_id": module_id,
            },
        )
    # 2. Email 給 SUPERUSER_EMAILS
    if settings.SUPERUSER_EMAILS:
        for addr in settings.SUPERUSER_EMAILS:
            await outbox.emit(
                session,
                event_type="email.send",
                payload={
                    "to": addr,
                    "subject": title,
                    "body": body,
                    "module_id": module_id,
                    "severity": severity,
                },
            )
    # 3. admin UI 通知中心
    await outbox.emit(
        session,
        event_type="admin.notification",
        payload={
            "title": title,
            "body": body,
            "module_id": module_id,
            "severity": severity,
            "category": "module_circuit",
        },
    )


async def _emit_recovered_notification(module_id: str) -> None:
    """模組恢復時也通知 admin（量少；嚴重度 INFO，可省略 Discord）。"""
    label = MODULES[module_id].label if module_id in MODULES else module_id
    title = f"✅ 模組已自動恢復：{label}"
    body = f"模組 {label} 經 half-open 探測通過，已自動解除維護"

    from api.core.database import AsyncSessionLocal
    from api.services import outbox

    try:
        async with AsyncSessionLocal() as session:
            await outbox.emit(
                session,
                event_type="admin.notification",
                payload={
                    "title": title,
                    "body": body,
                    "module_id": module_id,
                    "severity": "INFO",
                    "category": "module_recovered",
                },
            )
            await session.commit()
    except Exception:
        logger.debug("_emit_recovered_notification failed", exc_info=True)
