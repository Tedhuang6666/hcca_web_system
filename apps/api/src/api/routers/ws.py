"""WebSocket 路由 - 房間訂閱與即時推播"""

import logging

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect, status
from jwt.exceptions import InvalidTokenError

from api.core.security import decode_token, is_blacklisted
from api.core.ws_manager import manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["WebSocket"])

# ── 認證輔助 ─────────────────────────────────────────────────────────────────


async def _authenticate_ws(websocket: WebSocket, token: str | None) -> str | None:
    """
    驗證 WebSocket 連線的 JWT Token（透過 Query Parameter 傳入）。
    回傳 user_id 字串；若驗證失敗則關閉連線並回傳 None。
    """
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="缺少認證 Token")
        return None

    try:
        if await is_blacklisted(token):
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Token 已登出")
            return None

        payload = decode_token(token)
        if payload.get("type") != "access":
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="無效的 Token 類型")
            return None

        return payload.get("sub")

    except InvalidTokenError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="無效的 Token")
        return None


# ── WebSocket 端點 ────────────────────────────────────────────────────────────


@router.websocket("/ws/{room}")
async def websocket_room(
    websocket: WebSocket,
    room: str,
    token: str | None = Query(None, description="JWT Access Token（URL Query Parameter）"),
) -> None:
    """
    加入指定房間的 WebSocket 連線。

    連線 URL 範例：
        ws://localhost:8000/ws/general?token=<access_token>

    訊息格式（客戶端送出）：
        { "type": "message", "data": { "text": "Hello" } }

    訊息格式（伺服器廣播）：
        { "type": "message", "room": "general", "sender": "<user_id>",
          "data": { "text": "Hello" }, "timestamp": "..." }
    """
    user_id = await _authenticate_ws(websocket, token)
    if user_id is None:
        return

    await manager.connect(websocket, room)

    # 通知房間其他人有新成員加入
    await manager.broadcast_to_room(
        room,
        manager.build_message("join", {"user_id": user_id}, room=room, sender=user_id),
    )

    try:
        while True:
            raw = await websocket.receive_json()

            msg_type: str = raw.get("type", "message")
            data: dict = raw.get("data", {})

            outbound = manager.build_message(msg_type, data, room=room, sender=user_id)

            if msg_type == "broadcast_all":
                # 特殊類型：全域廣播（僅供管理員使用，一般路由可加 RBAC 限制）
                await manager.broadcast_all(outbound)
            else:
                await manager.broadcast_to_room(room, outbound)

    except WebSocketDisconnect:
        manager.disconnect(websocket, room)
        await manager.broadcast_to_room(
            room,
            manager.build_message("leave", {"user_id": user_id}, room=room),
        )


# ── 管理端點（HTTP）──────────────────────────────────────────────────────────


@router.get("/ws/rooms", summary="列出所有活躍 WebSocket 房間")
async def list_ws_rooms() -> dict[str, object]:
    """回傳目前所有活躍房間與連線統計"""
    return {
        "rooms": manager.list_rooms(),
        "total_connections": manager.total_connections(),
    }
