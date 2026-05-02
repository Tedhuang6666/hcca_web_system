"""RBAC 權限服務 - 查詢使用者當前所有有效權限碼"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.org import Permission, Position, UserPosition


async def get_user_permission_codes(
    db: AsyncSession,
    user_id: uuid.UUID,
    on_date: date | None = None,
) -> frozenset[str]:
    """
    查詢使用者在指定日期（預設今天）的所有有效權限碼。

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
            UserPosition.start_date <= check_date,
            (UserPosition.end_date.is_(None)) | (UserPosition.end_date >= check_date),
        )
        .distinct()
    )
    return frozenset(result.scalars().all())


async def user_has_permission(
    db: AsyncSession,
    user_id: uuid.UUID,
    permission_code: str,
) -> bool:
    """快速檢查使用者是否擁有特定權限碼"""
    codes = await get_user_permission_codes(db, user_id)
    return permission_code in codes
