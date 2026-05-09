"""RBAC 權限服務 - 查詢使用者當前所有有效權限碼（支援全域與組織範圍）"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.org import Permission, Position, UserPosition


def _active_tenure_filter(check_date: date):
    """回傳 UserPosition 任期有效的 WHERE 條件（共用）"""
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

    使用單一 JOIN 查詢，效能最優。
    回傳 frozenset 方便快速 `in` 檢查。
    """
    check_date = on_date or date.today()

    result = await db.execute(
        select(Permission.code)
        .join(Position, Permission.position_id == Position.id)
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(
            UserPosition.user_id == user_id,
            *_active_tenure_filter(check_date),
        )
        .distinct()
    )
    return frozenset(result.scalars().all())


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
    check_date = on_date or date.today()

    result = await db.execute(
        select(Permission.code)
        .join(Position, Permission.position_id == Position.id)
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(
            UserPosition.user_id == user_id,
            Position.org_id == org_id,
            *_active_tenure_filter(check_date),
        )
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
    check_date = on_date or date.today()

    result = await db.execute(
        select(Position.org_id)
        .join(Permission, Permission.position_id == Position.id)
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(
            UserPosition.user_id == user_id,
            Permission.code == permission_code,
            *_active_tenure_filter(check_date),
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
