"""班級代訂的身分與資料範圍檢查；不依賴 HTTP 層。"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.person import Person
from api.models.school_class import ClassRosterEntry, SchoolClass
from api.models.user import User
from api.services import school_class as class_svc
from api.services.student_identity_rules import SCHOOL_EMAIL_DOMAIN


class BuyerAuthenticationError(PermissionError):
    pass


async def _class_order_scope_ids(session: AsyncSession, user: User) -> list[uuid.UUID]:
    class_ids = await class_svc.get_cadre_class_ids(session, user.id)
    if user.is_superuser:
        current_class = await class_svc.resolve_user_class(session, user)
        if current_class is not None:
            class_ids.add(current_class.id)
    return list(class_ids)


async def _get_class_member_target(
    session: AsyncSession,
    current_user: User,
    member_user_id: uuid.UUID,
) -> tuple[User, SchoolClass, list[uuid.UUID]]:
    target = await session.get(User, member_user_id)
    if target is None:
        raise LookupError("找不到此學生")
    target_class = await class_svc.resolve_user_class(session, target)
    if target_class is None:
        raise PermissionError("此學生目前沒有可管理的班級")
    class_ids = set(await _class_order_scope_ids(session, current_user))
    if current_user.is_superuser:
        class_ids.add(target_class.id)
    elif target_class.id not in class_ids:
        raise PermissionError("無權管理此學生的商品登記")
    return target, target_class, list(class_ids)


async def _class_purchase_buyer(
    session: AsyncSession, actor: User | None, member_id: uuid.UUID | None
) -> User | None:
    if member_id is None:
        return actor
    if actor is None:
        raise BuyerAuthenticationError("請先登入")
    target = await session.get(User, member_id)
    if target is not None:
        target, _, _ = await _get_class_member_target(session, actor, target.id)
        if not target.is_active:
            raise PermissionError("此學生帳號已停用")
        return target
    entry = await session.get(ClassRosterEntry, member_id)
    if entry is None:
        raise LookupError("找不到此學生")
    school_class = await session.get(SchoolClass, entry.class_id)
    class_ids = await _class_order_scope_ids(session, actor)
    if (
        school_class is None
        or not school_class.is_active
        or (not actor.is_superuser and entry.class_id not in class_ids)
    ):
        raise PermissionError("無權替此學生訂購")
    target = await session.get(User, entry.user_id) if entry.user_id else None
    if target is None:
        target = await session.scalar(
            select(User)
            .join(Person, Person.user_id == User.id)
            .where(Person.student_id == entry.student_id)
        )
    if target is None:
        target = await session.scalar(select(User).where(User.student_id == entry.student_id))
    if target is not None:
        return await _class_purchase_buyer(session, actor, target.id)
    # 查詢資格不預建帳號；使用與實際名冊代訂相同的學號及預設校內信箱。
    return User(
        id=entry.id,
        student_id=entry.student_id,
        email=f"g0{entry.student_id}@{SCHOOL_EMAIL_DOMAIN}",
    )
