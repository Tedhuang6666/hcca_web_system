"""Discord bot 跨行程控制通道。

Bot 是獨立行程（`python -m api.discord_worker`），與 API / Celery 不同進程，因此後台
要管理 cog（啟用/卸載/重啟）與整機重啟時，必須透過 Redis 做行程間通訊：

- **狀態心跳**：bot 每 ~10s 把線上狀態與 cog 載入情形寫進 `discord:bot:status`（帶 TTL），
  後台直接讀此 key 即可即時渲染，免去每次 round-trip。
- **控制指令**：API 把指令 publish 到 `discord:control` pub/sub channel，bot 收到後執行，
  並把結果 rpush 到 `discord:control:reply:<req_id>`；API 端用 BLPOP 等回覆。

所有函式皆走 `api.core.security.redis_client`（redis.asyncio, decode_responses=True）。
"""

from __future__ import annotations

import json
import secrets
from typing import Any

import redis.asyncio as aioredis

from api.core.config import settings

# 專用連線：pub/sub 與 BLPOP 等「阻塞」操作不能共用 api.core.security.redis_client，
# 因為那個 client 設了 socket_timeout —— idle 時 pubsub.listen() 的 socket read 會在
# timeout 到期時拋 TimeoutError，把控制 listener 打斷；BLPOP 阻塞超過 socket_timeout
# 也會拋錯。這裡用 socket_timeout=None 的獨立連線專供控制通道使用。
_blocking_redis: aioredis.Redis = aioredis.from_url(
    str(settings.REDIS_URL),
    encoding="utf-8",
    decode_responses=True,
    socket_timeout=None,
    socket_connect_timeout=settings.REDIS_SOCKET_TIMEOUT,
    health_check_interval=settings.REDIS_HEALTH_CHECK_INTERVAL,
)


def get_pubsub() -> aioredis.client.PubSub:
    """取得控制通道專用的 pub/sub（無 socket_timeout，idle 不會被打斷）。"""
    return _blocking_redis.pubsub()


CONTROL_CHANNEL = "discord:control"
BOT_STATUS_KEY = "discord:bot:status"
BOT_STATUS_TTL_SECONDS = 30
_REPLY_PREFIX = "discord:control:reply:"
_REPLY_TTL_SECONDS = 30

# 支援的控制動作
ACTION_LIST_COGS = "list_cogs"
ACTION_LOAD_COG = "load_cog"
ACTION_UNLOAD_COG = "unload_cog"
ACTION_RELOAD_COG = "reload_cog"
ACTION_SOFT_RESTART = "soft_restart"
ACTION_HARD_RESTART = "hard_restart"


# ── API 端（發指令、讀狀態）────────────────────────────────────────────────────


async def read_bot_status() -> dict[str, Any] | None:
    """讀 bot 心跳狀態；無資料（bot 離線或未寫過）回 None。"""
    raw = await _blocking_redis.get(BOT_STATUS_KEY)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return None


async def request_control(action: str, *, timeout: float = 6.0, **kwargs: Any) -> dict[str, Any]:
    """發送控制指令並等待 bot 回覆。

    回傳 bot 的回覆 dict；逾時則回 `{"ok": False, "error": "timeout"}`（代表 bot 可能離線）。
    """
    req_id = secrets.token_urlsafe(12)
    message = json.dumps({"req_id": req_id, "action": action, **kwargs})
    reply_key = f"{_REPLY_PREFIX}{req_id}"
    try:
        receivers = await _blocking_redis.publish(CONTROL_CHANNEL, message)
        if not receivers:
            return {"ok": False, "error": "bot_offline", "detail": "沒有 bot 行程訂閱控制頻道"}
        popped = await _blocking_redis.blpop(reply_key, timeout=int(max(1, timeout)))
    except Exception as exc:  # redis 連線/逾時等
        return {"ok": False, "error": "redis_error", "detail": str(exc)}
    if popped is None:
        return {"ok": False, "error": "timeout", "detail": "bot 未在時限內回覆"}
    _key, raw = popped
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return {"ok": False, "error": "bad_reply"}


# ── Bot 端（寫狀態、回覆）──────────────────────────────────────────────────────


async def write_bot_status(payload: dict[str, Any]) -> None:
    """bot 心跳：寫入狀態並設定 TTL（過期即視為離線）。"""
    await _blocking_redis.set(BOT_STATUS_KEY, json.dumps(payload), ex=BOT_STATUS_TTL_SECONDS)


async def send_control_reply(req_id: str, payload: dict[str, Any]) -> None:
    """bot 執行完控制指令後回覆 API（rpush + 短 TTL，配合 API 的 BLPOP）。"""
    reply_key = f"{_REPLY_PREFIX}{req_id}"
    await _blocking_redis.rpush(reply_key, json.dumps(payload))
    await _blocking_redis.expire(reply_key, _REPLY_TTL_SECONDS)


__all__ = [
    "ACTION_HARD_RESTART",
    "ACTION_LIST_COGS",
    "ACTION_LOAD_COG",
    "ACTION_RELOAD_COG",
    "ACTION_SOFT_RESTART",
    "ACTION_UNLOAD_COG",
    "BOT_STATUS_KEY",
    "BOT_STATUS_TTL_SECONDS",
    "CONTROL_CHANNEL",
    "get_pubsub",
    "read_bot_status",
    "request_control",
    "send_control_reply",
    "write_bot_status",
]
