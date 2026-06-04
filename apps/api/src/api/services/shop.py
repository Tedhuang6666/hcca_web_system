"""校商訂購系統服務層 - 分類 / 變體 / 商品 / 購物車 / 結單 / 統計 / 報表"""

from __future__ import annotations

import io
import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import now_local
from api.models.shop import (
    Cart,
    CartItem,
    Order,
    OrderItem,
    OrderStatus,
    Product,
    ProductCategory,
    ProductSeries,
    ProductStatus,
    ProductVariantGroup,
    ProductVariantOption,
)
from api.schemas.shop import (
    CartItemCreate,
    CartItemOut,
    CartOut,
    CatalogCategoryOut,
    CatalogProductOut,
    CatalogSeriesOut,
    ClassOrderUpsert,
    OrderItemCreate,
    OrderItemOut,
    OrderListItem,
    OrderOut,
    OrderSummaryOut,
    OrderSummaryRow,
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
from api.services import receivable as receivable_svc
from api.services import school_class as class_svc

logger = logging.getLogger(__name__)


# ── 序號生成 ──────────────────────────────────────────────────────────────────


async def generate_order_serial(session: AsyncSession) -> str:
    """使用 PostgreSQL Sequence 原子性生成訂單字號：ORD-YYYY-NNNNNN。"""
    result = await session.execute(text("SELECT nextval('order_serial_seq')"))
    seq_val: int = result.scalar_one()
    year = now_local().year
    return f"ORD-{year}-{seq_val:06d}"


# ── 主題（ProductCategory）──────────────────────────────────────────────────


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


# ── 系列（ProductSeries）─────────────────────────────────────────────────────


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


# ── 商品 CRUD ─────────────────────────────────────────────────────────────────


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


# ── 變體群組 / 選項 ───────────────────────────────────────────────────────────


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


# ── 購買頁瀏覽樹 ──────────────────────────────────────────────────────────────


async def build_catalog_tree(
    session: AsyncSession,
    *,
    org_id: uuid.UUID | None = None,
    activity_id: uuid.UUID | None = None,
) -> list[CatalogCategoryOut]:
    """組合 主題 → 系列 → 商品 的瀏覽樹（僅含上架中 / 售罄商品）。"""
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


# ── 變體解析 ──────────────────────────────────────────────────────────────────


def _resolve_selected_options(product: Product, option_ids: list[uuid.UUID]) -> list[dict]:
    """依 option_ids 建立變體快照，並驗證每個變體群組各選恰好一個有效選項。"""
    id_set = set(option_ids)
    valid_ids = {o.id for g in product.variant_groups for o in g.options}
    for oid in option_ids:
        if oid not in valid_ids:
            raise ValueError("包含此商品不存在的變體選項")

    snapshot: list[dict] = []
    for group in sorted(product.variant_groups, key=lambda g: g.sort_order):
        picked = [o for o in group.options if o.is_active and o.id in id_set]
        if len(picked) != 1:
            raise ValueError(f"變體「{group.name}」需選擇一個選項")
        option = picked[0]
        snapshot.append(
            {
                "group_id": str(group.id),
                "group_name": group.name,
                "option_id": str(option.id),
                "value": option.value,
                "price_delta": option.price_delta,
            }
        )
    return snapshot


def _options_signature(selected_options: list[dict]) -> str:
    """變體組合指紋（用於合併購物車中相同商品＋相同變體的品項）。"""
    return ",".join(sorted(str(o.get("option_id")) for o in selected_options))


def _options_delta(selected_options: list[dict]) -> int:
    return sum(int(o.get("price_delta", 0) or 0) for o in selected_options)


# ── 購物車 ────────────────────────────────────────────────────────────────────


async def get_or_create_cart(session: AsyncSession, user_id: uuid.UUID) -> Cart:
    result = await session.execute(
        select(Cart)
        .options(selectinload(Cart.items).selectinload(CartItem.product))
        .where(Cart.user_id == user_id)
    )
    cart = result.scalar_one_or_none()
    if cart is None:
        cart = Cart(user_id=user_id)
        session.add(cart)
        await session.flush()
        await session.refresh(cart, attribute_names=["items"])
    return cart


async def add_cart_item(session: AsyncSession, user_id: uuid.UUID, *, data: CartItemCreate) -> Cart:
    cart = await get_or_create_cart(session, user_id)
    product = await get_product(session, data.product_id)
    if product is None:
        raise ValueError("找不到此商品")
    if product.status != ProductStatus.ACTIVE:
        raise ValueError(f"商品「{product.name}」不在上架狀態")

    selected = _resolve_selected_options(product, data.option_ids)
    signature = _options_signature(selected)

    for item in cart.items:
        if (
            item.product_id == product.id
            and _options_signature(item.selected_options or []) == signature
        ):
            item.quantity = min(item.quantity + data.quantity, 100)
            await session.flush()
            return cart

    cart.items.append(CartItem(product=product, quantity=data.quantity, selected_options=selected))
    await session.flush()
    return cart


async def update_cart_item(
    session: AsyncSession, user_id: uuid.UUID, item_id: uuid.UUID, *, quantity: int
) -> Cart:
    cart = await get_or_create_cart(session, user_id)
    target = next((i for i in cart.items if i.id == item_id), None)
    if target is None:
        raise ValueError("找不到購物車品項")
    target.quantity = quantity
    await session.flush()
    return cart


async def remove_cart_item(session: AsyncSession, user_id: uuid.UUID, item_id: uuid.UUID) -> Cart:
    cart = await get_or_create_cart(session, user_id)
    target = next((i for i in cart.items if i.id == item_id), None)
    if target is not None:
        cart.items.remove(target)
        await session.flush()
    return cart


async def clear_cart(session: AsyncSession, user_id: uuid.UUID) -> Cart:
    cart = await get_or_create_cart(session, user_id)
    cart.items.clear()
    await session.flush()
    return await get_or_create_cart(session, user_id)


def _cart_item_availability(product: Product, quantity: int) -> tuple[bool, str | None]:
    now = datetime.now(UTC)
    if product.status != ProductStatus.ACTIVE:
        return False, "商品已下架"
    if product.sale_start and now < product.sale_start:
        return False, "尚未開售"
    if product.sale_end and now > product.sale_end:
        return False, "已截止販售"
    if not product.is_unlimited and product.stock_quantity < quantity:
        return False, f"庫存不足（剩餘 {product.stock_quantity} 件）"
    return True, None


def serialize_cart(cart: Cart) -> CartOut:
    items_out: list[CartItemOut] = []
    total = 0
    for item in cart.items:
        product = item.product
        unit_price = product.price + _options_delta(item.selected_options or [])
        subtotal = unit_price * item.quantity
        available, reason = _cart_item_availability(product, item.quantity)
        if available:
            total += subtotal
        items_out.append(
            CartItemOut(
                id=item.id,
                product_id=product.id,
                product_name=product.name,
                product_image_url=product.image_url,
                quantity=item.quantity,
                unit_price=unit_price,
                subtotal=subtotal,
                selected_options=item.selected_options or [],
                available=available,
                unavailable_reason=reason,
            )
        )
    return CartOut(id=cart.id, items=items_out, total_price=total)


async def _assert_activity_open(session: AsyncSession, product: Product) -> None:
    """票種掛活動時，活動結束/封存即停售（活動系統整合）。"""
    from api.models.activity import Activity, ActivityStatus

    series = getattr(product, "series", None)
    category = getattr(series, "category", None) if series else None
    activity_id = getattr(category, "activity_id", None) if category else None
    if not activity_id:
        return
    activity = await session.get(Activity, activity_id)
    if activity is not None and activity.status in (
        ActivityStatus.ENDED,
        ActivityStatus.ARCHIVED,
    ):
        raise ValueError(f"商品「{product.name}」所屬活動已結束，停止販售")


def _order_activity_id(order: Order) -> uuid.UUID | None:
    for item in getattr(order, "items", []) or []:
        product = getattr(item, "product", None)
        series = getattr(product, "series", None) if product else None
        category = getattr(series, "category", None) if series else None
        if category and category.activity_id:
            return category.activity_id
    return None


# ── 結單（購物車 → 訂單）──────────────────────────────────────────────────────


async def _create_order_from_items(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    org_id: uuid.UUID,
    class_id: uuid.UUID | None,
    cart_items: list[CartItem],
    notes: str | None,
    assistance_scope: str = "self",
    assisted_by_id: uuid.UUID | None = None,
) -> Order:
    total_price = 0
    specs: list[dict] = []
    now = datetime.now(UTC)

    # 鎖住所有涉及商品列（依 id 排序避免並發死鎖），序列化庫存檢查與扣減，避免超賣。
    # 否則兩張並發訂單可能同時通過 stock_quantity 檢查，導致庫存變負 / 超售。
    locked_product_ids = sorted({ci.product_id for ci in cart_items})
    if locked_product_ids:
        await session.execute(
            select(Product.id)
            .where(Product.id.in_(locked_product_ids))
            .order_by(Product.id)
            .with_for_update()
        )

    for cart_item in cart_items:
        product = await get_product(session, cart_item.product_id)
        if product is None:
            raise ValueError("購物車含已不存在的商品")
        if product.status != ProductStatus.ACTIVE:
            raise ValueError(f"商品「{product.name}」不在上架狀態")
        if product.sale_start and now < product.sale_start:
            raise ValueError(f"商品「{product.name}」尚未開售")
        if product.sale_end and now > product.sale_end:
            raise ValueError(f"商品「{product.name}」已截止販售")
        await _assert_activity_open(session, product)

        option_ids = [uuid.UUID(str(o["option_id"])) for o in (cart_item.selected_options or [])]
        selected = _resolve_selected_options(product, option_ids)
        unit_price = product.price + _options_delta(selected)

        if not product.is_unlimited:
            if product.stock_quantity < cart_item.quantity:
                raise ValueError(
                    f"商品「{product.name}」庫存不足（剩餘 {product.stock_quantity} 件）"
                )
            product.stock_quantity -= cart_item.quantity
            if product.stock_quantity == 0:
                product.status = ProductStatus.SOLD_OUT

        total_price += unit_price * cart_item.quantity
        specs.append(
            {
                "product_id": product.id,
                "quantity": cart_item.quantity,
                "unit_price": unit_price,
                "selected_options": selected,
            }
        )

    serial = await generate_order_serial(session)
    order = Order(
        serial_number=serial,
        user_id=user_id,
        org_id=org_id,
        class_id=class_id,
        assistance_scope=assistance_scope,
        assisted_by_id=assisted_by_id,
        status=OrderStatus.PENDING,
        total_price=total_price,
        notes=notes,
    )
    session.add(order)
    await session.flush()
    for spec in specs:
        session.add(OrderItem(order_id=order.id, **spec))
    await session.flush()
    logger.info("訂單建立 serial=%s total=%d", serial, total_price)
    return order


async def _order_items_to_cart_items(
    session: AsyncSession, items: list[OrderItemCreate]
) -> list[CartItem]:
    cart_items: list[CartItem] = []
    for item in items:
        product = await get_product(session, item.product_id)
        if product is None:
            raise ValueError("找不到此商品")
        selected = _resolve_selected_options(product, item.option_ids)
        cart_items.append(
            CartItem(
                product_id=item.product_id,
                quantity=item.quantity,
                selected_options=selected,
            )
        )
    return cart_items


async def create_direct_order(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    class_id: uuid.UUID | None,
    data: ClassOrderUpsert,
    assistance_scope: str = "class_assisted",
    assisted_by_id: uuid.UUID | None = None,
) -> list[Order]:
    cart_items = await _order_items_to_cart_items(session, data.items)
    by_org: dict[uuid.UUID, list[CartItem]] = {}
    for item in cart_items:
        product = await get_product(session, item.product_id)
        if product is None:
            raise ValueError("找不到此商品")
        by_org.setdefault(product.org_id, []).append(item)

    orders: list[Order] = []
    for org_id, grouped_items in by_org.items():
        order = await _create_order_from_items(
            session,
            user_id=user_id,
            org_id=org_id,
            class_id=class_id,
            cart_items=grouped_items,
            notes=data.notes,
            assistance_scope=assistance_scope,
            assisted_by_id=assisted_by_id,
        )
        await receivable_svc.sync_shop_order(session, order)
        orders.append(order)
    return orders


async def checkout(session: AsyncSession, user, *, notes: str | None = None) -> list[Order]:
    """
    將購物車結算為訂單。

    - 依商品所屬組織拆成多張訂單。
    - 以使用者目前班級（學號區間推導）快照 class_id。
    - 沿用樂觀鎖（version_id_col）扣減庫存，並檢查截止時間。
    """
    cart = await get_or_create_cart(session, user.id)
    if not cart.items:
        raise ValueError("購物車是空的")

    school_class = await class_svc.resolve_user_class(session, user)
    class_id = school_class.id if school_class else None

    by_org: dict[uuid.UUID, list[CartItem]] = {}
    for item in cart.items:
        by_org.setdefault(item.product.org_id, []).append(item)

    orders: list[Order] = []
    for org_id, items in by_org.items():
        order = await _create_order_from_items(
            session,
            user_id=user.id,
            org_id=org_id,
            class_id=class_id,
            cart_items=items,
            notes=notes,
        )
        await receivable_svc.sync_shop_order(session, order)
        orders.append(order)

    cart.items.clear()
    await session.flush()
    return orders


# ── 訂單查詢 / 序列化 ─────────────────────────────────────────────────────────


async def get_order(session: AsyncSession, order_id: uuid.UUID) -> Order | None:
    result = await session.execute(
        select(Order)
        .options(
            selectinload(Order.items)
            .selectinload(OrderItem.product)
            .selectinload(Product.series)
            .selectinload(ProductSeries.category),
            selectinload(Order.school_class),
            selectinload(Order.user),
        )
        .where(Order.id == order_id)
    )
    return result.scalar_one_or_none()


async def list_orders(
    session: AsyncSession,
    *,
    user_id: uuid.UUID | None = None,
    org_id: uuid.UUID | None = None,
    activity_id: uuid.UUID | None = None,
    class_ids: list[uuid.UUID] | None = None,
    assistance_scope: str | None = None,
    status: OrderStatus | None = None,
    is_paid: bool | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[Order]:
    q = (
        select(Order)
        .options(
            selectinload(Order.school_class),
            selectinload(Order.user),
            selectinload(Order.items)
            .selectinload(OrderItem.product)
            .selectinload(Product.series)
            .selectinload(ProductSeries.category),
        )
        .order_by(Order.created_at.desc())
    )
    if user_id:
        q = q.where(Order.user_id == user_id)
    if org_id:
        q = q.where(Order.org_id == org_id)
    if activity_id:
        q = q.where(
            Order.items.any(
                OrderItem.product.has(
                    Product.series.has(
                        ProductSeries.category.has(ProductCategory.activity_id == activity_id)
                    )
                )
            )
        )
    if class_ids is not None:
        if not class_ids:
            return []
        q = q.where(Order.class_id.in_(class_ids))
    if assistance_scope:
        q = q.where(Order.assistance_scope == assistance_scope)
    if status:
        q = q.where(Order.status == status)
    if is_paid is not None:
        q = q.where(Order.is_paid.is_(is_paid))
    q = q.limit(limit).offset(offset)
    result = await session.execute(q)
    return list(result.scalars().unique().all())


def serialize_order_item(item: OrderItem) -> OrderItemOut:
    return OrderItemOut(
        id=item.id,
        product_id=item.product_id,
        product_name=item.product.name if item.product else None,
        quantity=item.quantity,
        unit_price=item.unit_price,
        subtotal=item.quantity * item.unit_price,
        selected_options=item.selected_options or [],
    )


def serialize_order(order: Order) -> OrderOut:
    return OrderOut(
        id=order.id,
        serial_number=order.serial_number,
        user_id=order.user_id,
        org_id=order.org_id,
        activity_id=_order_activity_id(order),
        status=order.status,
        total_price=order.total_price,
        notes=order.notes,
        class_id=order.class_id,
        class_label=class_svc.class_display_label(order.school_class),
        assistance_scope=order.assistance_scope,
        assisted_by_id=order.assisted_by_id,
        is_paid=order.is_paid,
        paid_at=order.paid_at,
        created_at=order.created_at,
        updated_at=order.updated_at,
        items=[serialize_order_item(it) for it in order.items],
    )


def serialize_order_list_item(order: Order) -> OrderListItem:
    return OrderListItem(
        id=order.id,
        serial_number=order.serial_number,
        user_id=order.user_id,
        user_name=order.user.display_name if order.user else None,
        org_id=order.org_id,
        activity_id=_order_activity_id(order),
        status=order.status,
        total_price=order.total_price,
        class_id=order.class_id,
        class_label=class_svc.class_display_label(order.school_class),
        assistance_scope=order.assistance_scope,
        assisted_by_id=order.assisted_by_id,
        is_paid=order.is_paid,
        created_at=order.created_at,
    )


async def cancel_order(
    session: AsyncSession,
    order: Order,
    *,
    requested_by: uuid.UUID,
    reason: str | None = None,
) -> Order:
    """取消訂單並歸還庫存"""
    if order.user_id != requested_by:
        raise PermissionError("只有訂購人可取消訂單")
    if order.status not in (OrderStatus.PENDING, OrderStatus.CONFIRMED):
        raise ValueError(f"訂單狀態 {order.status} 無法取消")

    for item in order.items:
        product = await session.get(Product, item.product_id)
        if product and not product.is_unlimited:
            product.stock_quantity += item.quantity
            if product.status == ProductStatus.SOLD_OUT:
                product.status = ProductStatus.ACTIVE

    order.status = OrderStatus.CANCELLED
    if reason:
        order.notes = f"[取消原因] {reason}" + (f"\n{order.notes}" if order.notes else "")
    await receivable_svc.cancel_for_source(session, "shop_order", order.id)
    await session.flush()
    logger.info("訂單取消 serial=%s by=%s", order.serial_number, requested_by)
    return order


async def replace_order_items(
    session: AsyncSession,
    order: Order,
    *,
    data: ClassOrderUpsert,
) -> Order:
    if order.status not in (OrderStatus.PENDING, OrderStatus.CONFIRMED):
        raise ValueError(f"訂單狀態 {order.status} 無法修改")
    for requested_item in data.items:
        product = await get_product(session, requested_item.product_id)
        if product is None:
            raise ValueError("找不到此商品")
        if product.org_id != order.org_id:
            raise ValueError("修改訂單不可跨商品組織，請另外建立新訂單")

    for item in list(order.items):
        product = await session.get(Product, item.product_id)
        if product and not product.is_unlimited:
            product.stock_quantity += item.quantity
            if product.status == ProductStatus.SOLD_OUT:
                product.status = ProductStatus.ACTIVE
        await session.delete(item)
    await session.flush()

    temp_items = await _order_items_to_cart_items(session, data.items)
    specs_order = await _create_order_from_items(
        session,
        user_id=order.user_id,
        org_id=order.org_id,
        class_id=order.class_id,
        cart_items=temp_items,
        notes=data.notes,
        assistance_scope=order.assistance_scope,
        assisted_by_id=order.assisted_by_id,
    )
    order.total_price = specs_order.total_price
    order.notes = data.notes
    temp_result = await session.execute(
        select(OrderItem).where(OrderItem.order_id == specs_order.id)
    )
    for item in temp_result.scalars().all():
        item.order_id = order.id
    await session.delete(specs_order)
    await receivable_svc.sync_shop_order(session, order)
    await session.flush()
    return order


async def set_order_paid(
    session: AsyncSession, order: Order, *, is_paid: bool, actor_id: uuid.UUID
) -> Order:
    """標示訂單是否已繳費（幹部結單收費用，可設為已繳或取消已繳）。"""
    order.is_paid = is_paid
    if is_paid:
        order.paid_at = datetime.now(UTC)
        order.paid_by_id = actor_id
    else:
        order.paid_at = None
        order.paid_by_id = None
    await receivable_svc.sync_shop_order(session, order)
    await session.flush()
    logger.info("訂單繳費狀態 serial=%s is_paid=%s by=%s", order.serial_number, is_paid, actor_id)
    return order


# ── 後台統計 ──────────────────────────────────────────────────────────────────


async def order_summary(
    session: AsyncSession,
    *,
    group_by: str,
    org_id: uuid.UUID | None = None,
    product_id: uuid.UUID | None = None,
    grade: int | None = None,
    class_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    status: OrderStatus | None = None,
    is_paid: bool | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> OrderSummaryOut:
    """依班級 / 年級 / 個人彙整訂購情形與金額（排除已取消訂單）。"""
    if group_by not in ("class", "grade", "user"):
        raise ValueError("group_by 必須為 class / grade / user")

    q = select(Order).options(
        selectinload(Order.items),
        selectinload(Order.school_class),
        selectinload(Order.user),
    )
    if status is not None:
        q = q.where(Order.status == status)
    else:
        q = q.where(Order.status != OrderStatus.CANCELLED)
    if org_id:
        q = q.where(Order.org_id == org_id)
    if product_id:
        q = q.where(Order.items.any(OrderItem.product_id == product_id))
    if grade is not None:
        q = q.where(Order.school_class.has(grade=grade))
    if class_id:
        q = q.where(Order.class_id == class_id)
    if user_id:
        q = q.where(Order.user_id == user_id)
    if is_paid is not None:
        q = q.where(Order.is_paid.is_(is_paid))
    if date_from:
        q = q.where(Order.created_at >= date_from)
    if date_to:
        q = q.where(Order.created_at <= date_to)
    orders = (await session.execute(q)).scalars().unique().all()

    groups: dict[str, OrderSummaryRow] = {}
    for order in orders:
        if group_by == "class":
            key = str(order.class_id) if order.class_id else "none"
            label = class_svc.class_display_label(order.school_class) or "未分班"
        elif group_by == "grade":
            sc = order.school_class
            key = str(sc.grade) if sc else "none"
            label = f"{sc.grade} 年級" if sc else "未分班"
        else:
            key = str(order.user_id)
            label = order.user.display_name if order.user else key

        row = groups.get(key)
        if row is None:
            row = OrderSummaryRow(
                key=key,
                label=label,
                order_count=0,
                item_count=0,
                total_amount=0,
                paid_amount=0,
                unpaid_amount=0,
            )
            groups[key] = row
        matched_items = [
            item for item in order.items if product_id is None or item.product_id == product_id
        ]
        if not matched_items:
            if product_id is None:
                amount = order.total_price
                item_count = 0
            else:
                continue
        else:
            amount = sum(item.quantity * item.unit_price for item in matched_items)
            item_count = sum(it.quantity for it in matched_items)
        row.order_count += 1
        row.item_count += item_count
        row.total_amount += amount
        if order.is_paid:
            row.paid_amount += amount
        else:
            row.unpaid_amount += amount

    rows = sorted(groups.values(), key=lambda r: r.label)
    return OrderSummaryOut(
        group_by=group_by,
        rows=rows,
        total_amount=sum(r.total_amount for r in rows),
        paid_amount=sum(r.paid_amount for r in rows),
        unpaid_amount=sum(r.unpaid_amount for r in rows),
    )


# ── 報表匯出 [M-26] ───────────────────────────────────────────────────────────


async def _fetch_order_report_rows(
    session: AsyncSession,
    org_id: uuid.UUID | None = None,
    activity_id: uuid.UUID | None = None,
) -> list[dict]:
    """聚合訂單明細資料，供 Pandas 處理"""
    q = (
        select(
            Order.serial_number.label("訂單字號"),
            Order.status.label("訂單狀態"),
            Order.total_price.label("訂單總金額"),
            Order.is_paid.label("是否已繳費"),
            Order.created_at.label("建立時間"),
            OrderItem.quantity.label("數量"),
            OrderItem.unit_price.label("單價"),
            Product.name.label("商品名稱"),
        )
        .join(OrderItem, Order.id == OrderItem.order_id)
        .join(Product, OrderItem.product_id == Product.id)
        .order_by(Order.created_at.desc())
    )
    if org_id:
        q = q.where(Order.org_id == org_id)
    if activity_id:
        q = q.where(
            Product.series.has(
                ProductSeries.category.has(ProductCategory.activity_id == activity_id)
            )
        )

    result = await session.execute(q)
    rows = result.mappings().all()
    return [
        {
            "訂單字號": r["訂單字號"],
            "訂單狀態": r["訂單狀態"].value if hasattr(r["訂單狀態"], "value") else r["訂單狀態"],
            "是否已繳費": "是" if r["是否已繳費"] else "否",
            "商品名稱": r["商品名稱"],
            "數量": r["數量"],
            "單價（NT$）": r["單價"],
            "小計（NT$）": r["數量"] * r["單價"],
            "訂單總金額（NT$）": r["訂單總金額"],
            "建立時間": r["建立時間"].strftime("%Y-%m-%d %H:%M:%S") if r["建立時間"] else "",
        }
        for r in rows
    ]


async def export_orders_excel(
    session: AsyncSession,
    org_id: uuid.UUID | None = None,
    activity_id: uuid.UUID | None = None,
) -> bytes:
    """匯出訂單報表為 Excel（.xlsx）。"""
    import pandas as pd

    rows = await _fetch_order_report_rows(session, org_id=org_id, activity_id=activity_id)
    columns = [
        "訂單字號",
        "訂單狀態",
        "是否已繳費",
        "商品名稱",
        "數量",
        "單價（NT$）",
        "小計（NT$）",
        "訂單總金額（NT$）",
        "建立時間",
    ]
    df = pd.DataFrame(rows) if rows else pd.DataFrame(columns=columns)

    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="訂單報表")
        ws = writer.sheets["訂單報表"]
        for col in ws.columns:
            max_len = max((len(str(cell.value or "")) for cell in col), default=10)
            ws.column_dimensions[col[0].column_letter].width = min(max_len + 4, 50)

    return buf.getvalue()


async def export_orders_csv(
    session: AsyncSession,
    org_id: uuid.UUID | None = None,
    activity_id: uuid.UUID | None = None,
) -> str:
    """匯出訂單報表為 CSV（UTF-8 with BOM，Excel 可直接開啟）"""
    import pandas as pd

    rows = await _fetch_order_report_rows(session, org_id=org_id, activity_id=activity_id)
    df = pd.DataFrame(rows) if rows else pd.DataFrame()
    return df.to_csv(index=False, encoding="utf-8-sig")
