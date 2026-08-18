"""小型即時事件廣播 helper。

事件只傳送識別與變更提示；需要完整資料的客戶端收到後再透過既有 HTTP API
重新驗證，避免 WebSocket 房間意外洩漏受限資料。
"""

from __future__ import annotations

import uuid

from api.core.ws_manager import manager


async def broadcast_user_event(
    user_id: uuid.UUID,
    event_type: str,
    data: dict[str, object] | None = None,
) -> None:
    """推送給單一使用者的即時變更提示。"""
    message: dict[str, object] = {"type": event_type}
    if data:
        message["data"] = data
    await manager.broadcast_to_room(f"user:{user_id}", message)


async def broadcast_seat_zone_changed(zone_id: uuid.UUID) -> None:
    """通知座位圖重新載入；不在事件本身攜帶個人化座位狀態。"""
    await manager.broadcast_to_room(
        f"seat-zone:{zone_id}",
        {
            "type": "seat_map.changed",
            "data": {"zone_id": str(zone_id)},
        },
    )


async def broadcast_order_updated(
    *,
    domain: str,
    order_id: uuid.UUID,
    user_id: uuid.UUID,
    status: str,
    is_paid: bool | None = None,
) -> None:
    """通知訂單本人與有管理權限的訂單工作台重新載入。"""
    data: dict[str, object] = {
        "domain": domain,
        "order_id": str(order_id),
        "status": status,
    }
    if is_paid is not None:
        data["is_paid"] = is_paid
    message = {"type": "order.updated", "data": data}
    await manager.broadcast_to_room(f"user:{user_id}", message)
    await manager.broadcast_to_room(f"{domain}:orders", message)


async def broadcast_public_urgent_changed(announcement_id: uuid.UUID | None) -> None:
    """通知公開頁面重新查詢目前可見的重要公告。"""
    await manager.broadcast_to_room(
        "public:announcements",
        {
            "type": "announcement.urgent_changed",
            "data": {"announcement_id": str(announcement_id) if announcement_id else None},
        },
    )
