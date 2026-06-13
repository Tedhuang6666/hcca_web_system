"""商家 / 商品 / 可用時段 / 序號"""

from __future__ import annotations

import logging
import secrets
import uuid
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import now_local
from api.models.meal import (
    MealClassPickupCode,
    MealOrder,
    MealPickupSlot,
    MealProduct,
    MealProductAvailability,
    MealVendor,
    MealVendorApplication,
    MealVendorManager,
    MealVendorStatus,
)
from api.models.org import Org
from api.schemas.meal import (
    MealAvailabilityCreate,
    MealProductCreate,
    MealProductUpdate,
    MealVendorApplicationCreate,
    MealVendorApplicationReview,
    MealVendorCreate,
    MealVendorUpdate,
    MealWeeklyAvailabilityCreate,
)
from api.services._base import apply_updates

logger = logging.getLogger(__name__)


# ── 序號 / 取餐代碼生成 ───────────────────────────────────────────────────────


async def generate_meal_serial(session: AsyncSession) -> str:
    """
    使用 PostgreSQL Sequence 原子性生成學餐訂單字號：MEAL-YYYY-NNNNNN。
    Sequence `meal_serial_seq` 在 Alembic migration 中建立。
    """
    result = await session.execute(text("SELECT nextval('meal_serial_seq')"))
    seq_val: int = result.scalar_one()
    year = now_local().year
    return f"MEAL-{year}-{seq_val:06d}"


async def generate_pickup_code(session: AsyncSession, max_attempts: int = 10) -> str:
    """
    生成唯一 5 位數取餐代碼（10000–99999）。
    碰撞機率極低（每日訂單 << 90000），最多重試 10 次後拋出例外。
    """
    import random

    for _ in range(max_attempts):
        code = str(random.randint(10000, 99999))  # nosec B311  # noqa: S311 (非密碼學用途)
        exists = await session.execute(
            select(MealOrder.id).where(MealOrder.pickup_code == code).limit(1)
        )
        if exists.scalar_one_or_none() is None:
            return code
    raise RuntimeError("無法生成唯一取餐代碼，請稍後再試")


async def generate_class_pickup_code(session: AsyncSession, max_attempts: int = 10) -> str:
    for _ in range(max_attempts):
        code = secrets.token_urlsafe(6).replace("-", "").replace("_", "")[:8].upper()
        exists = await session.scalar(
            select(MealClassPickupCode.id).where(MealClassPickupCode.code == code)
        )
        if exists is None:
            return code
    raise RuntimeError("無法生成班級領取碼，請稍後再試")


# ── 商家 CRUD ─────────────────────────────────────────────────────────────────


async def _get_or_create_vendor_root_org(session: AsyncSession) -> Org:
    root = await session.scalar(select(Org).where(Org.name == "學餐商家", Org.parent_id.is_(None)))
    if root is None:
        root = Org(name="學餐商家", description="學餐平台自動建立的商家組織群")
        session.add(root)
        await session.flush()
    return root


async def _create_vendor_org(session: AsyncSession, vendor_name: str) -> uuid.UUID:
    root = await _get_or_create_vendor_root_org(session)
    org = Org(
        name=f"商家：{vendor_name}",
        description="學餐商家自動建立的 RBAC 組織",
        parent_id=root.id,
    )
    session.add(org)
    await session.flush()
    return org.id


async def get_vendor(session: AsyncSession, vendor_id: uuid.UUID) -> MealVendor | None:
    result = await session.execute(select(MealVendor).where(MealVendor.id == vendor_id))
    return result.scalar_one_or_none()


async def list_vendors(
    session: AsyncSession,
    *,
    org_id: uuid.UUID | None = None,
    active_only: bool = True,
    limit: int = 50,
    offset: int = 0,
) -> list[MealVendor]:
    q = select(MealVendor)
    if org_id:
        q = q.where(MealVendor.org_id == org_id)
    if active_only:
        q = q.where(MealVendor.is_active == True)  # noqa: E712
        q = q.where(MealVendor.status == MealVendorStatus.APPROVED)
    q = q.order_by(MealVendor.name).limit(limit).offset(offset)
    result = await session.execute(q)
    return list(result.scalars().all())


