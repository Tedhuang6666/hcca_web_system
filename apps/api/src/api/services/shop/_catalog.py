"""商品目錄：分類 / 系列 / 商品 CRUD / 變體 / 瀏覽樹"""
from __future__ import annotations

import logging
import uuid

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import now_local
from api.models.shop import (
    Product,
    ProductCategory,
    ProductSeries,
    ProductStatus,
    ProductVariantGroup,
    ProductVariantOption,
)
from api.schemas.shop import (
    CatalogCategoryOut,
    CatalogProductOut,
    CatalogSeriesOut,
    ProductCategoryCreate,
    ProductCategoryUpdate,
    ProductCreate,
    ProductSeriesCreate,
    ProductSeriesUpdate,
    ProductUpdate,
    ProductVariantGroupCreate,
    ProductVariantGroupUpdate,
    ProductVariantOptionCreate,
    ProductVariantOptionUpdate,
)

logger = logging.getLogger(__name__)


async def generate_order_serial(session: AsyncSession) -> str:
    """使用 PostgreSQL Sequence 原子性生成訂單字號：ORD-YYYY-NNNNNN。"""
    result = await session.execute(text("SELECT nextval('order_serial_seq')"))
    seq_val: int = result.scalar_one()
    year = now_local().year
    return f"ORD-{year}-{seq_val:06d}"


async def get_category(session: AsyncSession, category_id: uuid.UUID) -> ProductCategory | None:
    result = await session.execute(select(ProductCategory).where(ProductCategory.id == category_id))
    return result.scalar_one_or_none()


async def list_categories(
    session: AsyncSession,
    *,
    org_id: uuid.UUID | None = None,
    activity_id: uuid.UUID | None = None,
    include_inactive: bool = True,
) -> list[ProductCategory]:
    q = select(ProductCategory)
    if org_id:
        q = q.where(ProductCategory.org_id == org_id)
    if activity_id:
        q = q.where(ProductCategory.activity_id == activity_id)
    if not include_inactive:
        q = q.where(ProductCategory.is_active.is_(True))
    q = q.order_by(ProductCategory.sort_order, ProductCategory.created_at)
    result = await session.execute(q)
    return list(result.scalars().all())


async def create_category(
    session: AsyncSession, *, data: ProductCategoryCreate, created_by: uuid.UUID
) -> ProductCategory:
    category = ProductCategory(
        org_id=data.org_id,
        activity_id=data.activity_id,
        name=data.name,
        description=data.description,
        image_url=data.image_url,
        sort_order=data.sort_order,
        created_by=created_by,
    )
    session.add(category)
    await session.flush()
    return category


async def update_category(
    session: AsyncSession, category: ProductCategory, *, data: ProductCategoryUpdate
) -> ProductCategory:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(category, field, value)
    await session.flush()
    return category


async def delete_category(session: AsyncSession, category: ProductCategory) -> None:
    result = await session.execute(
        select(ProductSeries.id).where(ProductSeries.category_id == category.id).limit(1)
    )
    if result.scalar_one_or_none() is not None:
        raise ValueError("主題下仍有系列，無法刪除（請先刪除或移動系列）")
    await session.delete(category)
    await session.flush()


async def get_series(session: AsyncSession, series_id: uuid.UUID) -> ProductSeries | None:
    result = await session.execute(select(ProductSeries).where(ProductSeries.id == series_id))
    return result.scalar_one_or_none()


async def list_series(
    session: AsyncSession,
    *,
    category_id: uuid.UUID | None = None,
    include_inactive: bool = True,
) -> list[ProductSeries]:
    q = select(ProductSeries)
    if category_id:
        q = q.where(ProductSeries.category_id == category_id)
    if not include_inactive:
        q = q.where(ProductSeries.is_active.is_(True))
    q = q.order_by(ProductSeries.sort_order, ProductSeries.created_at)
    result = await session.execute(q)
    return list(result.scalars().all())


async def create_series(session: AsyncSession, *, data: ProductSeriesCreate) -> ProductSeries:
    category = await get_category(session, data.category_id)
    if category is None:
        raise ValueError("找不到所屬主題")
    series = ProductSeries(
        category_id=data.category_id,
        name=data.name,
        description=data.description,
        image_url=data.image_url,
        sort_order=data.sort_order,
    )
    session.add(series)
    await session.flush()
    return series


async def update_series(
    session: AsyncSession, series: ProductSeries, *, data: ProductSeriesUpdate
) -> ProductSeries:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(series, field, value)
    await session.flush()
    return series


