"""WebSocket ConnectionManager 單元測試"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.core.ws_manager import ConnectionManager, WSCapacityError


def _make_ws() -> MagicMock:
    """建立 MockWebSocket"""
    ws = MagicMock()
    ws.accept = AsyncMock()
    ws.send_json = AsyncMock()
    ws.close = AsyncMock()
    return ws


def _mgr(**overrides) -> ConnectionManager:
    """測試用 manager：心跳間隔極大，避免後台 task 在測試中跑。"""
    defaults = {
        "global_max": 1000,
        "per_ip_max": 100,
        "per_room_max": 100,
        "heartbeat_interval": 3600,
        "heartbeat_timeout": 7200,
    }
    defaults.update(overrides)
    return ConnectionManager(**defaults)


@pytest.mark.asyncio
async def test_connect_adds_to_room() -> None:
    """connect 應接受連線並加入房間"""
    mgr = _mgr()
    ws = _make_ws()

    await mgr.connect(ws, "room-a", "1.2.3.4")

    assert mgr.room_count("room-a") == 1
    ws.accept.assert_awaited_once()
    mgr.disconnect(ws, "room-a")


@pytest.mark.asyncio
async def test_disconnect_removes_from_room() -> None:
    """disconnect 應移除連線；房間空時清除房間鍵"""
    mgr = _mgr()
    ws = _make_ws()
    await mgr.connect(ws, "room-a", "1.2.3.4")

    mgr.disconnect(ws, "room-a")

    assert mgr.room_count("room-a") == 0
    assert "room-a" not in mgr._rooms


@pytest.mark.asyncio
async def test_broadcast_to_room_sends_to_all() -> None:
    """broadcast_to_room 應廣播給同房間所有連線"""
    mgr = _mgr()
    ws1, ws2 = _make_ws(), _make_ws()
    await mgr.connect(ws1, "room-b", "1.1.1.1")
    await mgr.connect(ws2, "room-b", "2.2.2.2")

    msg = {"type": "message", "data": {"text": "hi"}}
    await mgr.broadcast_to_room("room-b", msg)

    ws1.send_json.assert_awaited_once_with(msg)
    ws2.send_json.assert_awaited_once_with(msg)
    mgr.disconnect(ws1, "room-b")
    mgr.disconnect(ws2, "room-b")


@pytest.mark.asyncio
async def test_broadcast_all_reaches_every_room() -> None:
    """broadcast_all 應廣播到每個房間"""
    mgr = _mgr()
    ws_a, ws_b = _make_ws(), _make_ws()
    await mgr.connect(ws_a, "room-a", "1.1.1.1")
    await mgr.connect(ws_b, "room-b", "2.2.2.2")

    msg = {"type": "notification", "data": {"text": "全域"}}
    await mgr.broadcast_all(msg)

    ws_a.send_json.assert_awaited_once_with(msg)
    ws_b.send_json.assert_awaited_once_with(msg)
    mgr.disconnect(ws_a, "room-a")
    mgr.disconnect(ws_b, "room-b")


@pytest.mark.asyncio
async def test_broadcast_skips_dead_connections() -> None:
    """廣播時若連線已斷，應自動移除而不拋出例外"""
    mgr = _mgr()
    ws_dead = _make_ws()
    ws_dead.send_json = AsyncMock(side_effect=RuntimeError("連線已關閉"))
    ws_alive = _make_ws()

    await mgr.connect(ws_dead, "room-c", "1.1.1.1")
    await mgr.connect(ws_alive, "room-c", "2.2.2.2")

    msg = {"type": "message", "data": {}}
    await mgr.broadcast_to_room("room-c", msg)  # 不應拋出例外

    ws_alive.send_json.assert_awaited_once_with(msg)
    # 死連線應被移除
    assert ws_dead not in mgr._rooms.get("room-c", set())
    mgr.disconnect(ws_alive, "room-c")


@pytest.mark.asyncio
async def test_connect_rejects_when_global_full() -> None:
    """達 global 上限時應拋 WSCapacityError("global")"""
    mgr = _mgr(global_max=1)
    ws1, ws2 = _make_ws(), _make_ws()
    await mgr.connect(ws1, "r", "1.1.1.1")

    with pytest.raises(WSCapacityError) as exc:
        await mgr.connect(ws2, "r", "2.2.2.2")
    assert exc.value.scope == "global"
    ws2.accept.assert_not_called()
    mgr.disconnect(ws1, "r")


@pytest.mark.asyncio
async def test_connect_rejects_when_per_ip_full() -> None:
    """同一 IP 開太多連線應拋 WSCapacityError("per_ip")"""
    mgr = _mgr(per_ip_max=2)
    ws1, ws2, ws3 = _make_ws(), _make_ws(), _make_ws()
    await mgr.connect(ws1, "r", "1.1.1.1")
    await mgr.connect(ws2, "r", "1.1.1.1")

    with pytest.raises(WSCapacityError) as exc:
        await mgr.connect(ws3, "r", "1.1.1.1")
    assert exc.value.scope == "per_ip"
    mgr.disconnect(ws1, "r")
    mgr.disconnect(ws2, "r")


@pytest.mark.asyncio
async def test_connect_rejects_when_per_room_full() -> None:
    """房間達上限應拋 WSCapacityError("per_room")"""
    mgr = _mgr(per_room_max=1)
    ws1, ws2 = _make_ws(), _make_ws()
    await mgr.connect(ws1, "r", "1.1.1.1")

    with pytest.raises(WSCapacityError) as exc:
        await mgr.connect(ws2, "r", "2.2.2.2")
    assert exc.value.scope == "per_room"
    mgr.disconnect(ws1, "r")


@pytest.mark.asyncio
async def test_notify_pong_updates_last_seen() -> None:
    """收到 pong 應更新 _last_pong 時間，防止心跳超時誤判"""
    mgr = _mgr()
    ws = _make_ws()
    await mgr.connect(ws, "r", "1.1.1.1")

    initial = mgr._last_pong[ws]
    await asyncio.sleep(0.01)
    mgr.notify_pong(ws)
    assert mgr._last_pong[ws] > initial
    mgr.disconnect(ws, "r")


@pytest.mark.asyncio
async def test_heartbeat_closes_idle_connection() -> None:
    """心跳超時應主動 close 連線"""
    mgr = _mgr(heartbeat_interval=0, heartbeat_timeout=0)  # 立刻超時
    ws = _make_ws()
    await mgr.connect(ws, "r", "1.1.1.1")
    # 讓心跳 task 跑一圈
    await asyncio.sleep(0.05)
    ws.close.assert_awaited()
    mgr.disconnect(ws, "r")


def test_total_connections() -> None:
    """total_connections 應回傳跨所有房間的總連線數"""
    mgr = _mgr()
    mgr._rooms["r1"] = {MagicMock(), MagicMock()}
    mgr._rooms["r2"] = {MagicMock()}

    assert mgr.total_connections() == 3


def test_list_rooms() -> None:
    """list_rooms 應回傳所有房間資訊"""
    mgr = _mgr()
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