async def create_vendor(
    session: AsyncSession, *, data: MealVendorCreate, created_by: uuid.UUID
) -> MealVendor:
    org_id = data.org_id or await _create_vendor_org(session, data.name)
    vendor = MealVendor(
        name=data.name,
        description=data.description,
        contact_phone=data.contact_phone,
        contact_email=data.contact_email,
        org_id=org_id,
        created_by=created_by,
        status=data.status or MealVendorStatus.APPROVED,
    )
    session.add(vendor)
    await session.flush()
    if data.manager_email:
        await assign_vendor_manager(session, vendor, str(data.manager_email))
    logger.info("商家建立 id=%s name=%s", vendor.id, vendor.name)
    return vendor


async def create_vendor_application(
    session: AsyncSession, *, data: MealVendorApplicationCreate
) -> MealVendorApplication:
    payload = data.model_dump()
    payload["org_id"] = data.org_id or await _create_vendor_org(session, data.name)
    app = MealVendorApplication(**payload, status=MealVendorStatus.PENDING_REVIEW)
    session.add(app)
    await session.flush()
    return app


async def list_vendor_applications(
    session: AsyncSession, *, status: str | None = None, limit: int = 50, offset: int = 0
) -> list[MealVendorApplication]:
    q = select(MealVendorApplication).order_by(MealVendorApplication.created_at.desc())
    if status:
        q = q.where(MealVendorApplication.status == status)
    q = q.limit(limit).offset(offset)
    result = await session.execute(q)
    return list(result.scalars().all())


async def review_vendor_application(
    session: AsyncSession,
    app: MealVendorApplication,
    *,
    data: MealVendorApplicationReview,
    reviewer_id: uuid.UUID,
) -> MealVendorApplication:
    if app.status != MealVendorStatus.PENDING_REVIEW:
        raise ValueError("此申請已審核，不能重複處理")
    app.status = MealVendorStatus.APPROVED if data.approved else MealVendorStatus.REJECTED
    app.review_note = data.review_note
    app.reviewed_by_id = reviewer_id
    app.reviewed_at = datetime.now(UTC)
    if data.approved:
        vendor = MealVendor(
            name=app.name,
            description=app.description,
            contact_phone=app.contact_phone,
            contact_email=app.contact_email,
            org_id=app.org_id,
            created_by=reviewer_id,
            status=MealVendorStatus.APPROVED,
            is_active=True,
        )
        session.add(vendor)
        await session.flush()
        app.vendor_id = vendor.id
    await session.flush()
    return app


async def get_vendor_application(
    session: AsyncSession, application_id: uuid.UUID
) -> MealVendorApplication | None:
    return await session.get(MealVendorApplication, application_id)


async def is_vendor_manager(
    session: AsyncSession, vendor_id: uuid.UUID, user_id: uuid.UUID
) -> bool:
    exists = await session.scalar(
        select(MealVendorManager.id).where(
            MealVendorManager.vendor_id == vendor_id,
            MealVendorManager.user_id == user_id,
            MealVendorManager.is_active.is_(True),
        )
    )
    return exists is not None


async def list_vendor_managers(
    session: AsyncSession, vendor_id: uuid.UUID
) -> list[MealVendorManager]:
    result = await session.execute(
        select(MealVendorManager)
        .options(selectinload(MealVendorManager.user))
        .where(MealVendorManager.vendor_id == vendor_id, MealVendorManager.is_active.is_(True))
        .order_by(MealVendorManager.created_at)
    )
    return list(result.scalars().all())


async def remove_vendor_manager(
    session: AsyncSession, vendor_id: uuid.UUID, user_id: uuid.UUID
) -> bool:
    manager = await session.scalar(
        select(MealVendorManager).where(
            MealVendorManager.vendor_id == vendor_id,
            MealVendorManager.user_id == user_id,
            MealVendorManager.is_active.is_(True),
        )
    )
    if manager is None:
        return False
    manager.is_active = False
    await session.flush()
    return True


