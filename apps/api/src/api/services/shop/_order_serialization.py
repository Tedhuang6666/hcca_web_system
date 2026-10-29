"""訂單 API 回應資料的序列化。"""

from __future__ import annotations

from api.models.shop import (
    Order,
    OrderItem,
)
from api.schemas.shop import (
    OrderItemOut,
    OrderListItem,
    OrderOut,
    OrderPromotionOut,
)
from api.services import school_class as class_svc
from api.services.shop._orders import (
    _order_activity_id,
    _order_category,
    _product_order_scope,
)


def serialize_order_item(item: OrderItem) -> OrderItemOut:
    return OrderItemOut(
        id=item.id,
        product_id=item.product_id,
        product_name=item.product.name if item.product else None,
        quantity=item.quantity,
        unit_price=item.unit_price,
        subtotal=item.quantity * item.unit_price,
        selected_options=item.selected_options or [],
        ordered_by_id=item.ordered_by_id,
        ordered_by_name=item.ordered_by_name,
        delegation_link_id=item.delegation_link_id,
        delegation_name=item.delegation_name,
    )


def serialize_order(order: Order) -> OrderOut:
    activity = order.__dict__.get("activity")
    category = _order_category(order)
    return OrderOut(
        id=order.id,
        supplement_class_id=order.supplement_class_id,
        test_product_id=order.test_product_id,
        serial_number=order.serial_number,
        user_id=order.user_id,
        activity_id=_order_activity_id(order),
        activity_name=activity.name if activity else None,
        category_id=category.id if category else None,
        category_name=category.name
        if category
        else (
            "跨活動歷史訂單"
            if len({_product_order_scope(item.product) for item in order.items}) > 1
            else None
        ),
        status=order.status,
        subtotal_price=order.subtotal_price,
        discount_amount=order.discount_amount,
        total_price=order.total_price,
        promotion_id=order.promotion_id,
        promotion_code=order.promotion_code,
        applied_promotions=[
            OrderPromotionOut(
                promotion_id=row.promotion_id,
                name=row.promotion.name if row.promotion else "優惠",
                code=row.promotion.code if row.promotion else None,
                discount_amount=row.discount_amount,
            )
            for row in order.applied_promotions
        ],
        payment_method=order.payment_method,
        notes=order.notes,
        class_id=order.class_id,
        class_label=class_svc.class_display_label(order.school_class),
        assistance_scope=order.assistance_scope,
        assisted_by_id=order.assisted_by_id,
        is_paid=order.is_paid,
        is_class_collected=order.is_class_collected,
        class_collected_at=order.class_collected_at,
        paid_at=order.paid_at,
        created_at=order.created_at,
        updated_at=order.updated_at,
        items=[serialize_order_item(it) for it in order.items],
    )


def serialize_order_list_item(order: Order) -> OrderListItem:
    activity = order.__dict__.get("activity")
    category = _order_category(order)
    return OrderListItem(
        id=order.id,
        supplement_class_id=order.supplement_class_id,
        test_product_id=order.test_product_id,
        serial_number=order.serial_number,
        user_id=order.user_id,
        user_name=order.user.display_name if order.user else None,
        activity_id=_order_activity_id(order),
        activity_name=activity.name if activity else None,
        category_id=category.id if category else None,
        category_name=category.name
        if category
        else (
            "跨活動歷史訂單"
            if len({_product_order_scope(item.product) for item in order.items}) > 1
            else None
        ),
        status=order.status,
        subtotal_price=order.subtotal_price,
        discount_amount=order.discount_amount,
        total_price=order.total_price,
        promotion_code=order.promotion_code,
        payment_method=order.payment_method,
        class_id=order.class_id,
        class_label=class_svc.class_display_label(order.school_class),
        assistance_scope=order.assistance_scope,
        assisted_by_id=order.assisted_by_id,
        is_paid=order.is_paid,
        is_class_collected=order.is_class_collected,
        created_at=order.created_at,
        items=[serialize_order_item(item) for item in order.items],
    )
