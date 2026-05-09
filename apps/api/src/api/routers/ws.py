"""WebSocket 路由 - 房間訂閱與即時推播"""

import logging
import uuid

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, status
from jwt.exceptions import InvalidTokenError
from sqlalchemy import select

from api.core.database import AsyncSessionLocal
from api.core.security import decode_token, is_blacklisted
from api.core.ws_manager import manager
from api.dependencies.auth import get_current_active_user
from api.services.permission import get_user_permission_codes

logger = logging.getLogger(__name__)

router = APIRouter(tags=["WebSocket"])

# ── 認證輔助 ─────────────────────────────────────────────────────────────────


def _ws_token_from_websocket(websocket: WebSocket) -> str | None:
    token_qs = websocket.query_params.get("token")
    if token_qs:
        return token_qs
    auth = websocket.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:]
    return websocket.cookies.get("hcca_access_token")


async def _authenticate_ws(websocket: WebSocket) -> str | None:
    """
    驗證 WebSocket 連線的 JWT Token（優先使用 Authorization header，否則使用 HttpOnly cookie）。
    回傳 user_id 字串；若驗證失敗則關閉連線並回傳 None。
    """
    token = _ws_token_from_websocket(websocket)
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


async def _assert_room_access(room: str, user_id: str) -> None:
    """
    房間授權規則：
    - user:{uuid}：只能加入自己的房間；admin:all 例外
    - org:{uuid}：必須是該 org 成員；admin:all 例外
    - 其他房間：任何已登入者可加入
    """
    try:
        user_uuid = uuid.UUID(user_id)
    except ValueError as e:
        raise PermissionError("無效的使用者識別") from e

    async with AsyncSessionLocal() as db:
        codes = await get_user_permission_codes(db, user_id)
        if "admin:all" in codes:
            return

        if room.startswith("user:"):
            target = uuid.UUID(room.split(":", 1)[1])
            if target != user_uuid:
                raise PermissionError("無權加入此使用者房間")
            return

        if room.startswith("org:"):
            org_id = uuid.UUID(room.split(":", 1)[1])
            from api.models.org import Position, UserPosition

            is_member = await db.scalar(
                select(UserPosition.id)
                .join(Position, UserPosition.position_id == Position.id)
                .where(UserPosition.user_id == user_uuid, Position.org_id == org_id)
                .limit(1)
            )
            if not is_member:
                raise PermissionError("無權加入此組織房間")
            return


# ── WebSocket 端點 ────────────────────────────────────────────────────────────


@router.websocket("/ws/{room}")
async def websocket_room(
    websocket: WebSocket,
    room: str,
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
    user_id = await _authenticate_ws(websocket)
    if user_id is None:
        return

    try:
        await _assert_room_access(room, user_id)
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="無權加入此房間")
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
                # 特殊類型：全域廣播，僅允許擁有 admin:all 權限的使用者
                async with AsyncSessionLocal() as db:
                    codes = await get_user_permission_codes(db, user_id)
                if "admin:all" not in codes:
                    await websocket.send_json(
                        manager.build_message(
                            "error", {"detail": "需要 admin:all 權限才能執行全域廣播"}, room=room
                        )
                    )
                else:
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


@router.get(
    "/ws/rooms",
    summary="列出所有活躍 WebSocket 房間",
    dependencies=[Depends(get_current_active_user)],
)
async def list_ws_rooms() -> dict[str, object]:
    """回傳目前所有活躍房間與連線統計"""
    return {
        "rooms": manager.list_rooms(),
        "total_connections": manager.total_connections(),
    }