async def update_vendor(
    session: AsyncSession, vendor: MealVendor, *, data: MealVendorUpdate
) -> MealVendor:
    apply_updates(vendor, data, exclude_none=True)
    await session.flush()
    return vendor


async def assign_vendor_manager(
    session: AsyncSession,
    vendor: MealVendor,
    email: str,
) -> dict:
    """
    以 email 查找使用者，在商家所屬組織找或建立「學餐管理員」職位（含 meal:manage 權限），
    並將該使用者指派到此職位。
    回傳 {user_id, display_name, position_id, user_position_id}。
    """
    from datetime import date as date_type

    from sqlalchemy import and_

    from api.models.org import Permission, Position, UserPosition
    from api.models.user import User

    user_result = await session.execute(select(User).where(User.email == email.lower().strip()))
    user = user_result.scalar_one_or_none()
    if user is None:
        raise ValueError(f"找不到 email 為 {email} 的使用者")

    pos_result = await session.execute(
        select(Position).where(
            and_(Position.org_id == vendor.org_id, Position.name == "學餐管理員")
        )
    )
    position = pos_result.scalar_one_or_none()

    if position is None:
        position = Position(
            name="學餐管理員",
            org_id=vendor.org_id,
        )
        session.add(position)
        await session.flush()
        session.add(Permission(position_id=position.id, code="meal:manage"))
        await session.flush()

    existing = await session.execute(
        select(UserPosition).where(
            and_(
                UserPosition.user_id == user.id,
                UserPosition.position_id == position.id,
                UserPosition.end_date.is_(None),
            )
        )
    )
    up = existing.scalar_one_or_none()
    if up is None:
        up = UserPosition(
            user_id=user.id,
            position_id=position.id,
            start_date=date_type.today(),
        )
        session.add(up)
        await session.flush()
        logger.info("商家管理員指派 vendor=%s user=%s", vendor.id, user.id)
    manager = await session.scalar(
        select(MealVendorManager).where(
            MealVendorManager.vendor_id == vendor.id,
            MealVendorManager.user_id == user.id,
        )
    )
    if manager is None:
        manager = MealVendorManager(
            vendor_id=vendor.id,
            user_id=user.id,
            position_id=position.id,
            user_position_id=up.id,
            is_active=True,
        )
        session.add(manager)
    else:
        manager.is_active = True
        manager.position_id = position.id
        manager.user_position_id = up.id
    await session.flush()

    return {
        "user_id": str(user.id),
        "display_name": user.display_name,
        "email": user.email,
        "position_id": str(position.id),
        "user_position_id": str(up.id),
    }


# ── 商品 CRUD ─────────────────────────────────────────────────────────────────


async def list_products(
    session: AsyncSession,
    *,
    vendor_id: uuid.UUID | None = None,
    active_only: bool = True,
    limit: int = 100,
    offset: int = 0,
) -> list[MealProduct]:
    q = select(MealProduct).order_by(MealProduct.created_at.desc())
    if vendor_id:
        q = q.where(MealProduct.vendor_id == vendor_id)
    if active_only:
        q = q.where(MealProduct.is_active.is_(True))
    q = q.limit(limit).offset(offset)
    result = await session.execute(q)
    return list(result.scalars().all())


async def get_product(session: AsyncSession, product_id: uuid.UUID) -> MealProduct | None:
    return await session.get(MealProduct, product_id)


async def create_product(session: AsyncSession, *, data: MealProductCreate) -> MealProduct:
    vendor = await get_vendor(session, data.vendor_id)
    if vendor is None or vendor.status != MealVendorStatus.APPROVED:
        raise ValueError("找不到此商家或商家尚未審核通過")
    product = MealProduct(**data.model_dump())
    session.add(product)
    await session.flush()
    return product


async def update_product(
    session: AsyncSession, product: MealProduct, *, data: MealProductUpdate
) -> MealProduct:
    apply_updates(product, data)
    await session.flush()
    return product


