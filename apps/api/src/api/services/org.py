"""Org / Position / UserPosition 服務層 - 業務邏輯與資料庫操作"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import exists, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import local_today
from api.models.document import Document
from api.models.org import Org, Permission, Position, UserPosition
from api.models.regulation import Regulation
from api.models.school_class import SchoolClass
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


async def get_orgs(
    db: AsyncSession,
    active_only: bool = False,
    exclude_class_orgs: bool = False,
    org_ids: list[uuid.UUID] | None = None,
) -> list[Org]:
    query = select(Org).order_by(Org.name)
    if active_only:
        query = query.where(Org.is_active.is_(True))
    if org_ids is not None:
        query = query.where(Org.id.in_(org_ids))
    if exclude_class_orgs:
        query = query.where(~exists().where(SchoolClass.org_id == Org.id))
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_org(db: AsyncSession, org_id: uuid.UUID) -> Org | None:
    result = await db.execute(
        select(Org).where(Org.id == org_id).options(selectinload(Org.children))
    )
    return result.scalar_one_or_none()


async def _org_exists(db: AsyncSession, org_id: uuid.UUID) -> bool:
    """快速檢查組織是否存在（用於 FK 驗證）"""
    result = await db.execute(select(Org.id).where(Org.id == org_id).limit(1))
    return result.scalar_one_or_none() is not None


async def _user_has_active_position_in_org(
    db: AsyncSession,
    user_id: uuid.UUID,
    org_id: uuid.UUID,
) -> bool:
    today = local_today()
    result = await db.execute(
        select(UserPosition.id)
        .join(Position, UserPosition.position_id == Position.id)
        .where(
            UserPosition.user_id == user_id,
            Position.org_id == org_id,
            UserPosition.start_date <= today,
            (UserPosition.end_date.is_(None)) | (UserPosition.end_date >= today),
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


async def _has_ancestor(
    db: AsyncSession, child_id: uuid.UUID, ancestor_candidate: uuid.UUID
) -> bool:
    """用遞迴 CTE 檢查 ancestor_candidate 是否在 child_id 的祖先鏈中（避免 N+1 查詢）"""
    query = text("""
    WITH RECURSIVE ancestors AS (
        SELECT parent_id FROM orgs WHERE id = :child_id
        UNION ALL
        SELECT o.parent_id FROM orgs o
        JOIN ancestors a ON o.id = a.parent_id WHERE o.parent_id IS NOT NULL
    )
    SELECT EXISTS(SELECT 1 FROM ancestors WHERE parent_id = :ancestor_id)
    """)
    result = await db.execute(
        query, {"child_id": str(child_id), "ancestor_id": str(ancestor_candidate)}
    )
    return result.scalar_one_or_none() or False


async def create_org(db: AsyncSession, data: OrgCreate) -> Org:
    org = Org(**data.model_dump())
    db.add(org)
    await db.flush()
    await db.refresh(org)
    return org


async def update_org(db: AsyncSession, org: Org, data: OrgUpdate) -> Org:
    updates = data.model_dump(exclude_unset=True)
    if "description" not in updates:
        note = updates.pop("note", None)
        remark = updates.pop("remark", None)
        if note is not None:
            updates["description"] = note
        elif remark is not None:
            updates["description"] = remark
    else:
        updates.pop("note", None)
        updates.pop("remark", None)
    parent_id = updates.get("parent_id")
    if parent_id == org.id:
        raise ValueError("組織不可將自己設為上級")
    if "parent_id" in updates and parent_id is not None:
        if not await _org_exists(db, parent_id):
            raise ValueError("指定的上層組織不存在")
        if await _has_ancestor(db, parent_id, org.id):
            raise ValueError("組織不可將自己的下層組織設為上級")
    if (
        "leader_user_id" in updates
        and updates["leader_user_id"] is not None
        and not await _user_has_active_position_in_org(db, updates["leader_user_id"], org.id)
    ):
        raise ValueError("指定部長必須是此組織的現任成員")
    for field, value in updates.items():
        setattr(org, field, value)
    await db.flush()
    await db.refresh(org)
    return org


async def org_has_documents_or_regulations(db: AsyncSession, org_id: uuid.UUID) -> bool:
    doc_result = await db.execute(select(Document.id).where(Document.org_id == org_id).limit(1))
    if doc_result.scalar_one_or_none() is not None:
        return True
    reg_result = await db.execute(select(Regulation.id).where(Regulation.org_id == org_id).limit(1))
    return reg_result.scalar_one_or_none() is not None


async def set_org_active(db: AsyncSession, org: Org, is_active: bool) -> Org:
    org.is_active = is_active
    await db.flush()
    await db.refresh(org)
    return org


async def delete_org(db: AsyncSession, org: Org) -> None:
    await db.delete(org)
    await db.flush()


def build_org_tree(orgs: list[Org], parent_id: uuid.UUID | None = None) -> list[OrgTree]:
    """從扁平清單建構樹狀結構。O(n) adjacency map 一次 pass。"""
    children_map: dict[uuid.UUID | None, list[Org]] = {}
    for org in orgs:
        children_map.setdefault(org.parent_id, []).append(org)

    def _recurse(pid: uuid.UUID | None) -> list[OrgTree]:
        return [
            OrgTree.model_validate(o).model_copy(update={"children": _recurse(o.id)})
            for o in children_map.get(pid, [])
        ]

    return _recurse(parent_id)


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
    updates = data.model_dump(exclude_unset=True)
    if "description" not in updates:
        note = updates.pop("note", None)
        remark = updates.pop("remark", None)
        if note is not None:
            updates["description"] = note
        elif remark is not None:
            updates["description"] = remark
    else:
        updates.pop("note", None)
        updates.pop("remark", None)

    parent_id = updates.get("parent_id")
    if parent_id == position.id:
        raise ValueError("職位不可將自己設為上級")
    if parent_id is not None:
        parent_result = await db.execute(select(Position).where(Position.id == parent_id))
        parent = parent_result.scalar_one_or_none()
        if parent is None:
            raise ValueError("指定的上級職位不存在")
        if parent.org_id != position.org_id:
            raise ValueError("上級職位必須位於同一組織")

    for field, value in updates.items():
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
        .options(selectinload(UserPosition.position).selectinload(Position.org))
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
    check_date = on_date or local_today()
    result = await db.execute(
        select(UserPosition)
        .where(
            UserPosition.user_id == user_id,
            UserPosition.start_date <= check_date,
            (UserPosition.end_date.is_(None)) | (UserPosition.end_date >= check_date),
        )
        .options(
            selectinload(UserPosition.position).selectinload(Position.permissions),
            selectinload(UserPosition.position).selectinload(Position.org),
        )
    )
    return list(result.scalars().all())
