"""未綁活動的商品，以實際收款訂單辨識班級收款涵蓋的主題。"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.shop import Order, OrderItem, OrderStatus, Product, ProductSeries
from api.models.shop_class_payment import ShopClassPayment


async def paid_general_category_ids(session: AsyncSession, class_id: uuid.UUID) -> set[uuid.UUID]:
    # 舊訂單可能沒有 category_id，須從直接商品或系列還原主題。
    category_id = func.coalesce(Order.category_id, Product.category_id, ProductSeries.category_id)
    rows = await session.scalars(
        select(category_id)
        .select_from(Order)
        .join(OrderItem, OrderItem.order_id == Order.id)
        .join(Product, Product.id == OrderItem.product_id)
        .outerjoin(ProductSeries, ProductSeries.id == Product.series_id)
        .where(
            Order.class_id == class_id,
            Order.activity_id.is_(None),
            Order.test_product_id.is_(None),
            Order.is_paid.is_(True),
            Order.status.notin_((OrderStatus.CANCELLED, OrderStatus.REFUNDED)),
            category_id.is_not(None),
        )
        .distinct()
    )
    return set(rows.all())


async def class_payment_for_scope(
    session: AsyncSession,
    class_id: uuid.UUID,
    activity_id: uuid.UUID | None,
    category_id: uuid.UUID | None,
) -> ShopClassPayment | None:
    payment = await session.scalar(
        select(ShopClassPayment).where(
            ShopClassPayment.class_id == class_id,
            ShopClassPayment.activity_id == activity_id,
            ShopClassPayment.is_paid.is_(True),
        )
    )
    if (
        payment is not None
        and activity_id is None
        and category_id is not None
        and category_id not in await paid_general_category_ids(session, class_id)
    ):
        return None
    return payment
