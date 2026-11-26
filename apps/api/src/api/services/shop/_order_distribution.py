import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from api.schemas.shop import OrderDistributionRow
from api.services import school_class as class_svc
from api.services.shop._order_queries import load_quantity_orders
from api.services.shop._ordering import product_catalog_positions


async def order_distribution(
    session: AsyncSession,
    *,
    activity_id: uuid.UUID | None = None,
    grade: int | None = None,
    class_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    product_id: uuid.UUID | None = None,
) -> list[OrderDistributionRow]:
    """回傳各班級的商品規格數量，供分貨核對使用。"""
    orders = await load_quantity_orders(
        session,
        activity_id=activity_id,
        grade=grade,
        class_id=class_id,
        category_id=category_id,
        product_id=product_id,
    )

    tally: dict[tuple[uuid.UUID | None, uuid.UUID, str], dict] = {}
    for order in orders:
        school_class = order.school_class
        class_label = (
            class_svc.class_display_label(school_class) or "未分班"
            if school_class is not None
            else "未分班"
        )
        for item in order.items:
            if product_id and item.product_id != product_id:
                continue
            product = item.product
            if product is None:
                continue
            if category_id and not (
                product.category_id == category_id
                or (product.series is not None and product.series.category_id == category_id)
            ):
                continue

            variant_key = (
                " / ".join(
                    f"{option['group_name']}:{option['value']}"
                    for option in sorted(
                        item.selected_options, key=lambda option: option.get("group_name", "")
                    )
                )
                if item.selected_options
                else "—"
            )
            key = (order.class_id, item.product_id, variant_key)
            if key not in tally:
                tally[key] = {
                    "product_id": item.product_id,
                    "product_name": product.name,
                    "series_name": product.series.name if product.series else "",
                    "class_id": order.class_id,
                    "class_label": class_label,
                    "grade": school_class.grade if school_class is not None else None,
                    "class_code": school_class.class_code if school_class is not None else "",
                    "variant_key": variant_key,
                    "qty_total": 0,
                }
            tally[key]["qty_total"] += item.quantity

    product_positions = await product_catalog_positions(
        session, {row["product_id"] for row in tally.values()}
    )
    rows = sorted(
        tally.values(),
        key=lambda row: (
            row["grade"] if row["grade"] is not None else 99,
            row["class_code"],
            product_positions.get(row["product_id"], len(product_positions)),
            row["variant_key"],
        ),
    )
    return [OrderDistributionRow(**row) for row in rows]
