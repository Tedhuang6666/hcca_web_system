"""Org / Position / UserPosition 服務層 - 業務邏輯與資料庫操作"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.org import Org, Permission, Position, UserPosition
from api.schemas.org import (
    OrgCreate,
    OrgTree,
    OrgUpdate,
    PermissionCreate,
    PositionCreate,
    PositionUpdate,
    UserPositionCreate,
    UserPositionUpdate,
)

# ── Org ──────────────────────────────────────────────────────────────────────


async def get_orgs(db: AsyncSession) -> list[Org]:
    result = await db.execute(select(Org).order_by(Org.name))
    return list(result.scalars().all())


async def get_org(db: AsyncSession, org_id: uuid.UUID) -> Org | None:
    result = await db.execute(
        select(Org).where(Org.id == org_id).options(selectinload(Org.children))
    )
    return result.scalar_one_or_none()


async def create_org(db: AsyncSession, data: OrgCreate) -> Org:
    org = Org(**data.model_dump())
    db.add(org)
    await db.flush()
    await db.refresh(org)
    return org


async def update_org(db: AsyncSession, org: Org, data: OrgUpdate) -> Org:
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(org, field, value)
    await db.flush()
    await db.refresh(org)
    return org


async def delete_org(db: AsyncSession, org: Org) -> None:
    await db.delete(org)
    await db.flush()


def build_org_tree(orgs: list[Org], parent_id: uuid.UUID | None = None) -> list[OrgTree]:
    """從扁平清單遞迴建構樹狀結構（避免 N+1 查詢）"""
    return [
        OrgTree.model_validate(org).model_copy(update={"children": build_org_tree(orgs, org.id)})
        for org in orgs
        if org.parent_id == parent_id
    ]


# ── Position ─────────────────────────────────────────────────────────────────


async def get_positions(db: AsyncSession, org_id: uuid.UUID) -> list[Position]:
    result = await db.execute(
        select(Position)
        .where(Position.org_id == org_id)
        .options(selectinload(Position.permissions))
        .order_by(Position.name)
    )
    return list(result.scalars().all())


async def get_position(db: AsyncSession, position_id: uuid.UUID) -> Position | None:
    result = await db.execute(
        select(Position)
        .where(Position.id == position_id)
        .options(selectinload(Position.permissions))
    )
    return result.scalar_one_or_none()


async def create_position(db: AsyncSession, org_id: uuid.UUID, data: PositionCreate) -> Position:
    position = Position(org_id=org_id, **data.model_dump())
    db.add(position)
    await db.flush()
    await db.refresh(position, ["permissions"])
    return position


async def update_position(db: AsyncSession, position: Position, data: PositionUpdate) -> Position:
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(position, field, value)
    await db.flush()
    await db.refresh(position, ["permissions"])
    return position


async def delete_position(db: AsyncSession, position: Position) -> None:
    await db.delete(position)
    await db.flush()


# ── Permission ───────────────────────────────────────────────────────────────


async def add_permission(
    db: AsyncSession, position_id: uuid.UUID, data: PermissionCreate
) -> Permission:
    perm = Permission(position_id=position_id, code=data.code)
    db.add(perm)
    await db.flush()
    await db.refresh(perm)
    return perm


async def remove_permission(db: AsyncSession, permission: Permission) -> None:
    await db.delete(permission)
    await db.flush()


# ── UserPosition ──────────────────────────────────────────────────────────────


async def get_user_positions(db: AsyncSession, user_id: uuid.UUID) -> list[UserPosition]:
    result = await db.execute(
        select(UserPosition)
        .where(UserPosition.user_id == user_id)
        .order_by(UserPosition.start_date.desc())
    )
    return list(result.scalars().all())


async def create_user_position(db: AsyncSession, data: UserPositionCreate) -> UserPosition:
    up = UserPosition(**data.model_dump())
    db.add(up)
    await db.flush()
    await db.refresh(up)
    return up


async def update_user_position(
    db: AsyncSession, up: UserPosition, data: UserPositionUpdate
) -> UserPosition:
    if data.end_date is not None:
        up.end_date = data.end_date
    await db.flush()
    await db.refresh(up)
    return up


async def get_active_positions_by_date(
    db: AsyncSession, user_id: uuid.UUID, on_date: date | None = None
) -> list[UserPosition]:
    """取得指定日期（預設今天）仍在任的職位記錄"""
    check_date = on_date or date.today()
    result = await db.execute(
        select(UserPosition)
        .where(
            UserPosition.user_id == user_id,
            UserPosition.start_date <= check_date,
            (UserPosition.end_date.is_(None)) | (UserPosition.end_date >= check_date),
        )
        .options(selectinload(UserPosition.position).selectinload(Position.permissions))
    )
    return list(result.scalars().all())