def _combine_service_time(service_date: date, hhmm: str | None) -> datetime | None:
    if not hhmm:
        return None
    hour, minute = [int(part) for part in hhmm.split(":", 1)]
    return datetime.combine(service_date, time(hour=hour, minute=minute), tzinfo=UTC)


async def create_availability(
    session: AsyncSession, *, data: MealAvailabilityCreate
) -> MealProductAvailability:
    product = await get_product(session, data.product_id)
    if product is None or not product.is_active:
        raise ValueError("找不到商品或已停用")
    availability = MealProductAvailability(
        product_id=product.id,
        vendor_id=product.vendor_id,
        service_date=data.service_date,
        sale_start=data.sale_start,
        sale_end=data.sale_end,
        price=data.price if data.price is not None else product.price,
        max_quantity=(
            data.max_quantity if data.max_quantity is not None else product.default_max_quantity
        ),
        note=data.note,
    )
    availability.product = product
    for slot in data.pickup_slots:
        if slot.order_deadline >= slot.pickup_start:
            raise ValueError("取餐時段的訂購截止時間必須早於取餐開始時間")
        if slot.pickup_end <= slot.pickup_start:
            raise ValueError("取餐結束時間必須晚於開始時間")
        availability.pickup_slots.append(MealPickupSlot(**slot.model_dump()))
    session.add(availability)
    await session.flush()
    return availability


async def bulk_create_weekly_availabilities(
    session: AsyncSession, *, data: MealWeeklyAvailabilityCreate
) -> list[MealProductAvailability]:
    if data.date_to < data.date_from:
        raise ValueError("結束日期不可早於開始日期")
    products = (
        (await session.execute(select(MealProduct).where(MealProduct.id.in_(data.product_ids))))
        .scalars()
        .all()
    )
    product_by_id = {product.id: product for product in products}
    if len(product_by_id) != len(set(data.product_ids)):
        raise ValueError("包含不存在的商品")
    created: list[MealProductAvailability] = []
    day = data.date_from
    while day <= data.date_to:
        if day.weekday() in data.weekdays:
            for product_id in data.product_ids:
                product = product_by_id[product_id]
                availability = MealProductAvailability(
                    product_id=product.id,
                    vendor_id=product.vendor_id,
                    service_date=day,
                    sale_start=_combine_service_time(day, data.sale_start_time),
                    sale_end=_combine_service_time(day, data.sale_end_time),
                    price=product.price,
                    max_quantity=product.default_max_quantity,
                )
                availability.product = product
                for slot in data.pickup_slots:
                    availability.pickup_slots.append(MealPickupSlot(**slot.model_dump()))
                session.add(availability)
                created.append(availability)
        day += timedelta(days=1)
    await session.flush()
    return created


async def list_availabilities(
    session: AsyncSession,
    *,
    vendor_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    active_only: bool = True,
    limit: int = 100,
    offset: int = 0,
) -> list[MealProductAvailability]:
    q = (
        select(MealProductAvailability)
        .options(
            selectinload(MealProductAvailability.product),
            selectinload(MealProductAvailability.pickup_slots),
        )
        .order_by(MealProductAvailability.service_date, MealProductAvailability.created_at)
    )
    if vendor_id:
        q = q.where(MealProductAvailability.vendor_id == vendor_id)
    if date_from:
        q = q.where(MealProductAvailability.service_date >= date_from)
    if date_to:
        q = q.where(MealProductAvailability.service_date <= date_to)
    if active_only:
        q = q.where(MealProductAvailability.is_available.is_(True))
    q = q.limit(limit).offset(offset)
    result = await session.execute(q)
    return list(result.scalars().unique().all())


async def get_pickup_slot(session: AsyncSession, slot_id: uuid.UUID) -> MealPickupSlot | None:
    result = await session.execute(
        select(MealPickupSlot)
        .options(
            selectinload(MealPickupSlot.availability).selectinload(MealProductAvailability.product)
        )
        .where(MealPickupSlot.id == slot_id)
    )
    return result.scalar_one_or_none()
