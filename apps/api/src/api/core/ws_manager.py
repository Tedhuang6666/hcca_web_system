"""WebSocket 連線管理員 - 房間分組、全域廣播、連線上限、心跳、跨 worker pub/sub"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections import defaultdict
from datetime import UTC, datetime

from fastapi import WebSocket

from api.core.config import settings

logger = logging.getLogger(__name__)

# Redis pub/sub channel：全域單一頻道，訊息含 room/all 路由欄位
_PUBSUB_CHANNEL = "ws:broadcast"


class WSCapacityError(Exception):
    """連線數達上限時拋出，由 router 轉為 close code 1013（Try Again Later）。"""

    def __init__(self, scope: str, reason: str) -> None:
        super().__init__(reason)
        self.scope = scope  # "global" | "per_ip" | "per_room"
        self.reason = reason


class ConnectionManager:
    """
    管理所有活躍的 WebSocket 連線。

    結構：
      - _rooms[room_id] = set of WebSocket
      - _ip_connections[ip] = set of WebSocket（per-IP 限額用）
      - _last_pong[ws] = monotonic ts（心跳超時偵測用）

    特色：
      - 房間隔離廣播 / 全域廣播
      - 三層連線上限：global / per_ip / per_room
      - 應用層心跳（ping/pong），超時自動斷線
      - 自動清理斷線客戶端
    """

    def __init__(
        self,
        *,
        global_max: int | None = None,
        per_ip_max: int | None = None,
        per_room_max: int | None = None,
        heartbeat_interval: int | None = None,
        heartbeat_timeout: int | None = None,
    ) -> None:
        self._rooms: dict[str, set[WebSocket]] = defaultdict(set)
        self._ip_connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._ws_meta: dict[WebSocket, tuple[str, str]] = {}  # ws -> (room, ip)
        self._last_pong: dict[WebSocket, float] = {}
        self._heartbeat_tasks: dict[WebSocket, asyncio.Task] = {}

        self._global_max = (
            global_max if global_max is not None else settings.WS_GLOBAL_MAX_CONNECTIONS
        )
        self._per_ip_max = (
            per_ip_max if per_ip_max is not None else settings.WS_PER_IP_MAX_CONNECTIONS
        )
        self._per_room_max = (
            per_room_max if per_room_max is not None else settings.WS_PER_ROOM_MAX_CONNECTIONS
        )
        self._hb_interval = (
            heartbeat_interval
            if heartbeat_interval is not None
            else settings.WS_HEARTBEAT_INTERVAL_SECONDS
        )
        self._hb_timeout = (
            heartbeat_timeout
            if heartbeat_timeout is not None
            else settings.WS_HEARTBEAT_TIMEOUT_SECONDS
        )

    # ── 連線生命週期 ────────────────────────────────────────────────────────

    def _check_capacity(self, room: str, client_ip: str) -> None:
        """在 accept() 前檢查三層上限；超過直接拋 WSCapacityError。"""
        if self.total_connections() >= self._global_max:
            raise WSCapacityError("global", f"伺服器 WebSocket 連線數已達上限 ({self._global_max})")
        if len(self._ip_connections.get(client_ip, ())) >= self._per_ip_max:
            raise WSCapacityError("per_ip", f"來源 IP 連線數已達上限 ({self._per_ip_max})")
        if len(self._rooms.get(room, ())) >= self._per_room_max:
            raise WSCapacityError("per_room", f"此房間連線數已達上限 ({self._per_room_max})")

    async def connect(self, websocket: WebSocket, room: str, client_ip: str) -> None:
        """檢查上限 → accept → 註冊 → 啟動心跳任務。"""
        self._check_capacity(room, client_ip)
        await websocket.accept()
        self._rooms[room].add(websocket)
        self._ip_connections[client_ip].add(websocket)
        self._ws_meta[websocket] = (room, client_ip)
        self._last_pong[websocket] = asyncio.get_event_loop().time()
        self._heartbeat_tasks[websocket] = asyncio.create_task(self._heartbeat_loop(websocket))
        logger.debug(
            "WS 連線建立 room=%s ip=%s total=%d room_count=%d ip_count=%d",
            room,
            client_ip,
            self.total_connections(),
            self.room_count(room),
            len(self._ip_connections[client_ip]),
        )
        from api.core.prometheus_metrics import set_websocket_connections

        set_websocket_connections(self.total_connections())

    def disconnect(self, websocket: WebSocket, room: str) -> None:
        """移除連線並停心跳任務；若房間/IP 集合空了則清除 key。"""
        self._rooms[room].discard(websocket)
        if not self._rooms[room]:
            del self._rooms[room]

        meta = self._ws_meta.pop(websocket, None)
        if meta:
            _, client_ip = meta
            self._ip_connections[client_ip].discard(websocket)
            if not self._ip_connections[client_ip]:
                del self._ip_connections[client_ip]

        self._last_pong.pop(websocket, None)
        hb_task = self._heartbeat_tasks.pop(websocket, None)
        if hb_task and not hb_task.done():
            hb_task.cancel()

        logger.debug("WS 連線中斷 room=%s remaining=%d", room, self.room_count(room))
        from api.core.prometheus_metrics import set_websocket_connections

        set_websocket_connections(self.total_connections())

    def notify_pong(self, websocket: WebSocket) -> None:
        """前端回 pong 時呼叫，更新最後活躍時間。"""
        if websocket in self._ws_meta:
            self._last_pong[websocket] = asyncio.get_event_loop().time()

    async def _heartbeat_loop(self, websocket: WebSocket) -> None:
        """每隔 hb_interval 秒送 ping；若距上次 pong > hb_timeout 則主動斷線。"""
        try:
            while websocket in self._ws_meta:
                await asyncio.sleep(self._hb_interval)
                if websocket not in self._ws_meta:
                    return
                last = self._last_pong.get(websocket, 0.0)
                now = asyncio.get_event_loop().time()
                if now - last > self._hb_timeout:
                    logger.info("WS 心跳超時，主動斷線 idle=%.0fs", now - last)
                    with contextlib.suppress(Exception):
                        await websocket.close(code=1011, reason="heartbeat timeout")
                    return
                try:
                    await websocket.send_json({"type": "ping"})
                except Exception:
                    # send 失敗代表連線已死，由 router 的 WebSocketDisconnect 接手清理
                    return
        except asyncio.CancelledError:
            pass

    # ── 廣播 ────────────────────────────────────────────────────────────────
    # 多 worker / 多節點環境下，本機 dict 只看得到自己的連線。
    # broadcast_to_room / broadcast_all 預設經 Redis pub/sub 重新分發，讓所有
    # worker 都有機會把訊息傳給自己持有的連線。WS_PUBSUB_BACKEND=memory 時
    # 僅廣播至目前 worker，供單 worker 開發與測試使用。

    async def broadcast_to_room(self, room: str, message: dict) -> None:
        """廣播給指定房間：經 Redis 跨 worker；無 broker 時退回本機。"""
        if _broker is not None:
            await _broker.publish({"target": "room", "room": room, "message": message})
        else:
            await self._local_broadcast_to_room(room, message)

    async def broadcast_all(self, message: dict) -> None:
        """全域廣播：經 Redis 跨 worker；無 broker 時退回本機。"""
        if _broker is not None:
            await _broker.publish({"target": "all", "message": message})
        else:
            await self._local_broadcast_all(message)

    async def _local_broadcast_to_room(self, room: str, message: dict) -> None:
        """只送本 worker 內的連線；由 publish 訊息收到時呼叫。"""
        dead: set[WebSocket] = set()
        for ws in list(self._rooms.get(room, set())):
            try:
                await ws.send_json(message)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self._rooms[room].discard(ws)

    async def _local_broadcast_all(self, message: dict) -> None:
        for room in list(self._rooms):
            await self._local_broadcast_to_room(room, message)

    async def send_personal(self, websocket: WebSocket, message: dict) -> None:
        """傳送訊息給單一連線（不經 pub/sub）。"""
        await websocket.send_json(message)

    # ── 統計 ────────────────────────────────────────────────────────────────

    def room_count(self, room: str) -> int:
        return len(self._rooms.get(room, set()))

    def total_connections(self) -> int:
        return sum(len(ws_set) for ws_set in self._rooms.values())

    def list_rooms(self) -> list[dict[str, object]]:
        return [{"room": room, "connections": len(ws_set)} for room, ws_set in self._rooms.items()]

    def list_ip_counts(self) -> list[dict[str, object]]:
        """admin 觀察：每個 IP 的連線數，找異常爆量。"""
        return [
            {"ip": ip, "connections": len(ws_set)} for ip, ws_set in self._ip_connections.items()
        ]

    def stats(self) -> dict[str, object]:
        return {
            "total": self.total_connections(),
            "rooms": len(self._rooms),
            "unique_ips": len(self._ip_connections),
            "limits": {
                "global_max": self._global_max,
                "per_ip_max": self._per_ip_max,
                "per_room_max": self._per_room_max,
            },
        }

    @staticmethod
    def build_message(
        msg_type: str,
        data: dict,
        room: str = "",
        sender: str = "system",
    ) -> dict:
        """建立標準化 WebSocket 訊息格式"""
        return {
            "type": msg_type,
            "room": room,
            "sender": sender,
            "data": data,
            "timestamp": datetime.now(UTC).isoformat(),
        }


# 全域單例（在 FastAPI app 生命週期內共用）
manager = ConnectionManager()


# ── Redis pub/sub broker ────────────────────────────────────────────────────


class _RedisBroker:
    """每個 worker 啟動時 subscribe 同一個 channel，收到訊息就分發給本機連線。

    廣播流程：worker A `manager.broadcast_to_room(room, msg)` →
      publish ws:broadcast {target:room, room, message} →
      所有 worker 的 listener 收到 → 各自 `_local_broadcast_to_room`。
    """

    def __init__(self, mgr: ConnectionManager) -> None:
        self._mgr = mgr
        self._pubsub = None
        self._task: asyncio.Task | None = None
        self._stopping = asyncio.Event()

    async def start(self) -> None:
        from api.core.security import redis_client

        self._pubsub = redis_client.pubsub()
        await self._pubsub.subscribe(_PUBSUB_CHANNEL)
        self._task = asyncio.create_task(self._listen(), name="ws_pubsub_listener")
        logger.debug("WS Redis pub/sub listener started")

    async def stop(self) -> None:
        self._stopping.set()
        if self._task and not self._task.done():
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        if self._pubsub is not None:
            with contextlib.suppress(Exception):
                await self._pubsub.unsubscribe(_PUBSUB_CHANNEL)
                await self._pubsub.aclose()
        logger.debug("WS Redis pub/sub listener stopped")

    async def publish(self, payload: dict) -> None:
        from api.core.security import redis_client

        try:
            await redis_client.publish(_PUBSUB_CHANNEL, json.dumps(payload))
        except Exception:
            # publish 失敗：退回本機廣播以維持單機可用性
            logger.warning("WS pub/sub publish failed, falling back to local", exc_info=True)
            target = payload.get("target")
            message = payload.get("message", {})
            if target == "room":
                await self._mgr._local_broadcast_to_room(payload.get("room", ""), message)
            elif target == "all":
                await self._mgr._local_broadcast_all(message)

    async def _listen(self) -> None:
        if self._pubsub is None:
            raise RuntimeError("WebSocket pubsub 尚未初始化")
        try:
            while not self._stopping.is_set():
                msg = await self._pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if msg is None:
                    continue
                if msg.get("type") not in ("message", "pmessage"):
                    continue
                raw = msg.get("data")
                if not raw:
                    continue
                try:
                    payload = json.loads(raw)
                except (json.JSONDecodeError, TypeError):
                    continue
                target = payload.get("target")
                message = payload.get("message", {})
                if target == "room":
                    await self._mgr._local_broadcast_to_room(payload.get("room", ""), message)
                elif target == "all":
                    await self._mgr._local_broadcast_all(message)
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("WS pub/sub listener crashed")


_broker: _RedisBroker | None = None


async def setup_broker() -> None:
    """在 FastAPI lifespan 啟動階段呼叫。WS_PUBSUB_BACKEND=memory 時不啟動。"""
    global _broker
    if settings.WS_PUBSUB_BACKEND != "redis":
        logger.info("WS pub/sub backend=%s (broker disabled)", settings.WS_PUBSUB_BACKEND)
        return
    if _broker is not None:
        return
    broker = _RedisBroker(manager)
    try:
        await broker.start()
    except Exception:
        logger.exception("Failed to start WS pub/sub broker; falling back to local-only")
        return
    _broker = broker


async def shutdown_broker() -> None:
    global _broker
    if _broker is None:
        return
    await _broker.stop()
    _broker = None
