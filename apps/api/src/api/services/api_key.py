"""ApiKey 業務邏輯。

責任：
- 產生密碼學安全的 raw key（一次性回給呼叫端、不存明文）
- 存 salted scrypt digest + key_prefix
- 透過 hash 反查、驗證有效性（active / not revoked / not expired）
- revoke / list / 統計

明文 key 格式：`hcca_<32-byte URL-safe base64>`。前綴用於 logging 區分用途。
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.api_key import ApiKey

_PREFIX = "hcca_"
_SCRYPT_SALT_BYTES = 16


def _hash_key(raw: str) -> str:
    salt = secrets.token_bytes(_SCRYPT_SALT_BYTES)
    digest = hashlib.scrypt(
        raw.encode("utf-8"),
        salt=salt,
        n=2**14,
        r=8,
        p=1,
        dklen=32,
    )
    return f"scrypt:{salt.hex()}:{digest.hex()}"


def _verify_key(raw: str, stored: str) -> bool:
    try:
        algorithm, salt_hex, digest_hex = stored.split(":", 2)
        if algorithm != "scrypt":
            return False
        candidate = hashlib.scrypt(
            raw.encode("utf-8"),
            salt=bytes.fromhex(salt_hex),
            n=2**14,
            r=8,
            p=1,
            dklen=32,
        )
        expected = bytes.fromhex(digest_hex)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(candidate, expected)


def generate_raw_key() -> tuple[str, str]:
    """產生 raw key 字串並計算 salted password hash；回傳 (raw, hash)。"""
    raw = _PREFIX + secrets.token_urlsafe(32)
    return raw, _hash_key(raw)


async def create_api_key(
    db: AsyncSession,
    *,
    owner_user_id: uuid.UUID,
    name: str,
    scopes: list[str],
    rate_limit_per_minute: int,
    expires_at: datetime | None,
) -> tuple[ApiKey, str]:
    """建立一把 key；回傳 (model row, 一次性明文)。"""
    raw, key_hash = await asyncio.to_thread(generate_raw_key)
    row = ApiKey(
        name=name,
        key_prefix=raw[: len(_PREFIX) + 8],
        key_hash=key_hash,
        owner_user_id=owner_user_id,
        scopes=list(scopes),
        rate_limit_per_minute=rate_limit_per_minute,
        expires_at=expires_at,
        is_active=True,
    )
    db.add(row)
    await db.flush()
    return row, raw


async def list_owned(
    db: AsyncSession, owner_user_id: uuid.UUID, *, include_revoked: bool = False
) -> list[ApiKey]:
    stmt = (
        select(ApiKey)
        .where(ApiKey.owner_user_id == owner_user_id)
        .order_by(desc(ApiKey.created_at))
    )
    if not include_revoked:
        stmt = stmt.where(ApiKey.revoked_at.is_(None))
    return list((await db.execute(stmt)).scalars().all())


async def list_all(db: AsyncSession, *, include_revoked: bool = False) -> list[ApiKey]:
    stmt = select(ApiKey).order_by(desc(ApiKey.created_at))
    if not include_revoked:
        stmt = stmt.where(ApiKey.revoked_at.is_(None))
    return list((await db.execute(stmt)).scalars().all())


async def get_by_id(db: AsyncSession, api_key_id: uuid.UUID) -> ApiKey | None:
    return await db.get(ApiKey, api_key_id)


async def revoke(db: AsyncSession, api_key_id: uuid.UUID, *, reason: str | None) -> ApiKey:
    row = await db.get(ApiKey, api_key_id)
    if row is None:
        raise ValueError("api key not found")
    if row.revoked_at is not None:
        return row
    row.revoked_at = datetime.now(UTC)
    row.revoked_reason = (reason or "")[:500] or None
    row.is_active = False
    await db.flush()
    return row


# ── runtime auth ─────────────────────────────────────────────────────


async def find_active_by_raw(db: AsyncSession, raw_key: str) -> ApiKey | None:
    """API auth dependency 用。回傳通過所有 active 檢查的 ApiKey；否則 None。"""
    if not raw_key or not raw_key.startswith(_PREFIX):
        return None
    key_prefix = raw_key[: len(_PREFIX) + 8]
    stmt = select(ApiKey).where(ApiKey.key_prefix == key_prefix)
    candidates = (await db.execute(stmt)).scalars().all()
    row = None
    for candidate in candidates:
        if await asyncio.to_thread(_verify_key, raw_key, candidate.key_hash):
            row = candidate
            break
    if row is None:
        return None
    if not row.is_active or row.revoked_at is not None:
        return None
    now = datetime.now(UTC)
    if row.expires_at is not None and row.expires_at < now:
        return None
    return row


async def touch_used(db: AsyncSession, api_key_id: uuid.UUID, *, ip: str | None) -> None:
    """更新 last_used_at / last_used_ip。"""
    row = await db.get(ApiKey, api_key_id)
    if row is None:
        return
    row.last_used_at = datetime.now(UTC)
    row.last_used_ip = ip
    await db.flush()


__all__ = [
    "create_api_key",
    "find_active_by_raw",
    "generate_raw_key",
    "get_by_id",
    "list_all",
    "list_owned",
    "revoke",
    "touch_used",
]
