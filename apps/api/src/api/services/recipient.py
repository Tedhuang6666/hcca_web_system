"""收件人解析服務 — 將收件條件解析為去重後的收件人清單。

供電子郵件寄送頁（個別 / 職位 / 組織 / 全體）與預約寄送共用。
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.models.org import Position, UserPosition
from api.models.user import User
from api.services.permission import active_tenure_filter


async def get_users_by_position(
    db: AsyncSession, position_id: uuid.UUID, on_date: date | None = None
) -> list[User]:
    """查某職位在指定日期仍在任的所有 active 使用者。"""
    check_date = on_date or date.today()
    result = await db.execute(
        select(User)
        .join(UserPosition, UserPosition.user_id == User.id)
        .where(
            UserPosition.position_id == position_id,
            *active_tenure_filter(check_date),
            User.is_active.is_(True),
        )
        .distinct()
    )
    return list(result.scalars().all())


async def get_members_by_org(
    db: AsyncSession, org_id: uuid.UUID, on_date: date | None = None
) -> list[User]:
    """查某組織所有職位在指定日期仍在任的所有 active 使用者。"""
    check_date = on_date or date.today()
    result = await db.execute(
        select(User)
        .join(UserPosition, UserPosition.user_id == User.id)
        .join(Position, Position.id == UserPosition.position_id)
        .where(
            Position.org_id == org_id,
            *active_tenure_filter(check_date),
            User.is_active.is_(True),
        )
        .distinct()
    )
    return list(result.scalars().all())


def spec_to_resolve_kwargs(spec: dict) -> dict:
    """把儲存的收件條件 JSON（字串 UUID）轉為 resolve_recipients 的參數。"""
    return {
        "user_ids": [uuid.UUID(x) for x in spec.get("user_ids", [])],
        "position_ids": [uuid.UUID(x) for x in spec.get("position_ids", [])],
        "org_ids": [uuid.UUID(x) for x in spec.get("org_ids", [])],
        "include_all": bool(spec.get("include_all", False)),
        "include_school": bool(spec.get("include_school", False)),
    }


async def get_users_by_ids(db: AsyncSession, user_ids: list[uuid.UUID]) -> list[User]:
    """查指定 id 的 active 使用者。"""
    if not user_ids:
        return []
    result = await db.execute(select(User).where(User.id.in_(user_ids), User.is_active.is_(True)))
    return list(result.scalars().all())


async def get_all_active_users(db: AsyncSession) -> list[User]:
    """查全平台 active 使用者（含校外/管理員帳號）。"""
    result = await db.execute(select(User).where(User.is_active.is_(True)))
    return list(result.scalars().all())


async def get_school_users(db: AsyncSession) -> list[User]:
    """查全部 active 且 email 屬校內網域的使用者（排除校外/管理員帳號）。"""
    domains = settings.LOGIN_ALLOWED_EMAIL_DOMAINS
    if not domains:
        return []
    patterns = [func.lower(User.email).like(f"%@{d}") for d in domains]
    result = await db.execute(select(User).where(User.is_active.is_(True), or_(*patterns)))
    return list(result.scalars().all())


async def resolve_recipients(
    db: AsyncSession,
    *,
    user_ids: list[uuid.UUID] | None = None,
    position_ids: list[uuid.UUID] | None = None,
    org_ids: list[uuid.UUID] | None = None,
    include_all: bool = False,
    include_school: bool = False,
) -> tuple[list[User], list[str]]:
    """把收件條件合併解析為去重後的收件人，回傳 (users, emails)。

    include_all（全部使用者）優先於 include_school（全部校內使用者）；
    兩者皆未設定時才採 user_ids / position_ids / org_ids 合併。
    去重：先以 user.id 去重（同一人多職位/多組織只算一次），再以 email
    小寫正規化去重（防大小寫不同的同信箱）；無有效 email 的使用者被排除。
    回傳的 users 與 emails 一一對應、長度相同。
    """
    seen_users: set[uuid.UUID] = set()
    merged: list[User] = []

    def _merge(batch: list[User]) -> None:
        for u in batch:
            if u.id not in seen_users:
                seen_users.add(u.id)
                merged.append(u)

    if include_all:
        _merge(await get_all_active_users(db))
    elif include_school:
        _merge(await get_school_users(db))
    else:
        if user_ids:
            _merge(await get_users_by_ids(db, user_ids))
        for pid in position_ids or []:
            _merge(await get_users_by_position(db, pid))
        for oid in org_ids or []:
            _merge(await get_members_by_org(db, oid))

    seen_emails: set[str] = set()
    users: list[User] = []
    emails: list[str] = []
    for u in merged:
        normalized = (u.email or "").strip().lower()
        if normalized and normalized not in seen_emails:
            seen_emails.add(normalized)
            users.append(u)
            emails.append(u.email)
    return users, emails
