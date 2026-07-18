"""WebSocket 路由 - 房間訂閱與即時推播"""

import logging
import uuid

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError
from sqlalchemy import select

from api.core.config import settings
from api.core.database import AsyncSessionLocal
from api.core.security import decode_token, is_blacklisted
from api.core.ws_manager import WSCapacityError, manager
from api.dependencies.permissions import require_permission
from api.services.permission import get_user_permission_codes

logger = logging.getLogger(__name__)

router = APIRouter(tags=["WebSocket"])
WS_CLOSE_AUTH_ERROR = 4001
WS_CLOSE_FORBIDDEN = 4003


@router.websocket("/ws/public/elections/{election_id}")
async def public_election_websocket(websocket: WebSocket, election_id: uuid.UUID) -> None:
    """公開唯讀開票推播；客戶端只能回覆心跳，不可廣播訊息。"""
    room = f"election:{election_id}"
    async with AsyncSessionLocal() as db:
        from api.models.election import Election

        election = await db.scalar(
            select(Election).where(Election.id == election_id, Election.is_public.is_(True))
        )
    if election is None:
        await websocket.close(code=4004, reason="找不到此公開選舉")
        return
    try:
        await manager.connect(websocket, room, _client_ip(websocket))
    except WSCapacityError as exc:
        await websocket.close(code=1013, reason=exc.reason)
        return
    try:
        while True:
            raw = await websocket.receive_json()
            if raw.get("type") == "pong":
                manager.notify_pong(websocket)
    except WebSocketDisconnect:
        manager.disconnect(websocket, room)


# ── 認證輔助 ─────────────────────────────────────────────────────────────────


def _ws_token_from_websocket(websocket: WebSocket) -> str | None:
    auth = websocket.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:]
    return websocket.cookies.get(settings.ACCESS_TOKEN_COOKIE_NAME)


async def _validate_ws_origin(websocket: WebSocket) -> bool:
    """Cookie 驗證的 WebSocket 必須來自明確允許的前端 origin。"""
    origin = websocket.headers.get("origin")
    if origin and origin in settings.ALLOWED_ORIGINS:
        return True
    await websocket.close(code=WS_CLOSE_FORBIDDEN, reason="不允許的 WebSocket Origin")
    return False


def _client_ip(websocket: WebSocket) -> str:
    """取真實 client IP（TrustedProxyMiddleware 已替換 scope["client"]）。"""
    return websocket.client.host if websocket.client else "unknown"


async def _authenticate_ws(websocket: WebSocket) -> str | None:
    """
    驗證 WebSocket 連線的 JWT Token（優先使用 Authorization header，否則使用 HttpOnly cookie）。
    回傳 user_id 字串；若驗證失敗則關閉連線並回傳 None。
    """
    token = _ws_token_from_websocket(websocket)
    if not token:
        await websocket.close(code=WS_CLOSE_AUTH_ERROR, reason="缺少認證 Token")
        return None

    try:
        if await is_blacklisted(token):
            await websocket.close(code=WS_CLOSE_AUTH_ERROR, reason="Token 已登出")
            return None

        payload = decode_token(token)
        if payload.get("type") != "access":
            await websocket.close(code=WS_CLOSE_AUTH_ERROR, reason="無效的 Token 類型")
            return None

        return payload.get("sub")

    except ExpiredSignatureError:
        await websocket.close(code=WS_CLOSE_AUTH_ERROR, reason="Token 已過期")
        return None
    except InvalidTokenError:
        await websocket.close(code=WS_CLOSE_AUTH_ERROR, reason="無效的 Token")
        return None


async def _assert_room_access(room: str, user_id: str) -> None:
    """
    房間授權規則（預設拒絕 default-deny）：
    - user:{uuid}：只能加入自己的房間；admin:all 例外
    - org:{uuid}：必須是該 org 成員；admin:all 例外
    - meeting:{uuid}：必須在該會議的出席名冊中
    - 其餘房間（election/document/petition/survey/...）：僅 admin:all

    安全：先前為「其他房間任何已登入者可加入」的 default-allow，導致任何已登入者
    （含外部 Google 帳號）可加入 election:/meeting:/petition: 等伺服器推播房間，
    讀取未公開選舉的即時票數、會議即時內容等敏感資料。公開開票請改用唯讀的
    /ws/public/elections/{id}（僅限 is_public 選舉）。
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

        if room.startswith("meeting:"):
            from api.models.meeting import MeetingAttendance

            meeting_id = uuid.UUID(room.split(":", 1)[1])
            is_attendee = await db.scalar(
                select(MeetingAttendance.id)
                .where(
                    MeetingAttendance.meeting_id == meeting_id,
                    MeetingAttendance.user_id == user_uuid,
                )
                .limit(1)
            )
            if not is_attendee:
                raise PermissionError("無權加入此會議房間")
            return

        # 預設拒絕：未明確授權的房間一律不得加入。
        raise PermissionError("無權加入此房間")


# ── WebSocket 端點 ────────────────────────────────────────────────────────────


@router.websocket("/ws/{room}")
async def websocket_room(
    websocket: WebSocket,
    room: str,
) -> None:
    """
    加入指定房間的 WebSocket 連線。

    連線 URL 範例：
        使用 HttpOnly auth cookie 或 Authorization header；不接受 URL query token。

    訊息格式（客戶端送出）：
        { "type": "message", "data": { "text": "Hello" } }
        { "type": "pong" }                          # 回應伺服器心跳

    訊息格式（伺服器廣播）：
        { "type": "message", "room": "general", "sender": "<user_id>",
          "data": { "text": "Hello" }, "timestamp": "..." }
        { "type": "ping" }                          # 伺服器心跳（前端必須回 pong）
    """
    if not await _validate_ws_origin(websocket):
        return
    user_id = await _authenticate_ws(websocket)
    if user_id is None:
        return

    try:
        await _assert_room_access(room, user_id)
    except Exception:
        await websocket.close(code=WS_CLOSE_FORBIDDEN, reason="無權加入此房間")
        return

    client_ip = _client_ip(websocket)
    try:
        await manager.connect(websocket, room, client_ip)
    except WSCapacityError as exc:
        logger.warning(
            "WS capacity hit scope=%s room=%s ip=%s reason=%s",
            exc.scope,
            room,
            client_ip,
            exc.reason,
        )
        # 1013 = Try Again Later；前端可依此 backoff 重試
        await websocket.close(code=1013, reason=exc.reason)
        return

    # 通知房間其他人有新成員加入
    await manager.broadcast_to_room(
        room,
        manager.build_message("join", {"user_id": user_id}, room=room, sender=user_id),
    )

    try:
        while True:
            raw = await websocket.receive_json()

            # 本端點為伺服器→客戶端單向推播：只處理心跳，其餘 client 訊息一律忽略，
            # 不轉發任何 client 廣播。先前會把 client 訊息廣播回房間，導致任何已登入者
            # 可注入/竄改房間訊息（例如對公開開票房間推送假的 election_update 票數）。
            # 真正的動作（投票等）一律走 HTTP 端點，不依賴 WS 上行訊息。
            if raw.get("type") == "pong":
                manager.notify_pong(websocket)

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
    dependencies=[Depends(require_permission("admin:all"))],
)
async def list_ws_rooms() -> dict[str, object]:
    """回傳目前所有活躍房間與連線統計"""
    return {
        "rooms": manager.list_rooms(),
        "total_connections": manager.total_connections(),
        "stats": manager.stats(),
    }
