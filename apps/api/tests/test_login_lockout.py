"""登入失敗鎖定單元測試（core/login_lockout.py）。

安全關鍵：鎖定邏輯壞掉 = 暴力破解門戶大開。使用真實 redis（conftest 的
autouse fixture 每個 test 換 connection pool）；以 uuid 做唯一 identifier 避免碰撞。
"""

from __future__ import annotations

import uuid

import pytest

from api.core import login_lockout
from api.core.security import redis_client


@pytest.fixture
def ident() -> str:
    return f"test-lockout-{uuid.uuid4().hex}"


@pytest.fixture(autouse=True)
async def _cleanup_keys(ident: str):
    yield
    await redis_client.delete(
        login_lockout._failures_key(ident),
        login_lockout._lockout_key(ident),
    )


async def test_below_threshold_not_locked(ident: str):
    # max_failures=3：前兩次不該鎖
    assert await login_lockout.record_failure(ident, max_failures=3) is None
    assert await login_lockout.record_failure(ident, max_failures=3) is None
    assert await login_lockout.is_locked(ident) is None


async def test_lock_triggers_at_threshold(ident: str):
    for _ in range(2):
        await login_lockout.record_failure(ident, max_failures=3, lockout_seconds=120)
    remaining = await login_lockout.record_failure(
        ident, max_failures=3, lockout_seconds=120
    )
    assert remaining == 120
    locked_for = await login_lockout.is_locked(ident)
    assert locked_for is not None and 0 < locked_for <= 120


async def test_record_success_clears_failures(ident: str):
    await login_lockout.record_failure(ident, max_failures=5)
    await login_lockout.record_failure(ident, max_failures=5)
    await login_lockout.record_success(ident)
    # 計數歸零後，再失敗一次不應接近鎖定
    assert await login_lockout.is_locked(ident) is None
    assert await login_lockout.record_failure(ident, max_failures=5) is None


async def test_admin_unlock_releases_lock(ident: str):
    for _ in range(3):
        await login_lockout.record_failure(ident, max_failures=3, lockout_seconds=300)
    assert await login_lockout.is_locked(ident) is not None
    await login_lockout.admin_unlock(ident)
    assert await login_lockout.is_locked(ident) is None


async def test_failures_reset_after_lock(ident: str):
    """鎖定後失敗計數應被清空，避免解鎖後一次失敗就再次鎖定。"""
    for _ in range(3):
        await login_lockout.record_failure(ident, max_failures=3, lockout_seconds=1)
    # lockout_key 仍在，但 failures_key 應已清空
    assert await redis_client.get(login_lockout._failures_key(ident)) is None


async def test_empty_identifier_is_noop():
    assert await login_lockout.is_locked("") is None
    assert await login_lockout.record_failure("") is None
    # 不應拋例外
    await login_lockout.record_success("")
