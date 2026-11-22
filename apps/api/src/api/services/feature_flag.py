"""Feature Flag 業務邏輯與評估。

評估順序（任一通過即啟用）：
1. is_globally_enabled = True
2. user.id in enabled_user_ids
3. percentage_rollout > 0 → hash(user_id + flag_key) % 100 < pct（穩定）
4. user 持有 enabled_permission_codes 任一權限

無 user（未登入）→ 僅檢查 globally_enabled。
無 flag row → 預設關閉（fail-safe）。

cache：每 flag 評估極輕、但批次評估時可用 Redis cache 5 秒。
本實作不 cache、由呼叫端 throttle。
"""

from __future__ import annotations

import hashlib
import uuid

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.feature_flag import FeatureFlag
from api.models.user import User
from api.services.permission import get_user_permission_codes


def _bucket_for(user_id: str, flag_key: str) -> int:
    """穩定的 0-99 桶：同 user 同 flag 永遠同桶。"""
    h = hashlib.sha256(f"{user_id}:{flag_key}".encode()).hexdigest()
    return int(h[:8], 16) % 100


async def is_enabled(
    db: AsyncSession,
    key: str,
    user: User | None = None,
) -> bool:
    flag = await get_flag_by_key(db, key)
    if flag is None or flag.archived_at is not None:
        return False
    if flag.is_globally_enabled:
        return True
    if user is None:
        return False
    uid = str(user.id)
    if uid in (flag.enabled_user_ids or []):
        return True
    if flag.percentage_rollout > 0 and _bucket_for(uid, flag.key) < flag.percentage_rollout:
        return True
    perm_codes = flag.enabled_permission_codes or []
    if perm_codes:
        user_codes = await get_user_permission_codes(db, user.id)
        if any(c in user_codes for c in perm_codes):
            return True
    return False


# ── CRUD ─────────────────────────────────────────────────────────────


async def list_flags(db: AsyncSession) -> list[FeatureFlag]:
    stmt = select(FeatureFlag).order_by(desc(FeatureFlag.created_at))
    return list((await db.execute(stmt)).scalars().all())


async def get_flag_by_key(db: AsyncSession, key: str) -> FeatureFlag | None:
    stmt = select(FeatureFlag).where(FeatureFlag.key == key)
    return (await db.execute(stmt)).scalar_one_or_none()


async def get_flag(db: AsyncSession, flag_id: uuid.UUID) -> FeatureFlag | None:
    return await db.get(FeatureFlag, flag_id)


async def create_flag(
    db: AsyncSession,
    *,
    key: str,
    description: str | None,
) -> FeatureFlag:
    row = FeatureFlag(key=key, description=description)
    db.add(row)
    await db.flush()
    return row


async def update_flag(
    db: AsyncSession,
    flag_id: uuid.UUID,
    *,
    description: str | None = None,
    is_globally_enabled: bool | None = None,
    percentage_rollout: int | None = None,
    enabled_user_ids: list[str] | None = None,
    enabled_permission_codes: list[str] | None = None,
) -> FeatureFlag:
    row = await db.get(FeatureFlag, flag_id)
    if row is None:
        raise ValueError("feature flag not found")
    if description is not None:
        row.description = description
    if is_globally_enabled is not None:
        row.is_globally_enabled = is_globally_enabled
    if percentage_rollout is not None:
        row.percentage_rollout = max(0, min(100, percentage_rollout))
    if enabled_user_ids is not None:
        row.enabled_user_ids = list(enabled_user_ids)
    if enabled_permission_codes is not None:
        row.enabled_permission_codes = list(enabled_permission_codes)
    await db.flush()
    return row


async def archive_flag(db: AsyncSession, flag_id: uuid.UUID) -> FeatureFlag:
    from datetime import UTC
    from datetime import datetime as _dt

    row = await db.get(FeatureFlag, flag_id)
    if row is None:
        raise ValueError("feature flag not found")
    row.archived_at = _dt.now(UTC)
    await db.flush()
    return row


__all__ = [
    "archive_flag",
    "create_flag",
    "get_flag",
    "get_flag_by_key",
    "is_enabled",
    "list_flags",
    "update_flag",
]