async def delete_series(session: AsyncSession, series: ProductSeries) -> None:
    result = await session.execute(
        select(Product.id).where(Product.series_id == series.id).limit(1)
    )
    if result.scalar_one_or_none() is not None:
        raise ValueError("系列下仍有商品，無法刪除（請先刪除或移動商品）")
    await session.delete(series)
    await session.flush()


async def get_product(session: AsyncSession, product_id: uuid.UUID) -> Product | None:
    result = await session.execute(
        select(Product)
        .options(
            selectinload(Product.variant_groups).selectinload(ProductVariantGroup.options),
            selectinload(Product.series).selectinload(ProductSeries.category),
        )
        .where(Product.id == product_id)
    )
    return result.scalar_one_or_none()


async def list_products(
    session: AsyncSession,
    *,
    org_id: uuid.UUID | None = None,
    activity_id: uuid.UUID | None = None,
    series_id: uuid.UUID | None = None,
    status: ProductStatus | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[Product]:
    q = select(Product).options(
        selectinload(Product.variant_groups).selectinload(ProductVariantGroup.options)
    )
    if org_id:
        q = q.where(Product.org_id == org_id)
    if activity_id:
        q = q.join(ProductSeries, Product.series_id == ProductSeries.id).join(
            ProductCategory, ProductSeries.category_id == ProductCategory.id
        )
        q = q.where(ProductCategory.activity_id == activity_id)
    if series_id:
        q = q.where(Product.series_id == series_id)
    if status:
        q = q.where(Product.status == status)
    q = q.order_by(Product.created_at.desc()).limit(limit).offset(offset)
    result = await session.execute(q)
    return list(result.scalars().unique().all())


async def create_product(
    session: AsyncSession, *, data: ProductCreate, created_by: uuid.UUID
) -> Product:
    series = await get_series(session, data.series_id)
    if series is None:
        raise ValueError("找不到所屬系列")
    category = await get_category(session, series.category_id)
    if category is None:
        raise ValueError("系列所屬主題不存在")

    product = Product(
        name=data.name,
        description=data.description,
        image_url=data.image_url,
        price=data.price,
        stock_quantity=data.stock_quantity,
        is_unlimited=data.is_unlimited,
        series_id=series.id,
        org_id=category.org_id,
        created_by=created_by,
        sale_start=data.sale_start,
        sale_end=data.sale_end,
        requires_seating=data.requires_seating,
        seating_mode=data.seating_mode,
        status=ProductStatus.DRAFT,
    )
    session.add(product)
    await session.flush()

    for gi, group_data in enumerate(data.variant_groups):
        group = ProductVariantGroup(
            product_id=product.id,
            name=group_data.name,
            sort_order=group_data.sort_order or gi,
        )
        session.add(group)
        await session.flush()
        for oi, option_data in enumerate(group_data.options):
            session.add(
                ProductVariantOption(
                    group_id=group.id,
                    value=option_data.value,
                    image_url=option_data.image_url,
                    price_delta=option_data.price_delta,
                    sort_order=option_data.sort_order or oi,
                )
            )
    await session.flush()
    logger.info("商品建立 id=%s name=%s", product.id, product.name)
    return await get_product(session, product.id)  # type: ignore[return-value]


async def update_product(
    session: AsyncSession, product: Product, *, data: ProductUpdate
) -> Product:
    if product.status not in (ProductStatus.DRAFT, ProductStatus.ACTIVE, ProductStatus.CANCELLED):
        raise ValueError(f"商品狀態 {product.status} 不允許編輯")
    payload = data.model_dump(exclude_unset=True)
    if "series_id" in payload:
        series = await get_series(session, payload["series_id"])
        if series is None:
            raise ValueError("找不到目標系列")
        category = await get_category(session, series.category_id)
        if category is not None:
            product.org_id = category.org_id
    for field, value in payload.items():
        setattr(product, field, value)
    await session.flush()
    return product


async def activate_product(session: AsyncSession, product: Product) -> Product:
    if product.status not in (ProductStatus.DRAFT, ProductStatus.CANCELLED):
        raise ValueError("只有草稿或已下架商品可以上架")
    product.status = ProductStatus.ACTIVE
    await session.flush()
    return product


async def deactivate_product(session: AsyncSession, product: Product) -> Product:
    if product.status not in (ProductStatus.ACTIVE, ProductStatus.SOLD_OUT):
        raise ValueError("只有上架中或售罄的商品可以下架")
    product.status = ProductStatus.CANCELLED
    await session.flush()
    return product


async def get_variant_group(
    session: AsyncSession, group_id: uuid.UUID
) -> ProductVariantGroup | None:
    result = await session.execute(
        select(ProductVariantGroup)
        .options(selectinload(ProductVariantGroup.options))
        .where(ProductVariantGroup.id == group_id)
    )
    return result.scalar_one_or_none()


async def add_variant_group(
    session: AsyncSession, product: Product, *, data: ProductVariantGroupCreate
) -> ProductVariantGroup:
    group = ProductVariantGroup(product_id=product.id, name=data.name, sort_order=data.sort_order)
    session.add(group)
    await session.flush()
    for oi, option_data in enumerate(data.options):
        session.add(
            ProductVariantOption(
                group_id=group.id,
                value=option_data.value,
                image_url=option_data.image_url,
                price_delta=option_data.price_delta,
                sort_order=option_data.sort_order or oi,
            )
        )
    await session.flush()
    return await get_variant_group(session, group.id)  # type: ignore[return-value]


async def update_variant_group(
    session: AsyncSession, group: ProductVariantGroup, *, data: ProductVariantGroupUpdate
) -> ProductVariantGroup:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(group, field, value)
    await session.flush()
    return group


async def delete_variant_group(session: AsyncSession, group: ProductVariantGroup) -> None:
    await session.delete(group)
    await session.flush()


async def get_variant_option(
    session: AsyncSession, option_id: uuid.UUID
) -> ProductVariantOption | None:
    result = await session.execute(
        select(ProductVariantOption).where(ProductVariantOption.id == option_id)
    )
    return result.scalar_one_or_none()


async def add_variant_option(
    session: AsyncSession,
    group: ProductVariantGroup,
    *,
    data: ProductVariantOptionCreate,
) -> ProductVariantOption:
    option = ProductVariantOption(
        group_id=group.id,
        value=data.value,
        image_url=data.image_url,
        price_delta=data.price_delta,
        sort_order=data.sort_order,
    )
    session.add(option)
    await session.flush()
    return option


async def update_variant_option(
    session: AsyncSession,
    option: ProductVariantOption,
    *,
    data: ProductVariantOptionUpdate,
) -> ProductVariantOption:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(option, field, value)
    await session.flush()
    return option


async def delete_variant_option(session: AsyncSession, option: ProductVariantOption) -> None:
    await session.delete(option)
    await session.flush()


async def build_catalog_tree(
    session: AsyncSession,
    *,
    org_id: uuid.UUID | None = None,
    activity_id: uuid.UUID | None = None,
) -> list[CatalogCategoryOut]:
    q = (
        select(ProductCategory)
        .options(
            selectinload(ProductCategory.series)
            .selectinload(ProductSeries.products)
            .selectinload(Product.variant_groups)
        )
        .where(ProductCategory.is_active.is_(True))
        .order_by(ProductCategory.sort_order, ProductCategory.created_at)
    )
    if org_id:
        q = q.where(ProductCategory.org_id == org_id)
    if activity_id:
        q = q.where(ProductCategory.activity_id == activity_id)
    categories = (await session.execute(q)).scalars().unique().all()

    visible = {ProductStatus.ACTIVE, ProductStatus.SOLD_OUT}
    tree: list[CatalogCategoryOut] = []
    for category in categories:
        series_out: list[CatalogSeriesOut] = []
        for series in sorted(category.series, key=lambda s: (s.sort_order, s.created_at)):
            if not series.is_active:
                continue
            products = [
                CatalogProductOut(
                    id=p.id,
                    name=p.name,
                    image_url=p.image_url,
                    price=p.price,
                    status=p.status,
                    stock_quantity=p.stock_quantity,
                    is_unlimited=p.is_unlimited,
                    sale_start=p.sale_start,
                    sale_end=p.sale_end,
                    has_variants=len(p.variant_groups) > 0,
                    requires_seating=p.requires_seating,
                    seating_mode=p.seating_mode,
                )
                for p in sorted(series.products, key=lambda x: x.created_at)
                if p.status in visible
            ]
            series_out.append(
                CatalogSeriesOut(
                    id=series.id,
                    name=series.name,
                    image_url=series.image_url,
                    sort_order=series.sort_order,
                    products=products,
                )
            )
        tree.append(
            CatalogCategoryOut(
                id=category.id,
                name=category.name,
                activity_id=category.activity_id,
                image_url=category.image_url,
                sort_order=category.sort_order,
                series=series_out,
            )
        )
    return tree
