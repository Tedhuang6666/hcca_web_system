"""商品目錄：分類 / 系列 / 商品 CRUD / 變體 / 瀏覽樹"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only, selectinload

from api.core.clock import now_local
from api.models.shop import (
    Order,
    OrderItem,
    Product,
    ProductCategory,
    ProductMedia,
    ProductSeries,
    ProductStatus,
    ProductVariantGroup,
    ProductVariantOption,
    ShopDelegationLink,
    ShopOrderClose,
    ShopPromotion,
    effective_product_deadline,
)
from api.models.user import User
from api.schemas.shop import (
    CatalogCategoryOut,
    CatalogProductOut,
    CatalogSeriesOut,
    ProductCategoryCreate,
    ProductCategoryReorder,
    ProductCategoryUpdate,
    ProductCreate,
    ProductReorder,
    ProductSeriesCreate,
    ProductSeriesReorder,
    ProductSeriesUpdate,
    ProductUpdate,
    ProductVariantGroupCreate,
    ProductVariantGroupUpdate,
    ProductVariantOptionCreate,
    ProductVariantOptionUpdate,
)
from api.services._base import apply_updates
from api.services.shop._ordering import product_catalog_ordering
from api.services.shop._purchase_rules import purchase_restrictions
from api.services.shop._visibility import has_purchase_qualifications, public_product_condition

logger = logging.getLogger(__name__)


def _next_sort_order(last_order: int | None) -> int:
    if last_order is not None and last_order >= 2_147_483_647:
        raise ValueError("顯示順序已達上限，請先重新排序再新增。")
    return (last_order if last_order is not None else -1) + 1


def _catalog_image_url(product: Product) -> str | None:
    """Return the same lead image shown first in the product detail gallery."""
    if product.image_url:
        return product.image_url
    return product.media[0].image_url if product.media else None


async def generate_order_serial(session: AsyncSession) -> str:
    """使用 PostgreSQL Sequence 原子性生成訂單字號：ORD-YYYY-NNNNNN。"""
    if session.get_bind().dialect.name == "sqlite":
        last_serial = await session.scalar(
            select(Order.serial_number).order_by(Order.serial_number.desc()).limit(1)
        )
        try:
            seq_val = int(last_serial.rsplit("-", maxsplit=1)[-1]) + 1 if last_serial else 1
        except ValueError:
            seq_val = 1
    else:
        result = await session.execute(text("SELECT nextval('order_serial_seq')"))
        seq_val = result.scalar_one()
    year = now_local().year
    return f"ORD-{year}-{seq_val:06d}"


async def get_category(session: AsyncSession, category_id: uuid.UUID) -> ProductCategory | None:
    result = await session.execute(select(ProductCategory).where(ProductCategory.id == category_id))
    return result.scalar_one_or_none()


async def list_categories(
    session: AsyncSession,
    *,
    activity_id: uuid.UUID | None = None,
    include_inactive: bool = True,
) -> list[ProductCategory]:
    q = select(ProductCategory)
    if activity_id:
        q = q.where(ProductCategory.activity_id == activity_id)
    if not include_inactive:
        q = q.where(ProductCategory.is_active.is_(True))
    q = q.order_by(ProductCategory.sort_order, ProductCategory.created_at, ProductCategory.id)
    result = await session.execute(q)
    return list(result.scalars().all())


async def create_category(
    session: AsyncSession, *, data: ProductCategoryCreate, created_by: uuid.UUID
) -> ProductCategory:
    sort_order = data.sort_order
    if sort_order is None:
        last_order = await session.scalar(select(func.max(ProductCategory.sort_order)))
        sort_order = _next_sort_order(last_order)
    category = ProductCategory(
        activity_id=data.activity_id,
        name=data.name,
        description=data.description,
        image_url=data.image_url,
        sort_order=sort_order,
        created_by=created_by,
    )
    session.add(category)
    await session.flush()
    return category


async def reorder_categories(
    session: AsyncSession, data: ProductCategoryReorder
) -> list[ProductCategory]:
    if len(data.category_ids) != len(set(data.category_ids)):
        raise ValueError("主題清單有重複項目，請重新載入後再排序。")
    categories = list(
        await session.scalars(
            select(ProductCategory).order_by(ProductCategory.id).with_for_update()
        )
    )
    by_id = {category.id: category for category in categories}
    if set(data.category_ids) != set(by_id):
        raise ValueError("主題清單已變動，請重新載入後再排序。")
    ordered = [by_id[category_id] for category_id in data.category_ids]
    for index, category in enumerate(ordered):
        category.sort_order = index
    await session.flush()
    return ordered


async def update_category(
    session: AsyncSession, category: ProductCategory, *, data: ProductCategoryUpdate
) -> ProductCategory:
    apply_updates(category, data)
    await session.flush()
    return category


async def delete_category(session: AsyncSession, category: ProductCategory) -> None:
    result = await session.execute(
        select(ProductSeries.id).where(ProductSeries.category_id == category.id).limit(1)
    )
    direct_product = await session.scalar(
        select(Product.id).where(Product.category_id == category.id).limit(1)
    )
    if result.scalar_one_or_none() is not None or direct_product is not None:
        raise ValueError("活動下仍有系列或商品，無法刪除（請先刪除或移動內容）")
    delegation_link_id = await session.scalar(
        select(ShopDelegationLink.id).where(ShopDelegationLink.category_id == category.id).limit(1)
    )
    if delegation_link_id is not None:
        raise ValueError("活動仍有代訂授權連結，無法刪除（請先刪除或移動連結）")
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
    q = q.order_by(ProductSeries.sort_order, ProductSeries.created_at, ProductSeries.id)
    result = await session.execute(q)
    return list(result.scalars().all())


async def create_series(session: AsyncSession, *, data: ProductSeriesCreate) -> ProductSeries:
    category = await get_category(session, data.category_id)
    if category is None:
        raise ValueError("找不到所屬活動")
    sort_order = data.sort_order
    if sort_order is None:
        last_order = await session.scalar(
            select(func.max(ProductSeries.sort_order)).where(
                ProductSeries.category_id == category.id
            )
        )
        sort_order = _next_sort_order(last_order)
    series = ProductSeries(
        category_id=data.category_id,
        name=data.name,
        description=data.description,
        image_url=data.image_url,
        sort_order=sort_order,
    )
    session.add(series)
    await session.flush()
    return series


async def reorder_series(session: AsyncSession, data: ProductSeriesReorder) -> list[ProductSeries]:
    if len(data.series_ids) != len(set(data.series_ids)):
        raise ValueError("系列清單有重複項目，請重新載入後再排序。")
    series = list(
        await session.scalars(
            select(ProductSeries)
            .where(ProductSeries.category_id == data.category_id)
            .order_by(ProductSeries.id)
            .with_for_update()
        )
    )
    by_id = {item.id: item for item in series}
    if set(data.series_ids) != set(by_id):
        raise ValueError("系列清單已變動，請重新載入後再排序。")
    ordered = [by_id[series_id] for series_id in data.series_ids]
    for index, item in enumerate(ordered):
        item.sort_order = index
    await session.flush()
    return ordered


async def update_series(
    session: AsyncSession, series: ProductSeries, *, data: ProductSeriesUpdate
) -> ProductSeries:
    apply_updates(series, data)
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
            selectinload(Product.category).selectinload(ProductCategory.activity),
            selectinload(Product.series)
            .selectinload(ProductSeries.category)
            .selectinload(ProductCategory.activity),
            selectinload(Product.media),
        )
        .where(Product.id == product_id)
    )
    return result.scalar_one_or_none()


async def list_products(
    session: AsyncSession,
    *,
    activity_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    series_id: uuid.UUID | None = None,
    status: ProductStatus | None = None,
    include_testing: bool = False,
    public_only: bool = False,
    limit: int = 20,
    offset: int = 0,
) -> list[Product]:
    q = select(Product).options(
        load_only(
            Product.id,
            Product.name,
            Product.description,
            Product.size_chart,
            Product.image_url,
            Product.price,
            Product.original_price,
            Product.stock_quantity,
            Product.is_unlimited,
            Product.max_quantity_per_user,
            Product.purchase_rules,
            Product.status,
            Product.version,
            Product.category_id,
            Product.series_id,
            Product.sort_order,
            Product.created_by,
            Product.sale_start,
            Product.sale_end,
            Product.created_at,
            Product.updated_at,
        ),
        selectinload(Product.variant_groups).selectinload(ProductVariantGroup.options),
        selectinload(Product.media),
        selectinload(Product.category).selectinload(ProductCategory.activity),
        selectinload(Product.series)
        .selectinload(ProductSeries.category)
        .selectinload(ProductCategory.activity),
    )
    if activity_id:
        q = q.where(
            or_(
                Product.category.has(ProductCategory.activity_id == activity_id),
                Product.series.has(
                    ProductSeries.category.has(ProductCategory.activity_id == activity_id)
                ),
            )
        )
    if category_id:
        q = q.where(Product.category_id == category_id, Product.series_id.is_(None))
    if series_id:
        q = q.where(Product.series_id == series_id)
    if status:
        q = q.where(Product.status == status)
    if not include_testing:
        q = q.where(Product.status != ProductStatus.TESTING)
    if public_only:
        q = q.where(public_product_condition())
    q = q.order_by(*product_catalog_ordering()).limit(limit).offset(offset)
    result = await session.execute(q)
    return list(result.scalars().unique().all())


async def create_product(
    session: AsyncSession, *, data: ProductCreate, created_by: uuid.UUID
) -> Product:
    series = await get_series(session, data.series_id) if data.series_id else None
    if data.series_id and series is None:
        raise ValueError("找不到所屬系列")
    category_id = data.category_id or (series.category_id if series else None)
    if category_id is None:
        raise ValueError("請選擇所屬活動")
    category = await get_category(session, category_id)
    if category is None:
        raise ValueError("找不到所屬活動")
    if series and series.category_id != category.id:
        raise ValueError("所選系列不屬於此活動")
    if series is None:
        sibling_filter = (Product.category_id == category.id) & Product.series_id.is_(None)
    else:
        sibling_filter = Product.series_id == series.id
    last_order = await session.scalar(select(func.max(Product.sort_order)).where(sibling_filter))

    product = Product(
        name=data.name,
        description=data.description,
        image_url=data.image_url,
        price=data.price,
        original_price=data.original_price,
        unit_cost=data.unit_cost,
        stock_quantity=data.stock_quantity,
        is_unlimited=data.is_unlimited,
        max_quantity_per_user=data.max_quantity_per_user,
        purchase_rules=data.purchase_rules.model_dump(exclude={"exclusive_product_ids"}),
        category_id=category.id,
        series_id=series.id if series else None,
        sort_order=_next_sort_order(last_order),
        created_by=created_by,
        sale_start=data.sale_start,
        sale_end=data.sale_end,
        status=ProductStatus.DRAFT,
        media=[
            ProductMedia(
                image_url=item.image_url,
                label=item.label,
                kind=item.kind,
                sort_order=item.sort_order or index,
            )
            for index, item in enumerate(data.media)
        ],
    )
    session.add(product)
    await session.flush()

    if data.purchase_rules.exclusive_product_ids:
        await sync_purchase_group(session, product, data.purchase_rules.exclusive_product_ids)

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
                    original_price_delta=option_data.original_price_delta,
                    sort_order=option_data.sort_order or oi,
                )
            )
    await session.flush()
    logger.info("商品建立 id=%s name=%s", product.id, product.name)
    return await get_product(session, product.id)  # type: ignore[return-value]


async def reorder_products(
    session: AsyncSession, data: ProductReorder, *, include_testing: bool = True
) -> list[Product]:
    if len(data.product_ids) != len(set(data.product_ids)):
        raise ValueError("商品清單有重複項目，請重新載入後再排序。")
    query = select(Product)
    if data.parent_type == "category":
        query = query.where(
            Product.category_id == data.parent_id,
            Product.series_id.is_(None),
        )
    else:
        query = query.where(Product.series_id == data.parent_id)
    products = list(
        await session.scalars(
            query.order_by(Product.sort_order, Product.created_at, Product.id).with_for_update()
        )
    )
    visible_products = [
        product
        for product in products
        if include_testing or product.status != ProductStatus.TESTING
    ]
    by_id = {product.id: product for product in visible_products}
    if set(data.product_ids) != set(by_id):
        raise ValueError("商品清單已變動，請重新載入後再排序。")
    ordered = [by_id[product_id] for product_id in data.product_ids]
    if include_testing:
        ordered_all = ordered
    else:
        ordered_visible = iter(ordered)
        ordered_all = [
            next(ordered_visible) if product.status != ProductStatus.TESTING else product
            for product in products
        ]
    for index, product in enumerate(ordered_all):
        product.sort_order = index
    await session.flush()
    return ordered


async def update_product(
    session: AsyncSession, product: Product, *, data: ProductUpdate
) -> Product:
    if product.status not in (
        ProductStatus.DRAFT,
        ProductStatus.TESTING,
        ProductStatus.ACTIVE,
        ProductStatus.SOLD_OUT,
        ProductStatus.CANCELLED,
    ):
        raise ValueError(f"商品狀態 {product.status} 不允許編輯")
    payload = data.model_dump(exclude_unset=True)
    if data.size_chart is not None:
        group = next(
            (group for group in product.variant_groups if group.id == data.size_chart.group_id),
            None,
        )
        if group is None:
            raise ValueError("尺寸表必須選擇本商品的規格類別")
        option_ids = {option.id for option in group.options}
        if any(row.option_id not in option_ids for row in data.size_chart.rows):
            raise ValueError("尺寸表包含不屬於所選規格的選項")
        payload["size_chart"] = data.size_chart.model_dump(mode="json")
    original_price = payload.get("original_price", product.original_price)
    if original_price is not None and original_price < payload.get("price", product.price):
        raise ValueError("原價不得低於售價")
    if "purchase_rules" in payload:
        payload["purchase_rules"] = (
            data.purchase_rules.model_dump(exclude={"exclusive_product_ids"})
            if data.purchase_rules is not None
            else {}
        )
    if "series_id" in payload or "category_id" in payload:
        previous_parent = (product.category_id, product.series_id)
        target_series_id = payload.get("series_id", product.series_id)
        target_series = await get_series(session, target_series_id) if target_series_id else None
        if target_series_id and target_series is None:
            raise ValueError("找不到目標系列")
        target_category_id = payload.get("category_id", product.category_id)
        if target_category_id is None and target_series is not None:
            target_category_id = target_series.category_id
        if target_category_id is None:
            raise ValueError("請選擇所屬活動")
        target_category = await get_category(session, target_category_id)
        if target_category is None:
            raise ValueError("找不到所屬活動")
        if target_series and target_series.category_id != target_category.id:
            raise ValueError("所選系列不屬於此活動")
        payload["category_id"] = target_category.id
        target_parent = (target_category.id, target_series.id if target_series else None)
        if target_parent != previous_parent:
            if target_series is None:
                sibling_filter = (
                    Product.category_id == target_category.id
                ) & Product.series_id.is_(None)
            else:
                sibling_filter = Product.series_id == target_series.id
            last_order = await session.scalar(
                select(func.max(Product.sort_order)).where(sibling_filter)
            )
            payload["sort_order"] = _next_sort_order(last_order)
    media_data = payload.pop("media", None)
    for field, value in payload.items():
        setattr(product, field, value)
    if media_data is not None:
        product.media = [ProductMedia(**item) for item in media_data]
    if data.purchase_rules and "exclusive_product_ids" in data.purchase_rules.model_fields_set:
        await sync_purchase_group(session, product, data.purchase_rules.exclusive_product_ids)
    await session.flush()
    return await get_product(session, product.id) or product


async def sync_purchase_group(
    session: AsyncSession, product: Product, product_ids: list[uuid.UUID]
) -> None:
    if not product_ids:
        if (product.purchase_rules or {}).get("designated_only"):
            raise ValueError("指定票種請勾選要一起限購的商品")
        product.purchase_rules = {**(product.purchase_rules or {}), "exclusive_group": None}
        return
    ids = set(product_ids) | {product.id}
    members = list(
        await session.scalars(
            select(Product).where(Product.id.in_(ids)).order_by(Product.id).with_for_update()
        )
    )
    if len(members) != len(ids):
        raise ValueError("部分限購商品已不存在，請重新讀取商品清單")
    if any(member.category_id != product.category_id for member in members):
        raise ValueError("同組限購只能選擇同一活動內的商品")
    group_id = str(uuid.uuid4())
    for member in members:
        member.purchase_rules = {**(member.purchase_rules or {}), "exclusive_group": group_id}


async def activate_product(session: AsyncSession, product: Product) -> Product:
    await session.refresh(
        product, attribute_names=["status", "stock_quantity", "version"], with_for_update=True
    )
    if product.status not in (ProductStatus.DRAFT, ProductStatus.TESTING, ProductStatus.CANCELLED):
        raise ValueError("只有草稿、測試中或已下架商品可以上架")
    if product.status == ProductStatus.TESTING:
        from api.services.shop._orders import clear_all_orders

        order_ids = list(
            await session.scalars(
                select(Order.id).where(Order.test_product_id == product.id).with_for_update()
            )
        )
        await clear_all_orders(session, order_ids=order_ids)
    product.status = ProductStatus.ACTIVE
    await session.flush()
    return product


async def deactivate_product(session: AsyncSession, product: Product) -> Product:
    if product.status not in (ProductStatus.ACTIVE, ProductStatus.SOLD_OUT):
        raise ValueError("只有上架中或售罄的商品可以下架")
    product.status = ProductStatus.CANCELLED
    await session.flush()
    return product


async def delete_product(session: AsyncSession, product: Product) -> None:
    targeted_promotion_id = await session.scalar(
        select(ShopPromotion.id)
        .where(ShopPromotion.target_products.any(Product.id == product.id))
        .limit(1)
    )
    if targeted_promotion_id is not None:
        raise ValueError("此商品仍套用於優惠，請先從優惠的指定品項中移除後再刪除")

    has_order_history = await session.scalar(
        select(OrderItem.id).where(OrderItem.product_id == product.id).limit(1)
    )
    if has_order_history is not None:
        raise ValueError("商品已有訂單紀錄，為保留購買歷史無法刪除")
    await session.delete(product)
    await session.flush()


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
                original_price_delta=option_data.original_price_delta,
                sort_order=option_data.sort_order or oi,
            )
        )
    await session.flush()
    return await get_variant_group(session, group.id)  # type: ignore[return-value]


async def update_variant_group(
    session: AsyncSession, group: ProductVariantGroup, *, data: ProductVariantGroupUpdate
) -> ProductVariantGroup:
    apply_updates(group, data)
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
        original_price_delta=data.original_price_delta,
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
    payload = data.model_dump(exclude_unset=True)
    original = payload.get("original_price_delta", option.original_price_delta)
    if original is not None and original < payload.get("price_delta", option.price_delta):
        raise ValueError("原始加價不得低於實際加價")
    apply_updates(option, data)
    await session.flush()
    return option


async def delete_variant_option(session: AsyncSession, option: ProductVariantOption) -> None:
    await session.delete(option)
    await session.flush()


async def build_catalog_tree(
    session: AsyncSession,
    *,
    activity_id: uuid.UUID | None = None,
    include_testing: bool = False,
    include_closed: bool = False,
    buyer: User | None = None,
) -> list[CatalogCategoryOut]:
    q = (
        select(ProductCategory)
        .options(
            selectinload(ProductCategory.activity),
            selectinload(ProductCategory.series)
            .selectinload(ProductSeries.products)
            .selectinload(Product.variant_groups),
            selectinload(ProductCategory.series)
            .selectinload(ProductSeries.products)
            .selectinload(Product.media),
            selectinload(ProductCategory.products).selectinload(Product.variant_groups),
            selectinload(ProductCategory.products).selectinload(Product.media),
        )
        .where(ProductCategory.is_active.is_(True))
        .order_by(ProductCategory.sort_order, ProductCategory.created_at, ProductCategory.id)
    )
    if activity_id:
        q = q.where(ProductCategory.activity_id == activity_id)
    categories = (await session.execute(q)).scalars().unique().all()
    catalog_products = [product for category in categories for product in category.products]
    catalog_products.extend(
        product
        for category in categories
        for series in category.series
        for product in series.products
    )
    catalog_product_ids = {product.id for product in catalog_products}
    products_with_option_surcharge = set(
        await session.scalars(
            select(ProductVariantGroup.product_id)
            .join(ProductVariantOption, ProductVariantOption.group_id == ProductVariantGroup.id)
            .where(
                ProductVariantGroup.product_id.in_(catalog_product_ids),
                ProductVariantOption.is_active.is_(True),
                ProductVariantOption.price_delta > 0,
            )
            .distinct()
        )
    )
    restrictions = await purchase_restrictions(
        session,
        catalog_products,
        buyer,
    )

    category_close_times: dict[uuid.UUID, datetime] = {}
    if categories:
        now = datetime.now(UTC)
        close_rows = await session.scalars(
            select(ShopOrderClose).where(
                ShopOrderClose.category_id.in_([category.id for category in categories]),
                ShopOrderClose.class_id.is_(None),
                ShopOrderClose.is_active.is_(True),
                or_(ShopOrderClose.closes_at.is_(None), ShopOrderClose.closes_at <= now),
            )
        )
        for close_row in close_rows:
            previous = category_close_times.get(close_row.category_id)
            if previous is None or close_row.created_at > previous:
                category_close_times[close_row.category_id] = close_row.created_at

    visible = {ProductStatus.ACTIVE, ProductStatus.SOLD_OUT}
    if include_testing:
        visible.add(ProductStatus.TESTING)
    tree: list[CatalogCategoryOut] = []
    now = datetime.now(UTC)
    for category in categories:
        activity_deadline = category.activity.order_closes_at if category.activity else None
        if activity_deadline is not None and activity_deadline.tzinfo is None:
            activity_deadline = activity_deadline.replace(tzinfo=UTC)
        activity_closed = bool(category.activity and category.activity.order_closed_at)
        deadline_passed = activity_deadline is not None and activity_deadline <= now
        category_closed = category.id in category_close_times
        if not include_closed and (activity_closed or deadline_passed or category_closed):
            continue
        category_products = [
            CatalogProductOut(
                id=product.id,
                name=product.name,
                image_url=_catalog_image_url(product),
                price=product.price,
                original_price=product.original_price,
                status=product.status,
                stock_quantity=product.stock_quantity,
                is_unlimited=product.is_unlimited,
                purchase_allowed=restrictions[product.id] is None,
                purchase_restriction=restrictions[product.id],
                purchase_group=(product.purchase_rules or {}).get("exclusive_group"),
                sale_start=product.sale_start,
                sale_end=product.sale_end,
                effective_sale_end=effective_product_deadline(
                    product.sale_end,
                    category.activity.order_closes_at if category.activity else None,
                ),
                has_variants=len(product.variant_groups) > 0,
                has_option_surcharge=product.id in products_with_option_surcharge,
            )
            for product in sorted(
                category.products,
                key=lambda item: (item.sort_order, item.created_at, item.id),
            )
            if product.series_id is None
            and product.status in visible
            and (buyer is not None or not has_purchase_qualifications(product))
        ]
        series_out: list[CatalogSeriesOut] = []
        for series in sorted(category.series, key=lambda s: (s.sort_order, s.created_at, s.id)):
            if not series.is_active:
                continue
            products = [
                CatalogProductOut(
                    id=p.id,
                    name=p.name,
                    image_url=_catalog_image_url(p),
                    price=p.price,
                    original_price=p.original_price,
                    status=p.status,
                    stock_quantity=p.stock_quantity,
                    is_unlimited=p.is_unlimited,
                    purchase_allowed=restrictions[p.id] is None,
                    purchase_restriction=restrictions[p.id],
                    purchase_group=(p.purchase_rules or {}).get("exclusive_group"),
                    sale_start=p.sale_start,
                    sale_end=p.sale_end,
                    effective_sale_end=effective_product_deadline(
                        p.sale_end, category.activity.order_closes_at if category.activity else None
                    ),
                    has_variants=len(p.variant_groups) > 0,
                    has_option_surcharge=p.id in products_with_option_surcharge,
                )
                for p in sorted(series.products, key=lambda x: (x.sort_order, x.created_at, x.id))
                if p.status in visible and (buyer is not None or not has_purchase_qualifications(p))
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
                activity_name=category.activity.name if category.activity else None,
                order_closes_at=category.activity.order_closes_at if category.activity else None,
                order_closed_at=(
                    category.activity.order_closed_at
                    if category.activity and category.activity.order_closed_at
                    else category_close_times.get(category.id)
                    or (activity_deadline if deadline_passed else None)
                ),
                activity_status=category.activity.status if category.activity else None,
                image_url=category.image_url,
                sort_order=category.sort_order,
                products=category_products,
                series=series_out,
            )
        )
    return tree
