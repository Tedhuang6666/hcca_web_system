"""RBAC 權限引擎單元測試"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.org import Org, Permission, Position, UserPosition
from api.models.user import User
from api.services.permission import get_user_permission_codes, user_has_permission


async def _seed_data(
    db: AsyncSession,
    *,
    start_offset: int = 0,
    end_offset: int | None = None,
) -> tuple[User, Position]:
    """建立測試資料：User → Org → Position → Permission → UserPosition"""
    user = User(email="test@school.edu", display_name="測試", is_active=True, is_verified=True)
    db.add(user)

    org = Org(name="學生會")
    db.add(org)
    await db.flush()

    position = Position(org_id=org.id, name="會長")
    db.add(position)
    await db.flush()

    perm = Permission(position_id=position.id, code="document:approve")
    db.add(perm)

    today = date.today()
    up = UserPosition(
        user_id=user.id,
        position_id=position.id,
        start_date=today + timedelta(days=start_offset),
        end_date=(today + timedelta(days=end_offset)) if end_offset is not None else None,
    )
    db.add(up)
    await db.flush()

    return user, position


@pytest.mark.asyncio
async def test_active_user_has_permission(db_session: AsyncSession) -> None:
    """任期進行中的使用者應取得對應權限碼"""
    user, _ = await _seed_data(db_session, start_offset=-10)  # 10 天前上任，尚未卸任

    codes = await get_user_permission_codes(db_session, user.id)

    assert "document:approve" in codes


@pytest.mark.asyncio
async def test_user_without_position_has_no_permission(db_session: AsyncSession) -> None:
    """沒有任何職位的使用者不應有任何權限"""
    user = User(email="nobody@school.edu", display_name="一般生", is_active=True, is_verified=True)
    db_session.add(user)
    await db_session.flush()

    codes = await get_user_permission_codes(db_session, user.id)

    assert len(codes) == 0


@pytest.mark.asyncio
async def test_expired_position_grants_no_permission(db_session: AsyncSession) -> None:
    """任期已結束的職位不應提供權限"""
    user, _ = await _seed_data(db_session, start_offset=-30, end_offset=-1)  # 昨天卸任

    codes = await get_user_permission_codes(db_session, user.id)

    assert "document:approve" not in codes


@pytest.mark.asyncio
async def test_future_position_grants_no_permission(db_session: AsyncSession) -> None:
    """尚未生效的任期不應提供當天權限"""
    user, _ = await _seed_data(db_session, start_offset=1)  # 明天才開始

    codes = await get_user_permission_codes(db_session, user.id)

    assert "document:approve" not in codes


@pytest.mark.asyncio
async def test_user_has_permission_helper(db_session: AsyncSession) -> None:
    """user_has_permission 輔助函式應正確回傳布林值"""
    user, _ = await _seed_data(db_session, start_offset=-5)

    assert await user_has_permission(db_session, user.id, "document:approve") is True
    assert await user_has_permission(db_session, user.id, "finance:view") is False


@pytest.mark.asyncio
async def test_multiple_permissions(db_session: AsyncSession) -> None:
    """同一職位擁有多個權限碼時，應全數回傳"""
    user, position = await _seed_data(db_session, start_offset=-5)

    # 新增第二個權限碼
    extra_perm = Permission(position_id=position.id, code="finance:view")
    db_session.add(extra_perm)
    await db_session.flush()

    codes = await get_user_permission_codes(db_session, user.id)

    assert "document:approve" in codes
    assert "finance:view" in codes
    assert len(codes) == 2
