"""WebSocket 路由測試（apps/api/src/api/routers/ws.py）。

httpx 的 ASGITransport 不支援 WebSocket 升級，故不透過真實連線測試；改為直接
測試路由內的認證（_authenticate_ws）與房間授權（_assert_room_access）這兩個
安全關鍵函式 —— 尤其是 docstring 中明確提及、曾經是漏洞的 default-deny 邏輯。
manager 本身（connect/broadcast/心跳）已由 test_ws_manager.py 涵蓋。
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
import pytest_asyncio

from api.core.config import settings
from api.core.permission_codes import PermissionCode
from api.core.security import add_to_blacklist, create_access_token, create_refresh_token
from api.models.user import User
from api.routers.ws import _assert_room_access, _authenticate_ws, _ws_token_from_websocket


@pytest_asyncio.fixture(autouse=True)
async def _reset_db_engine_pool_per_test() -> None:
    """_assert_room_access 走 AsyncSessionLocal()（api.core.database.engine 的
    module-level pool），不是本檔其他測試共用的 db_session 覆寫連線。

    engine 的連線池是 process 全域單例，第一次 await 時會把連線黏到當時的
    event loop；pytest-asyncio 每個 test function 起新 loop，下個 test 若拿到
    同一條池化連線就會撞「Future attached to a different loop」。同 conftest.py
    對 redis_client 的處理手法，但刻意只在本檔 local fixture 做，不動全域
    conftest.py（其他 session 可能正併發使用同一份測試基礎設施）。
    """
    from api.core.database import engine

    await engine.dispose()


class FakeWebSocket:
    def __init__(
        self,
        *,
        query_token: str | None = None,
        header_token: str | None = None,
        cookie_token: str | None = None,
    ) -> None:
        self.query_params: dict[str, str] = {"token": query_token} if query_token else {}
        self.headers: dict[str, str] = (
            {"authorization": f"Bearer {header_token}"} if header_token else {}
        )
        self.cookies: dict[str, str] = (
            {settings.ACCESS_TOKEN_COOKIE_NAME: cookie_token} if cookie_token else {}
        )
        self.client = None
        self.closed_with: tuple[int, str] | None = None

    async def close(self, code: int, reason: str = "") -> None:
        self.closed_with = (code, reason)


# ── token 擷取 ────────────────────────────────────────────────────────────────


def test_ws_token_from_websocket_ignores_query_param() -> None:
    ws = FakeWebSocket(query_token="q", header_token="h", cookie_token="c")
    assert _ws_token_from_websocket(ws) == "h"  # type: ignore[arg-type]


def test_ws_token_from_websocket_falls_back_to_header() -> None:
    ws = FakeWebSocket(header_token="h", cookie_token="c")
    assert _ws_token_from_websocket(ws) == "h"  # type: ignore[arg-type]


def test_ws_token_from_websocket_falls_back_to_cookie() -> None:
    ws = FakeWebSocket(cookie_token="c")
    assert _ws_token_from_websocket(ws) == "c"  # type: ignore[arg-type]


def test_ws_token_from_websocket_none_when_absent() -> None:
    ws = FakeWebSocket()
    assert _ws_token_from_websocket(ws) is None  # type: ignore[arg-type]


# ── 認證 ─────────────────────────────────────────────────────────────────────


async def test_authenticate_ws_missing_token_closes_with_auth_error() -> None:
    ws = FakeWebSocket()
    user_id = await _authenticate_ws(ws)  # type: ignore[arg-type]
    assert user_id is None
    assert ws.closed_with == (4001, "缺少認證 Token")


async def test_authenticate_ws_valid_token_returns_subject(member_user: User) -> None:
    token = create_access_token(str(member_user.id))
    ws = FakeWebSocket(header_token=token)
    user_id = await _authenticate_ws(ws)  # type: ignore[arg-type]
    assert user_id == str(member_user.id)
    assert ws.closed_with is None


async def test_authenticate_ws_wrong_token_type_rejected(member_user: User) -> None:
    token = create_refresh_token(str(member_user.id))
    ws = FakeWebSocket(header_token=token)
    user_id = await _authenticate_ws(ws)  # type: ignore[arg-type]
    assert user_id is None
    assert ws.closed_with == (4001, "無效的 Token 類型")


async def test_authenticate_ws_blacklisted_token_rejected(member_user: User) -> None:
    token = create_access_token(str(member_user.id))
    await add_to_blacklist(token)
    ws = FakeWebSocket(header_token=token)
    user_id = await _authenticate_ws(ws)  # type: ignore[arg-type]
    assert user_id is None
    assert ws.closed_with == (4001, "Token 已登出")


async def test_authenticate_ws_garbage_token_rejected() -> None:
    ws = FakeWebSocket(query_token="not-a-jwt-at-all")
    user_id = await _authenticate_ws(ws)  # type: ignore[arg-type]
    assert user_id is None
    assert ws.closed_with is not None
    assert ws.closed_with[0] == 4001


# ── 房間授權 ──────────────────────────────────────────────────────────────────


async def test_room_access_admin_all_bypasses_everything(
    member_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    # _assert_room_access 內部走 AsyncSessionLocal()（獨立於本檔其他測試共用的
    # db_session 覆寫連線），透過該連線寫入的 RBAC 授權在 Postgres 交易隔離下
    # 不會即時可見；直接 monkeypatch get_user_permission_codes 繞過此限制，
    # 純驗證 bypass 邏輯本身。
    async def _fake_codes(*_args: object, **_kwargs: object) -> frozenset[str]:
        return frozenset({str(PermissionCode.ADMIN_ALL)})

    import api.routers.ws as ws_module

    monkeypatch.setattr(ws_module, "get_user_permission_codes", _fake_codes)
    await _assert_room_access(f"election:{uuid.uuid4()}", str(member_user.id))


async def test_room_access_user_room_self_allowed(member_user: User) -> None:
    await _assert_room_access(f"user:{member_user.id}", str(member_user.id))


async def test_room_access_user_room_other_denied(member_user: User, make_user: Any) -> None:
    other = await make_user(email="ws-room-other@school.edu")
    try:
        await _assert_room_access(f"user:{other.id}", str(member_user.id))
        raise AssertionError("應該拋出 PermissionError")
    except PermissionError:
        pass


async def test_room_access_org_non_member_denied(member_user: User) -> None:
    try:
        await _assert_room_access(f"org:{uuid.uuid4()}", str(member_user.id))
        raise AssertionError("應該拋出 PermissionError")
    except PermissionError:
        pass


async def test_room_access_meeting_room_any_logged_in_user_allowed(member_user: User) -> None:
    await _assert_room_access(f"meeting:{uuid.uuid4()}", str(member_user.id))


async def test_room_access_unknown_room_default_denied(member_user: User) -> None:
    try:
        await _assert_room_access("election:some-id", str(member_user.id))
        raise AssertionError("應該拋出 PermissionError")
    except PermissionError:
        pass


async def test_room_access_invalid_user_id_denied() -> None:
    try:
        await _assert_room_access("meeting:x", "not-a-uuid")
        raise AssertionError("應該拋出 PermissionError")
    except PermissionError:
        pass


# ── HTTP 管理端點 ─────────────────────────────────────────────────────────────


async def test_list_ws_rooms_requires_login(client) -> None:
    response = await client.get("/ws/rooms")
    assert response.status_code == 401


async def test_list_ws_rooms_returns_stats(authed_client_factory, member_user: User) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.get("/ws/rooms")
    assert response.status_code == 200
    body = response.json()
    assert "rooms" in body
    assert "total_connections" in body
    assert "stats" in body
