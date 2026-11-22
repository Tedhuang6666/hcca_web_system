"""MFA lockout and TOTP replay protection tests without database fixtures."""

from __future__ import annotations

from typing import cast
from uuid import uuid4

import pyotp
import pytest
from fastapi import HTTPException
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import AsyncSession

from api.core import login_lockout
from api.core.login_lockout import LoginLockoutUnavailable
from api.models.user import User
from api.routers import mfa as mfa_router
from api.services import mfa as mfa_svc


async def test_mfa_lockout_read_fails_closed_when_redis_is_unavailable(monkeypatch) -> None:
    async def unavailable(*_args, **_kwargs):
        raise RedisError("synthetic Redis outage")

    monkeypatch.setattr(login_lockout.redis_client, "ttl", unavailable)

    with pytest.raises(LoginLockoutUnavailable):
        await login_lockout.is_locked("mfa:synthetic-user", fail_closed=True)


async def test_mfa_lockout_detects_threshold_if_lock_key_was_not_written(monkeypatch) -> None:
    async def ttl(key: str):
        return -2 if key == login_lockout._lockout_key("mfa:synthetic-user") else 600

    async def get(_key: str):
        return b"5"

    monkeypatch.setattr(login_lockout.redis_client, "ttl", ttl)
    monkeypatch.setattr(login_lockout.redis_client, "get", get)

    assert await login_lockout.is_locked("mfa:synthetic-user", fail_closed=True) == 600


async def test_mfa_lockout_checks_redis_writability_before_accepting_attempt(monkeypatch) -> None:
    async def no_lock(_key: str):
        return -2

    async def no_failures(_key: str):
        return None

    async def unavailable(*_args, **_kwargs):
        raise RedisError("synthetic read-only Redis")

    monkeypatch.setattr(login_lockout.redis_client, "ttl", no_lock)
    monkeypatch.setattr(login_lockout.redis_client, "get", no_failures)
    monkeypatch.setattr(login_lockout.redis_client, "set", unavailable)

    with pytest.raises(LoginLockoutUnavailable):
        await login_lockout.is_locked("mfa:synthetic-user", fail_closed=True)


async def test_mfa_lockout_recording_fails_closed_when_redis_is_unavailable(monkeypatch) -> None:
    class BrokenPipeline:
        def incr(self, _key):
            return self

        def expire(self, _key, _seconds):
            return self

        async def execute(self):
            raise RedisError("synthetic Redis outage")

    monkeypatch.setattr(login_lockout.redis_client, "pipeline", BrokenPipeline)

    with pytest.raises(LoginLockoutUnavailable):
        await login_lockout.record_failure("mfa:synthetic-user", fail_closed=True)


async def test_mfa_lockout_preserves_threshold_when_lock_write_fails(monkeypatch) -> None:
    class ThresholdPipeline:
        def incr(self, _key):
            return self

        def expire(self, _key, _seconds):
            return self

        async def execute(self):
            return [5, True]

    async def unavailable(*_args, **_kwargs):
        raise RedisError("synthetic lock write failure")

    async def ttl(key: str):
        return -2 if key == login_lockout._lockout_key("mfa:synthetic-user") else 600

    async def get(_key: str):
        return b"5"

    monkeypatch.setattr(login_lockout.redis_client, "pipeline", ThresholdPipeline)
    monkeypatch.setattr(login_lockout.redis_client, "set", unavailable)

    with pytest.raises(LoginLockoutUnavailable):
        await login_lockout.record_failure("mfa:synthetic-user", fail_closed=True)

    monkeypatch.setattr(login_lockout.redis_client, "ttl", ttl)
    monkeypatch.setattr(login_lockout.redis_client, "get", get)
    assert await login_lockout.is_locked("mfa:synthetic-user", fail_closed=True) == 600


