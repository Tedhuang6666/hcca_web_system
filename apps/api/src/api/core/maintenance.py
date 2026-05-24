"""維護模式 + Feature Flag — Redis-backed，5s LRU cache 攤平讀取壓力。

設計選擇：全部用 Redis key（即時生效、重啟即失效，符合「緊急工具」屬性）；
非緊急、需要稽核軌跡的長期設定才用 DB 表。
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from fastapi import HTTPException, status
from redis.exceptions import RedisError

from api.core.security import redis_client

logger = logging.getLogger(__name__)

MAINTENANCE_KEY = "system:maintenance_mode"
FEATURE_FLAG_PREFIX = "feature_flag:"
LOAD_SHED_MODE_KEY = "load_shed:force_mode"

# 預設可用的 feature flag 清單（顯示給 admin UI 用）。
# True 代表「啟用」（功能可用）；缺值時預設啟用，避免新部署誤關。
FEATURE_FLAGS_DEFAULT: dict[str, str] = {
    "feature:file_upload": "檔案上傳",
    "feature:document_export_pdf": "公文 PDF 匯出",
    "feature:document_export_excel": "公文 Excel 匯出",
    "feature:meal_order_create": "建立學餐訂單",
    "feature:survey_submit": "送出問卷答覆",
    "feature:meeting_vote": "議事投票",
}

_LOCAL_CACHE_TTL = 5.0
_cache: dict[str, tuple[float, Any]] = {}


def _cache_get(key: str) -> Any | None:
    item = _cache.get(key)
    if item is None:
        return None
    expires, value = item
    if expires < time.monotonic():
        _cache.pop(key, None)
        return None
    return value


def _cache_set(key: str, value: Any) -> None:
    _cache[key] = (time.monotonic() + _LOCAL_CACHE_TTL, value)


def clear_cache() -> None:
    """測試/手動觸發用：清本地快取讓下個 request 立即生效。"""
    _cache.clear()


# ── Maintenance Mode ────────────────────────────────────────────────────────


async def get_maintenance_state() -> dict[str, Any]:
    """讀取維護模式狀態：{enabled, message, until}（until 可為 None = 無限制）"""
    cached = _cache_get(MAINTENANCE_KEY)
    if cached is not None:
        return cached
    try:
        raw = await redis_client.get(MAINTENANCE_KEY)
    except RedisError:
        return {"enabled": False, "message": "", "until": None}

    if not raw:
        state = {"enabled": False, "message": "", "until": None}
    else:
        try:
            state = json.loads(raw)
            # 過期自動關閉
            until = state.get("until")
            if until and until < time.time():
                state = {"enabled": False, "message": "", "until": None}
        except (json.JSONDecodeError, TypeError):
            state = {"enabled": False, "message": "", "until": None}
    _cache_set(MAINTENANCE_KEY, state)
    return state


async def set_maintenance_mode(
    *, enabled: bool, message: str = "", until: float | None = None
) -> dict[str, Any]:
    payload = json.dumps({"enabled": enabled, "message": message, "until": until})
    try:
        await redis_client.set(MAINTENANCE_KEY, payload)
    except RedisError:
        logger.error("set_maintenance_mode failed", exc_info=True)
    _cache.pop(MAINTENANCE_KEY, None)
    return {"enabled": enabled, "message": message, "until": until}


# ── Feature Flags ───────────────────────────────────────────────────────────


async def is_feature_enabled(key: str, *, default: bool = True) -> bool:
    """檢查 feature 是否開啟；預設開啟以避免新部署誤關。"""
    cached = _cache_get(FEATURE_FLAG_PREFIX + key)
    if cached is not None:
        return cached

    try:
        raw = await redis_client.get(FEATURE_FLAG_PREFIX + key)
    except RedisError:
        return default

    enabled = default if raw is None else raw == "1"
    _cache_set(FEATURE_FLAG_PREFIX + key, enabled)
    return enabled


async def set_feature_flag(key: str, *, enabled: bool) -> None:
    try:
        await redis_client.set(FEATURE_FLAG_PREFIX + key, "1" if enabled else "0")
    except RedisError:
        logger.error("set_feature_flag failed key=%s", key, exc_info=True)
    _cache.pop(FEATURE_FLAG_PREFIX + key, None)


async def list_feature_flags() -> list[dict[str, Any]]:
    """回傳所有預設 flag 與當前值（給 admin 後台顯示）。"""
    out: list[dict[str, Any]] = []
    for key, desc in FEATURE_FLAGS_DEFAULT.items():
        enabled = await is_feature_enabled(key, default=True)
        out.append({"key": key, "description": desc, "enabled": enabled})
    return out


def require_feature(key: str):
    """FastAPI dependency：flag=false 時 raise 503。

    用法：
        @router.post("/upload", dependencies=[Depends(require_feature("feature:file_upload"))])
    """

    async def _checker() -> None:
        if not await is_feature_enabled(key):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"功能暫時停用：{FEATURE_FLAGS_DEFAULT.get(key, key)}",
                headers={"Retry-After": "60"},
            )

    return _checker


# ── Load Shed Force Mode（admin 手動覆蓋自動判斷） ─────────────────────────


async def get_load_shed_force_mode() -> str:
    """回傳 'off' | 'auto' | 'on' | 'bypass'（預設 auto）"""
    cached = _cache_get(LOAD_SHED_MODE_KEY)
    if cached is not None:
        return cached
    try:
        raw = await redis_client.get(LOAD_SHED_MODE_KEY)
    except RedisError:
        return "auto"
    mode = raw if raw in {"off", "auto", "on", "bypass"} else "auto"
    _cache_set(LOAD_SHED_MODE_KEY, mode)
    return mode


async def set_load_shed_force_mode(mode: str) -> str:
    if mode not in {"off", "auto", "on", "bypass"}:
        raise ValueError(f"Invalid load shed mode: {mode}")
    try:
        await redis_client.set(LOAD_SHED_MODE_KEY, mode)
    except RedisError:
        logger.error("set_load_shed_force_mode failed", exc_info=True)
    _cache.pop(LOAD_SHED_MODE_KEY, None)
    return mode
