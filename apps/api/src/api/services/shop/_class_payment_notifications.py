"""班聯確認整班收款後的班代郵件通知。"""

from __future__ import annotations

import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import local_today
from api.models.activity import Activity
from api.models.org import UserPosition
from api.models.school_class import ClassCadre, ClassRoleBinding, ClassRoleKey, SchoolClass
from api.models.shop import Order, OrderItem, OrderStatus
from api.models.user import User
from api.services.outbox import emit as outbox_emit
from api.services.school_class import class_display_label


async def queue_class_payment_confirmation(
    session: AsyncSession,
    *,
    class_id: uuid.UUID,
    activity_id: uuid.UUID | None,
    order_ids: list[uuid.UUID],
) -> None:
    """將整班有效訂單與班代收件地址寫入交易式 outbox。"""
    if not order_ids:
        return

    school_class = await session.get(SchoolClass, class_id)
    if school_class is None:
        return

    direct_cadre_emails = await session.scalars(
        select(User.email)
        .join(ClassCadre, ClassCadre.user_id == User.id)
        .where(
            ClassCadre.class_id == class_id,
            User.is_active.is_(True),
            User.email.is_not(None),
        )
    )
    today = local_today()
    role_cadre_emails = await session.scalars(
        select(User.email)
        .join(UserPosition, UserPosition.user_id == User.id)
        .join(ClassRoleBinding, ClassRoleBinding.position_id == UserPosition.position_id)
        .where(
            ClassRoleBinding.class_id == class_id,
            ClassRoleBinding.role_key == ClassRoleKey.CLASS_REPRESENTATIVE,
            UserPosition.start_date <= today,
            or_(UserPosition.end_date.is_(None), UserPosition.end_date >= today),
            User.is_active.is_(True),
            User.email.is_not(None),
        )
    )
    cadre_emails = sorted(
        {
            email.strip()
            for email in [*direct_cadre_emails, *role_cadre_emails]
            if email and email.strip()
        }
    )
    if not cadre_emails:
        return

    activity = await session.get(Activity, activity_id) if activity_id else None
    activity_filter = (
        Order.activity_id.is_(None) if activity_id is None else Order.activity_id == activity_id
    )
    orders = list(
        (
            await session.scalars(
                select(Order)
                .where(
                    Order.id.in_(order_ids),
                    Order.class_id == class_id,
                    activity_filter,
                    Order.status.notin_([OrderStatus.CANCELLED, OrderStatus.REFUNDED]),
                )
                .options(
                    selectinload(Order.user),
                    selectinload(Order.items).selectinload(OrderItem.product),
                )
                .order_by(Order.created_at, Order.id)
            )
        ).all()
    )
    if not orders:
        return

    order_details = [
        {
            "serial_number": order.serial_number,
            "student_name": order.user.display_name if order.user else "同學",
            "student_id": order.user.student_id if order.user else None,
            "total_price": order.total_price,
            "is_class_collected": order.is_class_collected,
            "items": [
                {
                    "product_name": item.product.name if item.product else "商品",
                    "quantity": item.quantity,
                    "unit_price": item.unit_price,
                    "subtotal": item.quantity * item.unit_price,
                    "selected_options": item.selected_options or [],
                }
                for item in order.items
            ],
        }
        for order in orders
    ]
    await outbox_emit(
        session,
        event_type="shop.class_payment_confirmed",
        payload={
            "cadre_emails": cadre_emails,
            "class_label": class_display_label(school_class) or school_class.class_code,
            "activity_name": activity.name if activity else "一般商品",
            "orders": order_details,
        },
    )
