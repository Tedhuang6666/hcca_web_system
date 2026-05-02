"""WebSocket 連線管理員 - 支援房間分組與全域廣播"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import UTC, datetime

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """
    管理所有活躍的 WebSocket 連線。

    結構：_rooms[room_id] = set of WebSocket
    特色：
      - 房間隔離廣播
      - 全域廣播
      - 自動清理斷線客戶端
    """

    def __init__(self) -> None:
        self._rooms: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, websocket: WebSocket, room: str) -> None:
        """接受連線並加入指定房間"""
        await websocket.accept()
        self._rooms[room].add(websocket)
        logger.info("WS 連線建立 room=%s total=%d", room, self.room_count(room))

    def disconnect(self, websocket: WebSocket, room: str) -> None:
        """移除連線；若房間空了則清除房間"""
        self._rooms[room].discard(websocket)
        if not self._rooms[room]:
            del self._rooms[room]
        logger.info("WS 連線中斷 room=%s remaining=%d", room, self.room_count(room))

    async def broadcast_to_room(self, room: str, message: dict) -> None:
        """廣播給指定房間的所有連線（自動移除斷線客戶端）"""
        dead: set[WebSocket] = set()
        for ws in list(self._rooms.get(room, set())):
            try:
                await ws.send_json(message)
            except Exception:
                dead.add(ws)

        for ws in dead:
            self._rooms[room].discard(ws)

    async def broadcast_all(self, message: dict) -> None:
        """全域廣播給所有房間的所有連線"""
        for room in list(self._rooms):
            await self.broadcast_to_room(room, message)

    async def send_personal(self, websocket: WebSocket, message: dict) -> None:
        """傳送訊息給單一連線"""
        await websocket.send_json(message)

    def room_count(self, room: str) -> int:
        """回傳指定房間的連線數"""
        return len(self._rooms.get(room, set()))

    def total_connections(self) -> int:
        """回傳全部連線數"""
        return sum(len(ws_set) for ws_set in self._rooms.values())

    def list_rooms(self) -> list[dict[str, object]]:
        """列出所有活躍房間與其連線數"""
        return [{"room": room, "connections": len(ws_set)} for room, ws_set in self._rooms.items()]

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
