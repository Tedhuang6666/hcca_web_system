"""每模組健康斷路器 — per-worker 滑動視窗統計 5xx，超門檻自動開啟模組維護。

設計重點：
  - 計數為 per-worker（in-process），與 load_signals 一致；跳閘決策寫入 Redis
    （set_module_maintenance auto + ttl），讓所有 worker 一致看到「該模組維護中」，
    並透過 Redis TTL 到期自動恢復（half-open）。
  - **只計 500–599 且 ≠ 503**：503 是維護/load-shed 的保護性回應，計入會造成
    「維護→503→再次跳閘」的自我維持迴圈。
  - 重啟按鈕寫入的 module_reset_at 時戳之前的樣本會被忽略，讓計數立即歸零。
  - 錯誤分級驅動升級：CRITICAL / HIGH / NORMAL 三級，門檻不同；同一窗口內
    一旦出現 CRITICAL，升級門檻降到 3 次。
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from threading import Lock

from api.core.config import settings
from api.core.maintenance import (
    get_module_maintenance,
    get_module_reset,
    set_module_maintenance,
)

logger = logging.getLogger(__name__)

_lock = Lock()
# module_id -> deque[(wall-clock timestamp, severity)]（僅記錄合格的 5xx）
_events: dict[str, deque[tuple[float, str]]] = defaultdict(deque)
# per-worker 節流：跳閘後在 cooldown 內不重複寫 Redis。
_tripped_until: dict[str, float] = {}
# 最近跳閘結果供管理介面顯示；每個模組保留最近 20 筆。
_trip_history: dict[str, deque[dict[str, float | str | int | bool]]] = defaultdict(
    lambda: deque(maxlen=20)
)

# 錯誤嚴重度
SEV_CRITICAL = "CRITICAL"
SEV_HIGH = "HIGH"
SEV_NORMAL = "NORMAL"

# 升級計數 Redis key 前綴
_TRIP_COUNT_PREFIX = "module_trip_count:"
_TRIP_SEV_PREFIX = "module_trip_max_sev:"


def _window_seconds() -> float:
    return float(settings.MODULE_CIRCUIT_WINDOW_SECONDS)


def _evict(dq: deque[tuple[float, str]], cutoff: float) -> None:
    while dq and dq[0][0] < cutoff:
        dq.popleft()


def _classify_error(status_code: int, exc: BaseException | None = None) -> str:
    """根據 status code 與 exception 類型判定嚴重度。

    CRITICAL：DB 連線斷、OS 級資源錯誤 — 整個模組可能不能用
    HIGH：超時、外部依賴錯誤、Integrity 異常 — 嚴重但通常可恢復
    NORMAL：一般 5xx 業務例外
    """
    if exc is not None:
        # 用名稱比對避免 import 循環（sqlalchemy / asyncpg 可能未在所有環境可用）
        name = type(exc).__name__
        critical_names = {
            "OperationalError",
            "DBAPIError",
            "InterfaceError",
            "MemoryError",
            "ConnectionError",
            "ConnectionRefusedError",
        }
        if name in critical_names:
            return SEV_CRITICAL
        high_names = {
            "TimeoutError",
            "IntegrityError",
            "DataError",
            "HTTPError",
        }
        if name in high_names:
            return SEV_HIGH
        # 啟動自檢失敗一律 CRITICAL
        if name == "StartupCheckFailed":
            return SEV_CRITICAL
    # 504 Gateway Timeout 視為 HIGH
    if status_code == 504:
        return SEV_HIGH
    return SEV_NORMAL


def record_module_status(
    module_id: str, status_code: int, exc: BaseException | None = None
) -> None:
    """記錄一筆模組回應狀態；僅合格 5xx（≠503）入列。"""
    if not (500 <= status_code < 600) or status_code == 503:
        return
    severity = _classify_error(status_code, exc)
    now = time.time()
    cutoff = now - _window_seconds()
    with _lock:
        dq = _events[module_id]
        dq.append((now, severity))
        _evict(dq, cutoff)


def module_5xx_count(module_id: str) -> int:
    """過去 window 秒內合格 5xx 數量（admin 狀態頁顯示用）。"""
    now = time.time()
    cutoff = now - _window_seconds()
    with _lock:
        dq = _events.get(module_id)
        if not dq:
            return 0
        _evict(dq, cutoff)
        return len(dq)


def module_severity_breakdown(module_id: str) -> dict[str, int]:
    """過去 window 秒內 5xx 樣本依嚴重度分類，用於 admin 顯示。"""
    now = time.time()
    cutoff = now - _window_seconds()
    out = {SEV_CRITICAL: 0, SEV_HIGH: 0, SEV_NORMAL: 0}
    with _lock:
        dq = _events.get(module_id)
        if not dq:
            return out
        _evict(dq, cutoff)
        for _, sev in dq:
            if sev in out:
                out[sev] += 1
    return out


def _count_since(module_id: str, since: float) -> int:
    now = time.time()
    cutoff = max(now - _window_seconds(), since)
    with _lock:
        dq = _events.get(module_id)
        if not dq:
            return 0
        _evict(dq, now - _window_seconds())
        return sum(1 for ts, _ in dq if ts >= cutoff)


def _max_severity_since(module_id: str, since: float) -> str:
    """回傳該重置點之後最嚴重的等級（用於決定升級門檻）。"""
    now = time.time()
    cutoff = max(now - _window_seconds(), since)
    with _lock:
        dq = _events.get(module_id)
        if not dq:
            return SEV_NORMAL
        _evict(dq, now - _window_seconds())
        max_sev = SEV_NORMAL
        for ts, sev in dq:
            if ts < cutoff:
                continue
            if sev == SEV_CRITICAL:
                return SEV_CRITICAL
            if sev == SEV_HIGH:
                max_sev = SEV_HIGH
    return max_sev


def _threshold_for_severity(sev: str) -> int:
    if sev == SEV_CRITICAL:
        return settings.MODULE_TRIP_THRESHOLD_CRITICAL
    if sev == SEV_HIGH:
        return settings.MODULE_TRIP_THRESHOLD_HIGH
    return settings.MODULE_TRIP_THRESHOLD_NORMAL


def _cooldown_for_trip_count(count: int) -> int:
    """指數退避：base × 2^(count-1)，封頂 MODULE_CIRCUIT_COOLDOWN_MAX_SECONDS。"""
    base = settings.MODULE_CIRCUIT_COOLDOWN_BASE_SECONDS
    raw = base * (2 ** max(count - 1, 0))
    return int(min(raw, settings.MODULE_CIRCUIT_COOLDOWN_MAX_SECONDS))


async def _get_trip_count(module_id: str) -> tuple[int, str]:
    """讀取升級窗口內的累計跳閘次數與紀錄到的最大嚴重度。"""
    from api.core.security import redis_client

    try:
        count_raw = await redis_client.get(_TRIP_COUNT_PREFIX + module_id)
        sev_raw = await redis_client.get(_TRIP_SEV_PREFIX + module_id)
    except Exception:
        return 0, SEV_NORMAL
    try:
        count = int(count_raw) if count_raw else 0
    except (TypeError, ValueError):
        count = 0
    sev = sev_raw if sev_raw in {SEV_CRITICAL, SEV_HIGH, SEV_NORMAL} else SEV_NORMAL
    return count, sev


async def _bump_trip_count(module_id: str, severity: str) -> tuple[int, str]:
    """累加跳閘次數，並更新窗口內最大嚴重度。回傳 (新 count, 新最大 sev)。"""
    from api.core.security import redis_client

    window = settings.MODULE_TRIP_ESCALATION_WINDOW_SECONDS
    new_count = 1
    try:
        new_count = int(await redis_client.incr(_TRIP_COUNT_PREFIX + module_id))
        await redis_client.expire(_TRIP_COUNT_PREFIX + module_id, window)
    except Exception:
        logger.debug("bump_trip_count incr failed id=%s", module_id, exc_info=True)

    # 更新最大嚴重度（CRITICAL > HIGH > NORMAL）
    prev_count, prev_sev = await _get_trip_count(module_id)
    sev_rank = {SEV_NORMAL: 0, SEV_HIGH: 1, SEV_CRITICAL: 2}
    new_sev = severity if sev_rank.get(severity, 0) > sev_rank.get(prev_sev, 0) else prev_sev
    try:
        await redis_client.set(_TRIP_SEV_PREFIX + module_id, new_sev, ex=window)
    except Exception:
        logger.debug("bump_trip_count sev set failed id=%s", module_id, exc_info=True)

    return new_count, new_sev


async def clear_trip_count(module_id: str) -> None:
    """admin 點「清計數器並嘗試恢復」時呼叫。"""
    from api.core.security import redis_client

    try:
        await redis_client.delete(_TRIP_COUNT_PREFIX + module_id)
        await redis_client.delete(_TRIP_SEV_PREFIX + module_id)
    except Exception:
        logger.debug("clear_trip_count failed id=%s", module_id, exc_info=True)


async def get_trip_meta(module_id: str) -> dict[str, int | str]:
    """admin UI 用：回傳跳閘次數與本窗口內最高嚴重度。"""
    count, sev = await _get_trip_count(module_id)
    return {"trip_count": count, "max_severity": sev}


def recent_trip_events(module_id: str) -> list[dict[str, float | str | int | bool]]:
    """回傳目前 worker 記錄的最近跳閘事件，最新事件在前。"""
    with _lock:
        return list(reversed(_trip_history.get(module_id, ())))


async def maybe_trip_module(module_id: str) -> None:
    """超過門檻時自動將模組設為 auto 維護（帶 cooldown TTL）。

    呼叫於 request 中介層的 finally；常見路徑（未達門檻）不碰 Redis。
    流程：
      1. 視窗內 5xx 數 < 觸發門檻 → return（快路徑）
      2. 取最大嚴重度與升級窗口次數 → 決定 cooldown / 是否升級 manual
      3. 寫入 Redis 維護狀態 + 排程 half-open 探測
    """
    threshold = settings.MODULE_CIRCUIT_5XX_THRESHOLD
    if module_5xx_count(module_id) < threshold:
        return

    now = time.time()
    if _tripped_until.get(module_id, 0.0) > now:
        return  # cooldown 內，已跳閘過

    reset_at = await get_module_reset(module_id)
    if _count_since(module_id, reset_at) < threshold:
        return  # 重置後的有效樣本未達門檻

    existing = await get_module_maintenance(module_id)
    if existing and existing.get("source") == "manual":
        return  # 手動維護優先，不被自動覆蓋

    # 取本輪事件最高嚴重度（決定升級門檻）
    window_severity = _max_severity_since(module_id, reset_at)
    new_count, max_sev = await _bump_trip_count(module_id, window_severity)
    escalation_threshold = _threshold_for_severity(max_sev)

    if new_count >= escalation_threshold:
        # 升級為 manual — 需要管理員手動恢復
        reason = (
            f"連續跳閘 {new_count} 次 / 1h（最高嚴重度 {max_sev}），"
            "已升級為手動維護，需要管理員介入"
        )
        await set_module_maintenance(
            module_id,
            on=True,
            source="manual",
            reason=reason,
        )
        # cooldown 沒意義（manual 不會自動恢復），但仍標記避免 per-worker 重跑
        _tripped_until[module_id] = now + settings.MODULE_CIRCUIT_COOLDOWN_MAX_SECONDS
        await _notify_and_broadcast(
            module_id, escalated=True, severity=max_sev, count=new_count, cooldown_s=0
        )
        return

    cooldown = _cooldown_for_trip_count(new_count)
    await set_module_maintenance(
        module_id,
        on=True,
        source="auto",
        reason=f"自動偵測大量錯誤（{max_sev}），暫停 {cooldown}s 後嘗試恢復",
        ttl=cooldown,
    )
    _tripped_until[module_id] = now + cooldown

    # 排程 half-open 探測（cooldown 結束時觸發）
    await _schedule_probe(module_id, after_seconds=cooldown)
    await _notify_and_broadcast(
        module_id, escalated=False, severity=max_sev, count=new_count, cooldown_s=cooldown
    )


async def _schedule_probe(module_id: str, *, after_seconds: int) -> None:
    """寫入 Redis ZSET 排程；recovery_tasks 會掃並執行。"""
    from api.core.security import redis_client

    try:
        await redis_client.zadd("module_probe_queue", {module_id: time.time() + after_seconds})
    except Exception:
        logger.debug("_schedule_probe failed id=%s", module_id, exc_info=True)


async def _notify_and_broadcast(
    module_id: str, *, escalated: bool, severity: str, count: int, cooldown_s: int
) -> None:
    """跳閘通知：WebSocket 即時 + outbox 分派 Discord/Email/UI 通知。"""
    with _lock:
        _trip_history[module_id].append(
            {
                "timestamp": time.time(),
                "severity": severity,
                "trip_count": count,
                "cooldown_s": cooldown_s,
                "escalated": escalated,
            }
        )

    try:
        from api.core.ws_manager import manager as ws_manager

        await ws_manager.broadcast_all(
            {
                "type": "module_maintenance",
                "module": module_id,
                "on": True,
                "source": "manual" if escalated else "auto",
                "severity": severity,
                "trip_count": count,
                "escalated": escalated,
            }
        )
    except Exception:
        logger.debug("ws broadcast failed", exc_info=True)

    try:
        from api.core import module_recovery

        await module_recovery.notify_module_tripped(
            module_id,
            severity=severity,
            count=count,
            cooldown_s=cooldown_s,
            escalated=escalated,
        )
    except Exception:
        logger.debug("notify_module_tripped failed", exc_info=True)
