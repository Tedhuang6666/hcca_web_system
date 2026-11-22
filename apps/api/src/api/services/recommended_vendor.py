"""推薦商家業務邏輯。"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.search import like_contains
from api.models.recommended_vendor import (
    RecommendedVendor,
    RecommendedVendorCategory,
    RecommendedVendorMenu,
    RecommendedVendorProduct,
    RecommendedVendorStatus,
)
from api.schemas.recommended_vendor import (
    RecommendedVendorCategoryCreate,
    RecommendedVendorCategoryUpdate,
    RecommendedVendorCreate,
    RecommendedVendorMenuCreate,
    RecommendedVendorMenuUpdate,
    RecommendedVendorProductCreate,
    RecommendedVendorProductUpdate,
    RecommendedVendorUpdate,
)
from api.services._base import apply_updates


def hygiene_verified(vendor: RecommendedVendor, today: date | None = None) -> bool:
    today = today or date.today()
    if vendor.hygiene_inspection_date is None:
        return False
    return (
        vendor.hygiene_inspection_expires_at is None
        or vendor.hygiene_inspection_expires_at >= today
    )


def _vendor_options():
    return (
        selectinload(RecommendedVendor.products),
        selectinload(RecommendedVendor.menus),
        selectinload(RecommendedVendor.vendor_category),
    )


async def list_categories(
    db: AsyncSession, *, active_only: bool = False
) -> list[RecommendedVendorCategory]:
    query = select(RecommendedVendorCategory).order_by(
        RecommendedVendorCategory.sort_order, RecommendedVendorCategory.name
    )
    if active_only:
        query = query.where(RecommendedVendorCategory.is_active.is_(True))
    return list((await db.execute(query)).scalars().all())


async def get_category(
    db: AsyncSession, category_id: uuid.UUID
) -> RecommendedVendorCategory | None:
    return await db.get(RecommendedVendorCategory, category_id)


async def create_category(
    db: AsyncSession, data: RecommendedVendorCategoryCreate
) -> RecommendedVendorCategory:
    category = RecommendedVendorCategory(**data.model_dump())
    db.add(category)
    await db.flush()
    return category


async def update_category(
    db: AsyncSession,
    category: RecommendedVendorCategory,
    data: RecommendedVendorCategoryUpdate,
) -> RecommendedVendorCategory:
    apply_updates(category, data)
    await db.flush()
    return category


async def get_vendor(db: AsyncSession, vendor_id: uuid.UUID) -> RecommendedVendor | None:
    result = await db.execute(
        select(RecommendedVendor)
        .where(RecommendedVendor.id == vendor_id)
        .options(*_vendor_options())
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def list_vendors(
    db: AsyncSession,
    *,
    include_inactive: bool = False,
    keyword: str | None = None,
    category_id: uuid.UUID | None = None,
    map_only: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> list[RecommendedVendor]:
    query = select(RecommendedVendor).options(*_vendor_options())
    if not include_inactive:
        query = query.where(
            RecommendedVendor.status == RecommendedVendorStatus.ACTIVE.value,
            RecommendedVendor.is_active.is_(True),
            RecommendedVendor.hygiene_inspection_date.is_not(None),
            or_(
                RecommendedVendor.hygiene_inspection_expires_at.is_(None),
                RecommendedVendor.hygiene_inspection_expires_at >= date.today(),
            ),
        )
    if keyword:
        term = like_contains(keyword.strip())
        query = query.where(
            or_(
                RecommendedVendor.name.ilike(term),
                RecommendedVendor.summary.ilike(term),
                RecommendedVendor.description.ilike(term),
                RecommendedVendor.category.ilike(term),
                RecommendedVendor.vendor_category.has(RecommendedVendorCategory.name.ilike(term)),
                RecommendedVendor.address.ilike(term),
            )
        )
    if category_id:
        query = query.where(RecommendedVendor.category_id == category_id)
    if map_only:
        query = query.where(
            RecommendedVendor.latitude.is_not(None), RecommendedVendor.longitude.is_not(None)
        )
    query = (
        query.order_by(RecommendedVendor.sort_order, RecommendedVendor.name)
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(query)
    return list(result.scalars().unique().all())


async def create_vendor(
    db: AsyncSession, data: RecommendedVendorCreate, created_by: uuid.UUID | None
) -> RecommendedVendor:
    fields = data.model_dump(exclude={"products"})
    fields["status"] = str(fields["status"])
    vendor = RecommendedVendor(**fields, created_by=created_by)
    vendor.products = [
        RecommendedVendorProduct(**product.model_dump()) for product in data.products
    ]
    db.add(vendor)
    await db.flush()
    return await get_vendor(db, vendor.id)  # type: ignore[return-value]


async def update_vendor(
    db: AsyncSession, vendor: RecommendedVendor, data: RecommendedVendorUpdate
) -> RecommendedVendor:
    fields = data.model_dump(exclude_unset=True)
    if "status" in fields and fields["status"] is not None:
        fields["status"] = str(fields["status"])
    apply_updates(vendor, RecommendedVendorUpdate.model_validate(fields))
    await db.flush()
    return await get_vendor(db, vendor.id)  # type: ignore[return-value]


async def create_product(
    db: AsyncSession, vendor: RecommendedVendor, data: RecommendedVendorProductCreate
) -> RecommendedVendorProduct:
    product = RecommendedVendorProduct(vendor_id=vendor.id, **data.model_dump())
    db.add(product)
    await db.flush()
    await db.refresh(product)
    return product


async def update_product(
    db: AsyncSession, product: RecommendedVendorProduct, data: RecommendedVendorProductUpdate
) -> RecommendedVendorProduct:
    apply_updates(product, data)
    await db.flush()
    await db.refresh(product)
    return product


async def get_product(db: AsyncSession, product_id: uuid.UUID) -> RecommendedVendorProduct | None:
    return await db.get(RecommendedVendorProduct, product_id)


async def get_menu(db: AsyncSession, menu_id: uuid.UUID) -> RecommendedVendorMenu | None:
    return await db.get(RecommendedVendorMenu, menu_id)


async def create_menu(
    db: AsyncSession, vendor: RecommendedVendor, data: RecommendedVendorMenuCreate
) -> RecommendedVendorMenu:
    if not data.url:
        raise ValueError("外部連結菜單必須提供 URL")
    menu = RecommendedVendorMenu(vendor_id=vendor.id, **data.model_dump(mode="json"))
    db.add(menu)
    await db.flush()
    await db.refresh(menu)
    return menu


async def update_menu(
    db: AsyncSession, menu: RecommendedVendorMenu, data: RecommendedVendorMenuUpdate
) -> RecommendedVendorMenu:
    apply_updates(menu, data)
    await db.flush()
    await db.refresh(menu)
    return menu


async def delete_menu(db: AsyncSession, menu: RecommendedVendorMenu) -> str | None:
    storage_key = menu.storage_key
    await db.delete(menu)
    return storage_key


async def delete_product(db: AsyncSession, product: RecommendedVendorProduct) -> None:
    await db.delete(product)


async def delete_vendor(db: AsyncSession, vendor: RecommendedVendor) -> None:
    vendor.status = RecommendedVendorStatus.ARCHIVED.value
    vendor.is_active = False
    await db.flush()
