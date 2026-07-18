"""RBAC 權限服務 - 查詢使用者當前所有有效權限碼（支援全域與組織範圍）"""

from __future__ import annotations

import asyncio
import uuid
from datetime import date

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.models.org import Org, Permission, Position, UserPosition


def active_tenure_filter(check_date: date) -> list:
    """回傳 UserPosition 任期有效的 WHERE 條件（全系統共用的單一來源）。

    任期有效 = start_date <= check_date AND (end_date IS NULL OR end_date >= check_date)。
    供 RBAC 權限查詢、收件人解析、公文簽核人查詢、班級成員、連署、會議等模組共用，
    確保「現任」判定一致。
    """
    return [
        UserPosition.start_date <= check_date,
        (UserPosition.end_date.is_(None)) | (UserPosition.end_date >= check_date),
    ]


async def get_user_permission_codes(
    db: AsyncSession,
    user_id: uuid.UUID,
    on_date: date | None = None,
) -> frozenset[str]:
    """
    查詢使用者在指定日期（預設今天）的所有有效權限碼（跨所有組織）。

    使用單一 JOIN 查詢，效能最優。有 Redis 快取支援。
    回傳 frozenset 方便快速 `in` 檢查。
    """
    check_date = on_date or local_today()

    # 僅在查詢今天的權限時使用快取（避免過期日期的快取複雜度）
    if on_date is None:
        from api.core.cache import cache_get, cache_set

        cache_key = f"perm:{user_id}"
        cached = await cache_get(cache_key)
        if cached is not None:
            return frozenset(cached)

    result = await db.execute(
        select(Permission.code)
        .join(Position, Permission.position_id == Position.id)
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(
            UserPosition.user_id == user_id,
            *active_tenure_filter(check_date),
        )
        .distinct()
    )
    codes = set(result.scalars().all())

    # 快取今天的權限結果（180 秒 TTL）
    if on_date is None:
        from api.core.cache import cache_set

        await cache_set(cache_key, list(codes), ttl=180)

    return frozenset(codes)


async def get_user_permission_codes_for_org(
    db: AsyncSession,
    user_id: uuid.UUID,
    org_id: uuid.UUID,
    on_date: date | None = None,
) -> frozenset[str]:
    """
    查詢使用者在指定組織下的有效權限碼（org-scoped）。

    用於公文/法規/字號等需要「只能操作自己組織」的資源檢查。
    """
    check_date = on_date or local_today()

    result = await db.execute(
        select(Permission.code)
        .join(Position, Permission.position_id == Position.id)
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(
            UserPosition.user_id == user_id,
            Position.org_id == org_id,
            *active_tenure_filter(check_date),
        )
        .distinct()
    )
    codes = set(result.scalars().all())
    return frozenset(codes)


async def get_org_permission_codes(db: AsyncSession, org_id: uuid.UUID) -> frozenset[str]:
    """回傳組織內所有職位權限碼聯集。"""
    result = await db.execute(
        select(Permission.code)
        .join(Position, Permission.position_id == Position.id)
        .where(Position.org_id == org_id)
        .distinct()
    )
    return frozenset(result.scalars().all())


async def get_user_org_ids_with_permission(
    db: AsyncSession,
    user_id: uuid.UUID,
    permission_code: str,
    on_date: date | None = None,
) -> list[uuid.UUID]:
    """
    回傳使用者在哪些組織內擁有指定權限碼。

    用於前端過濾「可選組織下拉」：只顯示使用者有相應操作權限的組織。
    """
    check_date = on_date or local_today()

    result = await db.execute(
        select(Position.org_id)
        .join(Permission, Permission.position_id == Position.id)
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(
            UserPosition.user_id == user_id,
            Permission.code == permission_code,
            *active_tenure_filter(check_date),
        )
        .distinct()
    )
    org_ids = set(result.scalars().all())
    all_org_ids = await get_user_org_ids(db, user_id, on_date=check_date)
    if all_org_ids:
        per_org_codes = await asyncio.gather(
            *[
                get_user_permission_codes_for_org(db, user_id, oid, on_date=check_date)
                for oid in all_org_ids
            ]
        )
        for oid, codes in zip(all_org_ids, per_org_codes, strict=False):
            if permission_code in codes:
                org_ids.add(oid)
    return list(org_ids)


async def get_user_org_ids_with_any_permission(
    db: AsyncSession,
    user_id: uuid.UUID,
    permission_codes: set[str],
    on_date: date | None = None,
) -> list[uuid.UUID]:
    """回傳使用者在哪些組織內擁有任一指定權限碼。"""
    if not permission_codes:
        return []
    check_date = on_date or local_today()

    result = await db.execute(
        select(Position.org_id)
        .join(Permission, Permission.position_id == Position.id)
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(
            UserPosition.user_id == user_id,
            Permission.code.in_(permission_codes),
            *active_tenure_filter(check_date),
        )
        .distinct()
    )
    org_ids = set(result.scalars().all())
    all_org_ids = await get_user_org_ids(db, user_id, on_date=check_date)
    if all_org_ids:
        per_org_codes = await asyncio.gather(
            *[
                get_user_permission_codes_for_org(db, user_id, oid, on_date=check_date)
                for oid in all_org_ids
            ]
        )
        for oid, codes in zip(all_org_ids, per_org_codes, strict=False):
            if permission_codes & set(codes):
                org_ids.add(oid)
    return list(org_ids)


async def get_org_leader_user_id(
    db: AsyncSession,
    org_id: uuid.UUID,
    on_date: date | None = None,
) -> uuid.UUID | None:
    """取得組織最高權限者。

    優先使用 Org.leader_user_id。未指定時，取目前在該組織有效任期中
    Position.weight 最高者；若同分，以任期較早建立者優先，確保結果穩定。
    """
    org = await db.scalar(select(Org).where(Org.id == org_id))
    if org is None:
        return None
    if org.leader_user_id is not None:
        return org.leader_user_id

    check_date = on_date or local_today()
    result = await db.execute(
        select(UserPosition.user_id)
        .join(Position, UserPosition.position_id == Position.id)
        .where(
            Position.org_id == org_id,
            *active_tenure_filter(check_date),
        )
        .order_by(desc(Position.weight), UserPosition.created_at, UserPosition.id)
        .limit(1)
    )
    return result.scalar_one_or_none()


async def user_is_org_leader(
    db: AsyncSession,
    user_id: uuid.UUID,
    org_id: uuid.UUID,
    on_date: date | None = None,
) -> bool:
    """使用者是否為組織指定最高權限者，或未指定時的權限係數最高者。"""
    leader_id = await get_org_leader_user_id(db, org_id, on_date=on_date)
    return leader_id == user_id


async def get_user_org_ids(
    db: AsyncSession,
    user_id: uuid.UUID,
    on_date: date | None = None,
) -> list[uuid.UUID]:
    """回傳使用者目前透過有效任期所屬的所有組織 ID（不限權限）。"""
    check_date = on_date or local_today()

    result = await db.execute(
        select(Position.org_id)
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(
            UserPosition.user_id == user_id,
            *active_tenure_filter(check_date),
        )
        .distinct()
    )
    return list(result.scalars().all())


async def user_has_permission(
    db: AsyncSession,
    user_id: uuid.UUID,
    permission_code: str,
) -> bool:
    """快速檢查使用者是否擁有特定權限碼（全域）"""
    codes = await get_user_permission_codes(db, user_id)
    return permission_code in codes
