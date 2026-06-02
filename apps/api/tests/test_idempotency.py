"""Idempotency middleware 單元測試（core/idempotency.py）。

安全/正確性關鍵：冪等性壞掉 = 重複送出 / 重複建立（重按、網路重試）。
純函式直接測；middleware 行為以迷你 ASGI app + 真實 redis（conftest 換 pool）驗證。
"""

from __future__ import annotations

import json
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from api.core import idempotency
from api.core.idempotency import IDEMPOTENCY_HEADER, IdempotencyMiddleware

# ── 純函式 ────────────────────────────────────────────────────────────────────


def test_body_hash_is_deterministic():
    h1 = idempotency._body_hash("POST", "/x", b"abc")
    h2 = idempotency._body_hash("POST", "/x", b"abc")
    assert h1 == h2


def test_body_hash_differs_by_body_and_path():
    base = idempotency._body_hash("POST", "/x", b"abc")
    assert base != idempotency._body_hash("POST", "/x", b"abd")
    assert base != idempotency._body_hash("POST", "/y", b"abc")
    assert base != idempotency._body_hash("PUT", "/x", b"abc")


def test_cacheable_headers_filters_allowlist():
    headers = [
        (b"content-type", b"application/json"),
        (b"set-cookie", b"secret=1"),  # 不在白名單，應被濾掉
        (b"location", b"/resource/1"),
        (b"authorization", b"Bearer x"),  # 敏感，應被濾掉
    ]
    result = dict(idempotency._cacheable_headers(headers))
    assert result == {"content-type": "application/json", "location": "/resource/1"}


def test_header_value_case_insensitive():
    headers = [(b"Content-Type", b"text/plain")]
    assert idempotency._header_value(headers, b"content-type") == "text/plain"
    assert idempotency._header_value(headers, b"missing") is None


# ── middleware 行為 ───────────────────────────────────────────────────────────


def _counting_app():
    """每次被呼叫就 +1，body 回傳當前計數 → 可藉此判斷是否真的重跑或重播快取。"""
    state = {"calls": 0}

    async def app(scope, receive, send):
        state["calls"] += 1
        body = json.dumps({"n": state["calls"]}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 201,
                "headers": [(b"content-type", b"application/json")],
            }
        )
        await send({"type": "http.response.body", "body": body})

    return IdempotencyMiddleware(app), state


@pytest.fixture
def key() -> str:
    return f"itest-{uuid.uuid4().hex}"


async def test_first_request_executes(key: str):
    wrapped, state = _counting_app()
    transport = ASGITransport(app=wrapped)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/do", json={"a": 1}, headers={IDEMPOTENCY_HEADER: key})
    assert r.status_code == 201
    assert r.json() == {"n": 1}
    assert "x-idempotent-replay" not in {k.lower() for k in r.headers}
    assert state["calls"] == 1


async def test_same_key_same_body_replays_cache(key: str):
    wrapped, state = _counting_app()
    transport = ASGITransport(app=wrapped)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.post("/do", json={"a": 1}, headers={IDEMPOTENCY_HEADER: key})
        r2 = await ac.post("/do", json={"a": 1}, headers={IDEMPOTENCY_HEADER: key})
    assert r1.json() == {"n": 1}
    # 第二次應重播快取：app 不再被呼叫，計數維持 1
    assert r2.status_code == 201
    assert r2.json() == {"n": 1}
    assert r2.headers.get("X-Idempotent-Replay") == "true"
    assert state["calls"] == 1


async def test_same_key_different_body_conflicts(key: str):
    wrapped, _ = _counting_app()
    transport = ASGITransport(app=wrapped)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await ac.post("/do", json={"a": 1}, headers={IDEMPOTENCY_HEADER: key})
        r = await ac.post("/do", json={"a": 999}, headers={IDEMPOTENCY_HEADER: key})
    assert r.status_code == 409


async def test_no_key_bypasses_middleware():
    wrapped, state = _counting_app()
    transport = ASGITransport(app=wrapped)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.post("/do", json={"a": 1})
        r2 = await ac.post("/do", json={"a": 1})
    # 無 Idempotency-Key → 每次都真的執行
    assert r1.json() == {"n": 1}
    assert r2.json() == {"n": 2}
    assert state["calls"] == 2


async def test_oversized_key_rejected():
    wrapped, _ = _counting_app()
    transport = ASGITransport(app=wrapped)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/do", json={"a": 1}, headers={IDEMPOTENCY_HEADER: "x" * 129})
    assert r.status_code == 400
