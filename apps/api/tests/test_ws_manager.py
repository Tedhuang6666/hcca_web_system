"""WebSocket ConnectionManager 單元測試"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from api.core.ws_manager import ConnectionManager


def _make_ws() -> MagicMock:
    """建立 MockWebSocket"""
    ws = MagicMock()
    ws.accept = AsyncMock()
    ws.send_json = AsyncMock()
    return ws


@pytest.mark.asyncio
async def test_connect_adds_to_room() -> None:
    """connect 應接受連線並加入房間"""
    mgr = ConnectionManager()
    ws = _make_ws()

    await mgr.connect(ws, "room-a")

    assert mgr.room_count("room-a") == 1
    ws.accept.assert_awaited_once()


@pytest.mark.asyncio
async def test_disconnect_removes_from_room() -> None:
    """disconnect 應移除連線；房間空時清除房間鍵"""
    mgr = ConnectionManager()
    ws = _make_ws()
    await mgr.connect(ws, "room-a")

    mgr.disconnect(ws, "room-a")

    assert mgr.room_count("room-a") == 0
    assert "room-a" not in mgr._rooms


@pytest.mark.asyncio
async def test_broadcast_to_room_sends_to_all() -> None:
    """broadcast_to_room 應廣播給同房間所有連線"""
    mgr = ConnectionManager()
    ws1, ws2 = _make_ws(), _make_ws()
    await mgr.connect(ws1, "room-b")
    await mgr.connect(ws2, "room-b")

    msg = {"type": "message", "data": {"text": "hi"}}
    await mgr.broadcast_to_room("room-b", msg)

    ws1.send_json.assert_awaited_once_with(msg)
    ws2.send_json.assert_awaited_once_with(msg)


@pytest.mark.asyncio
async def test_broadcast_all_reaches_every_room() -> None:
    """broadcast_all 應廣播到每個房間"""
    mgr = ConnectionManager()
    ws_a, ws_b = _make_ws(), _make_ws()
    await mgr.connect(ws_a, "room-a")
    await mgr.connect(ws_b, "room-b")

    msg = {"type": "notification", "data": {"text": "全域"}}
    await mgr.broadcast_all(msg)

    ws_a.send_json.assert_awaited_once_with(msg)
    ws_b.send_json.assert_awaited_once_with(msg)


@pytest.mark.asyncio
async def test_broadcast_skips_dead_connections() -> None:
    """廣播時若連線已斷，應自動移除而不拋出例外"""
    mgr = ConnectionManager()
    ws_dead = _make_ws()
    ws_dead.send_json = AsyncMock(side_effect=RuntimeError("連線已關閉"))
    ws_alive = _make_ws()

    await mgr.connect(ws_dead, "room-c")
    await mgr.connect(ws_alive, "room-c")

    msg = {"type": "message", "data": {}}
    await mgr.broadcast_to_room("room-c", msg)  # 不應拋出例外

    ws_alive.send_json.assert_awaited_once_with(msg)
    # 死連線應被移除
    assert ws_dead not in mgr._rooms.get("room-c", set())


def test_total_connections() -> None:
    """total_connections 應回傳跨所有房間的總連線數"""
    mgr = ConnectionManager()
    # 直接插入以避免 async
    mgr._rooms["r1"] = {MagicMock(), MagicMock()}
    mgr._rooms["r2"] = {MagicMock()}

    assert mgr.total_connections() == 3


def test_list_rooms() -> None:
    """list_rooms 應回傳所有房間資訊"""
    mgr = ConnectionManager()
    mgr._rooms["alpha"] = {MagicMock(), MagicMock()}
    mgr._rooms["beta"] = {MagicMock()}

    rooms = mgr.list_rooms()
    room_map = {r["room"]: r["connections"] for r in rooms}

    assert room_map["alpha"] == 2
    assert room_map["beta"] == 1


def test_build_message_format() -> None:
    """build_message 應回傳正確的標準化訊息格式"""
    msg = ConnectionManager.build_message("message", {"text": "Hello"}, room="test", sender="u1")

    assert msg["type"] == "message"
    assert msg["room"] == "test"
    assert msg["sender"] == "u1"
    assert msg["data"] == {"text": "Hello"}
    assert "timestamp" in msg