async def test_mfa_router_returns_503_when_lockout_state_cannot_be_checked(monkeypatch) -> None:
    async def unavailable(*_args, **_kwargs):
        raise LoginLockoutUnavailable("synthetic Redis outage")

    monkeypatch.setattr(mfa_router, "is_locked", unavailable)
    user = User(
        id=uuid4(),
        email="mfa-lockout@example.invalid",
        display_name="MFA Lockout Test",
        is_verified=True,
    )

    with pytest.raises(HTTPException) as error:
        await mfa_router._ensure_mfa_not_locked(user)

    assert error.value.status_code == 503


async def test_mfa_router_returns_503_when_failure_cannot_be_recorded(monkeypatch) -> None:
    async def unavailable(*_args, **_kwargs):
        raise LoginLockoutUnavailable("synthetic Redis outage")

    monkeypatch.setattr(mfa_router, "record_failure", unavailable)

    with pytest.raises(HTTPException) as error:
        await mfa_router._record_mfa_failure("mfa:synthetic-user")

    assert error.value.status_code == 503


async def test_totp_replay_guard_claims_a_valid_code_only_once(monkeypatch) -> None:
    secret = pyotp.random_base32()
    user = User(
        id=uuid4(),
        email="mfa-replay@example.invalid",
        display_name="MFA Replay Test",
        is_verified=True,
        mfa_enabled=True,
        mfa_secret="encrypted-secret",
        mfa_backup_code_hashes={"codes": ["previous-hash"]},
        mfa_pending_secret=None,
        mfa_pending_backup_code_hashes={},
    )
    used_keys: set[str] = set()

    async def set_once(key: str, _value: str, *, ex: int, nx: bool):
        assert ex == mfa_svc._TOTP_REPLAY_TTL_SECONDS
        assert nx is True
        if key in used_keys:
            return None
        used_keys.add(key)
        return True

    monkeypatch.setattr(mfa_svc, "decrypt_mfa_secret", lambda _stored: secret)
    monkeypatch.setattr(mfa_svc.redis_client, "set", set_once)

    code = pyotp.TOTP(secret).now()
    assert await mfa_svc._consume_totp_code_once(user, secret, code)
    assert not await mfa_svc._consume_totp_code_once(user, secret, code)


async def test_backup_code_regeneration_and_mfa_disable_reject_replayed_totp(
    monkeypatch,
) -> None:
    secret = pyotp.random_base32()
    user = User(
        id=uuid4(),
        email="mfa-replay-endpoints@example.invalid",
        display_name="MFA Replay Endpoints Test",
        is_verified=True,
        mfa_enabled=True,
        mfa_secret="encrypted-secret",
        mfa_backup_code_hashes={"codes": ["previous-hash"]},
        mfa_pending_secret=None,
        mfa_pending_backup_code_hashes={},
    )

    async def already_used(*_args, **_kwargs):
        return None

    monkeypatch.setattr(mfa_svc, "decrypt_mfa_secret", lambda _stored: secret)
    monkeypatch.setattr(mfa_svc.redis_client, "set", already_used)

    code = pyotp.TOTP(secret).now()
    session = cast(AsyncSession, None)
    assert await mfa_svc.regenerate_backup_codes(session, user, code) is None
    assert not await mfa_svc.disable_mfa(session, user, code)
    assert user.mfa_enabled is True
    assert user.mfa_secret == "encrypted-secret"
    assert user.mfa_backup_code_hashes == {"codes": ["previous-hash"]}


async def test_valid_totp_is_rejected_when_replay_store_is_unavailable(monkeypatch) -> None:
    secret = pyotp.random_base32()
    user = User(
        id=uuid4(),
        email="mfa-replay-fail@example.invalid",
        display_name="MFA Replay Fail Test",
        is_verified=True,
        mfa_enabled=True,
        mfa_secret="encrypted-secret",
        mfa_backup_code_hashes={"codes": []},
    )

    async def unavailable(*_args, **_kwargs):
        raise RedisError("synthetic Redis outage")

    monkeypatch.setattr(mfa_svc, "decrypt_mfa_secret", lambda _stored: secret)
    monkeypatch.setattr(mfa_svc.redis_client, "set", unavailable)

    assert not await mfa_svc.verify_mfa(cast(AsyncSession, None), user, pyotp.TOTP(secret).now())
