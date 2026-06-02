"""異常偵測單元測試（core/anomaly_detection.py）。

涵蓋：可疑登入（IP 變動）、速率異常追蹤、超閾值自動封鎖 IP。
使用真實 redis（conftest 換 pool）；uuid 做唯一 user_id / IP 避免碰撞。
注意：本檔捕捉了一個真實 bug —— redis_client 以 decode_responses=True 建立，
get() 回傳 str，原本的 last_login.decode() 會 AttributeError 被吞掉，
導致 check_suspicious_login 永遠回傳 False。已於模組內修正。
"""

from __future__ import annotations

import uuid

import pytest

from api.core import anomaly_detection
from api.core.ip_blocklist import is_blocked, unblock
from api.core.security import redis_client


@pytest.fixture
def user_id() -> str:
    return f"test-anomaly-{uuid.uuid4().hex}"


@pytest.fixture(autouse=True)
async def _cleanup(user_id: str):
    yield
    await redis_client.delete(f"login:{user_id}")


async def test_no_prior_login_not_suspicious(user_id: str):
    suspicious, reason = await anomaly_detection.check_suspicious_login(user_id, "1.1.1.1")
    assert suspicious is False
    assert reason is None


async def test_same_ip_not_suspicious(user_id: str):
    await anomaly_detection.record_login(user_id, "1.1.1.1", "agent")
    suspicious, reason = await anomaly_detection.check_suspicious_login(user_id, "1.1.1.1")
    assert suspicious is False
    assert reason is None


async def test_different_ip_within_window_is_suspicious(user_id: str):
    """記錄一次登入後，立刻從不同 IP 登入應判為可疑（修 bug 後才會成立）。"""
    await anomaly_detection.record_login(user_id, "1.1.1.1", "agent")
    suspicious, reason = await anomaly_detection.check_suspicious_login(user_id, "9.9.9.9")
    assert suspicious is True
    assert reason is not None
    assert "1.1.1.1" in reason and "9.9.9.9" in reason


async def test_track_rate_anomaly_increments(user_id: str):
    c1 = await anomaly_detection.track_rate_anomaly(user_id, "/x", window_seconds=30)
    c2 = await anomaly_detection.track_rate_anomaly(user_id, "/x", window_seconds=30)
    assert c1 == 1
    assert c2 == 2
    await redis_client.delete(f"rate_anomaly:{user_id}:/x")


async def test_check_rate_anomaly_threshold(user_id: str):
    not_anom, count = await anomaly_detection.check_rate_anomaly(
        user_id, "/y", threshold=5, window_seconds=30
    )
    assert not_anom is False
    assert count == 1
    await redis_client.delete(f"rate_anomaly:{user_id}:/y")


async def test_rate_anomaly_and_block_blocks_ip(user_id: str):
    """超閾值（threshold=0）時應把 client_ip 加入 IP 黑名單。"""
    ip = f"203.0.113.{uuid.uuid4().int % 254 + 1}"
    endpoint = "/z"
    try:
        is_anom, count = await anomaly_detection.check_rate_anomaly_and_block(
            user_id, endpoint, ip, threshold=0, window_seconds=30, block_ttl_seconds=60
        )
        assert is_anom is True
        assert count >= 1
        assert await is_blocked(ip) is True
    finally:
        await unblock(ip)
        await redis_client.delete(f"rate_anomaly:{user_id}:{endpoint}")


async def test_rate_anomaly_and_block_skips_unknown_ip(user_id: str):
    """client_ip 為 'unknown' 時不應嘗試封鎖（避免封掉佔位字串）。"""
    endpoint = "/u"
    try:
        is_anom, _ = await anomaly_detection.check_rate_anomaly_and_block(
            user_id, endpoint, "unknown", threshold=0, window_seconds=30
        )
        assert is_anom is True
        assert await is_blocked("unknown") is False
    finally:
        await redis_client.delete(f"rate_anomaly:{user_id}:{endpoint}")
