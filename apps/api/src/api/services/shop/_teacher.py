"""教師訂購資料僅由本人修改；訂單保存建立當時的姓名與處室。"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.shop_teacher import ShopOffice, ShopTeacherProfile
from api.models.user import User
from api.schemas.shop_teacher import (
    ShopOfficeCreate,
    ShopOfficeOut,
    ShopOfficeReorder,
    ShopOfficeUpdate,
    ShopTeacherProfileOut,
    ShopTeacherProfileUpdate,
)
from api.services.electronic_credential import get_settings, identity_for_user
from api.services.student_identity import has_student_identity


async def is_teacher(session: AsyncSession, user: User) -> bool:
    # 與商品自行訂購資格一致：已綁定的在校學生不因主要信箱而變成教師。
    if await has_student_identity(session, user, current_only=True):
        return False
    prefixes = (await get_settings(session)).student_id_prefixes
    identity = identity_for_user(user, student_id_prefixes=prefixes)
    return identity is not None and identity[0] == "teacher"


async def list_offices(
    session: AsyncSession, *, include_inactive: bool = False
) -> list[ShopOffice]:
    query = select(ShopOffice).order_by(ShopOffice.sort_order, ShopOffice.id)
    if not include_inactive:
        query = query.where(ShopOffice.is_active.is_(True))
    return list(await session.scalars(query))


async def create_office(session: AsyncSession, data: ShopOfficeCreate) -> ShopOffice:
    last_order = await session.scalar(select(func.max(ShopOffice.sort_order)))
    if last_order == 2147483647:
        raise ValueError("顯示順序已達上限，請先降低現有處室的順序再新增。")
    office = ShopOffice(name=data.name, sort_order=last_order + 1 if last_order is not None else 0)
    session.add(office)
    await session.flush()
    return office


async def update_office(
    session: AsyncSession, office: ShopOffice, data: ShopOfficeUpdate
) -> ShopOffice:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(office, field, value)
    await session.flush()
    return office


async def reorder_offices(session: AsyncSession, data: ShopOfficeReorder) -> list[ShopOffice]:
    offices = list(
        await session.scalars(select(ShopOffice).order_by(ShopOffice.id).with_for_update())
    )
    by_id = {office.id: office for office in offices}
    if set(data.office_ids) != set(by_id):
        raise ValueError("處室清單已變動，請重新載入後再排序。")
    ordered = [by_id[office_id] for office_id in data.office_ids]
    for index, office in enumerate(ordered):
        office.sort_order = index
    await session.flush()
    return ordered


async def get_profile(session: AsyncSession, user: User) -> ShopTeacherProfileOut | None:
    if not await is_teacher(session, user):
        return None
    profile = await session.get(ShopTeacherProfile, user.id)
    office = await session.get(ShopOffice, profile.office_id) if profile else None
    return ShopTeacherProfileOut(
        name=profile.name if profile else None,
        office_id=profile.office_id if profile else None,
        office_name=office.name if office else None,
        offices=[ShopOfficeOut.model_validate(row) for row in await list_offices(session)],
    )


async def save_profile(
    session: AsyncSession, user: User, data: ShopTeacherProfileUpdate
) -> ShopTeacherProfileOut:
    if not await is_teacher(session, user):
        raise PermissionError("僅教師可設定教師訂購資料")
    # 與登記流程共用本人鎖，首次儲存並發時也不會建立重複資料。
    await session.execute(select(User.id).where(User.id == user.id).with_for_update())
    office = await session.scalar(
        select(ShopOffice).where(ShopOffice.id == data.office_id).with_for_update(read=True)
    )
    if office is None or not office.is_active:
        raise ValueError("此處室已停用或不存在，請重新選擇")
    profile = await session.get(ShopTeacherProfile, user.id)
    if profile is None:
        profile = ShopTeacherProfile(user_id=user.id, name=data.name, office_id=office.id)
        session.add(profile)
    else:
        profile.name = data.name
        profile.office_id = office.id
    await session.flush()
    return ShopTeacherProfileOut(
        name=profile.name,
        office_id=profile.office_id,
        office_name=office.name,
        offices=[ShopOfficeOut.model_validate(row) for row in await list_offices(session)],
    )


async def buyer_snapshot(session: AsyncSession, user: User) -> dict[str, str | None]:
    profile = await session.get(ShopTeacherProfile, user.id)
    if profile is None or not await is_teacher(session, user):
        return {}
    office = await session.get(ShopOffice, profile.office_id)
    return {"buyer_name": profile.name, "buyer_office": office.name if office else None}
