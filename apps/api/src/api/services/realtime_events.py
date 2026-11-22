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


async def broadcast_public_urgent_changed(announcement_id: uuid.UUID | None) -> None:
    """通知公開頁面重新查詢目前可見的重要公告。"""
    await manager.broadcast_to_room(
        "public:announcements",
        {
            "type": "announcement.urgent_changed",
            "data": {"announcement_id": str(announcement_id) if announcement_id else None},
        },
    )
