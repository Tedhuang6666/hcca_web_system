"""共用應收款服務。"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.meal import MealOrder, MealOrderStatus
from api.models.receivable import Receivable, ReceivableSource, ReceivableStatus
from api.models.shop import Order, OrderStatus
from api.schemas.receivable import ReceivableCreate, ReceivableUpdate


def _status_for_amounts(amount: int, paid: int, refunded: int) -> ReceivableStatus:
    amount = int(amount or 0)
    paid = int(paid or 0)
    refunded = int(refunded or 0)
    if refunded >= amount and amount > 0:
        return ReceivableStatus.REFUNDED
    if paid <= 0:
        return ReceivableStatus.UNPAID
    if paid < amount:
        return ReceivableStatus.PARTIAL
    return ReceivableStatus.PAID


async def list_receivables(
    db: AsyncSession,
    *,
    activity_id: uuid.UUID | None = None,
    class_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    status: str | None = None,
    limit: int = 200,
) -> list[Receivable]:
    stmt = select(Receivable).order_by(Receivable.updated_at.desc()).limit(limit)
    if activity_id:
        stmt = stmt.where(Receivable.activity_id == activity_id)
    if class_id:
        stmt = stmt.where(Receivable.class_id == class_id)
    if user_id:
        stmt = stmt.where(Receivable.user_id == user_id)
    if status:
        stmt = stmt.where(Receivable.status == status)
    return list((await db.execute(stmt)).scalars().all())


async def summary(
    db: AsyncSession,
    *,
    activity_id: uuid.UUID | None = None,
    class_id: uuid.UUID | None = None,
) -> dict:
    stmt = select(
        func.count(Receivable.id),
        func.coalesce(func.sum(Receivable.amount), 0),
        func.coalesce(func.sum(Receivable.paid_amount), 0),
        func.coalesce(func.sum(Receivable.refunded_amount), 0),
    )
    status_stmt = select(Receivable.status, func.count(Receivable.id)).group_by(Receivable.status)
    if activity_id:
        stmt = stmt.where(Receivable.activity_id == activity_id)
        status_stmt = status_stmt.where(Receivable.activity_id == activity_id)
    if class_id:
        stmt = stmt.where(Receivable.class_id == class_id)
        status_stmt = status_stmt.where(Receivable.class_id == class_id)
    total_count, total_amount, paid_amount, refunded_amount = (await db.execute(stmt)).one()
    by_status = {str(row.status): int(row.count) for row in (await db.execute(status_stmt)).all()}
    return {
        "total_count": int(total_count or 0),
        "total_amount": int(total_amount or 0),
        "paid_amount": int(paid_amount or 0),
        "unpaid_amount": max(int(total_amount or 0) - int(paid_amount or 0), 0),
        "refunded_amount": int(refunded_amount or 0),
        "by_status": by_status,
    }


async def create_receivable(db: AsyncSession, data: ReceivableCreate) -> Receivable:
    item = Receivable(**data.model_dump())
    db.add(item)
    await db.flush()
    await db.refresh(item)
    return item


async def get_receivable(db: AsyncSession, receivable_id: uuid.UUID) -> Receivable | None:
    return await db.get(Receivable, receivable_id)


async def update_receivable(
    db: AsyncSession, item: Receivable, data: ReceivableUpdate
) -> Receivable:
    fields = data.model_dump(exclude_unset=True)
    for key, value in fields.items():
        setattr(item, key, value)
    if any(key in fields for key in ("amount", "paid_amount", "refunded_amount")):
        item.status = _status_for_amounts(item.amount, item.paid_amount, item.refunded_amount).value
    await db.flush()
    await db.refresh(item)
    return item


async def mark_paid(
    db: AsyncSession,
    item: Receivable,
    *,
    actor_id: uuid.UUID,
    paid_amount: int | None = None,
    note: str | None = None,
) -> Receivable:
    item.paid_amount = paid_amount if paid_amount is not None else item.amount
    item.status = _status_for_amounts(item.amount, item.paid_amount, item.refunded_amount).value
    item.collected_by_id = actor_id
    item.paid_at = datetime.now(UTC)
    if note:
        item.note = note
    await _sync_source_payment(db, item, is_paid=item.status == ReceivableStatus.PAID.value)
    await db.flush()
    await db.refresh(item)
    return item


async def refund(
    db: AsyncSession,
    item: Receivable,
    *,
    actor_id: uuid.UUID,
    refunded_amount: int | None = None,
    note: str | None = None,
) -> Receivable:
    item.refunded_amount = refunded_amount if refunded_amount is not None else item.paid_amount
    item.status = (
        ReceivableStatus.REFUNDED.value
        if item.refunded_amount >= item.amount
        else ReceivableStatus.REFUNDING.value
    )
    item.collected_by_id = actor_id
    item.refunded_at = datetime.now(UTC)
    if note:
        item.note = note
    await _sync_source_payment(db, item, is_paid=False)
    await db.flush()
    await db.refresh(item)
    return item


async def cancel_for_source(db: AsyncSession, source_type: str, source_id: uuid.UUID) -> None:
    item = await db.scalar(
        select(Receivable).where(
            Receivable.source_type == source_type, Receivable.source_id == source_id
        )
    )
    if item:
        item.status = ReceivableStatus.CANCELED.value
        await db.flush()


async def sync_shop_order(db: AsyncSession, order: Order) -> Receivable:
    item = await db.scalar(
        select(Receivable).where(
            Receivable.source_type == ReceivableSource.SHOP_ORDER.value,
            Receivable.source_id == order.id,
        )
    )
    if item is None:
        item = Receivable(
            source_type=ReceivableSource.SHOP_ORDER.value,
            source_id=order.id,
            title=f"商品訂單 {order.serial_number}",
        )
        db.add(item)
    item.user_id = order.user_id
    item.class_id = order.class_id
    item.amount = order.total_price
    item.paid_amount = order.total_price if order.is_paid else 0
    item.paid_at = order.paid_at
    item.collected_by_id = order.paid_by_id
    item.status = (
        ReceivableStatus.CANCELED.value
        if order.status == OrderStatus.CANCELLED
        else _status_for_amounts(item.amount, item.paid_amount, item.refunded_amount).value
    )
    await db.flush()
    return item


async def sync_meal_order(db: AsyncSession, order: MealOrder) -> Receivable:
    item = await db.scalar(
        select(Receivable).where(
            Receivable.source_type == ReceivableSource.MEAL_ORDER.value,
            Receivable.source_id == order.id,
        )
    )
    if item is None:
        item = Receivable(
            source_type=ReceivableSource.MEAL_ORDER.value,
            source_id=order.id,
            title=f"學餐訂單 {order.serial_number}",
        )
        db.add(item)
    item.user_id = order.user_id
    item.class_id = order.class_id
    item.amount = order.total_price
    item.paid_amount = order.total_price if order.is_paid else 0
    item.paid_at = order.paid_at
    item.collected_by_id = order.paid_by_id
    item.status = (
        ReceivableStatus.CANCELED.value
        if order.status == MealOrderStatus.CANCELLED
        else _status_for_amounts(item.amount, item.paid_amount, item.refunded_amount).value
    )
    await db.flush()
    return item


async def export_csv(db: AsyncSession, rows: list[Receivable]) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        ["id", "title", "source_type", "amount", "paid_amount", "status", "user_id", "class_id"]
    )
    for row in rows:
        writer.writerow(
            [
                row.id,
                row.title,
                row.source_type,
                row.amount,
                row.paid_amount,
                row.status,
                row.user_id or "",
                row.class_id or "",
            ]
        )
    return output.getvalue()


async def _sync_source_payment(db: AsyncSession, item: Receivable, *, is_paid: bool) -> None:
    if not item.source_id:
        return
    if item.source_type == ReceivableSource.SHOP_ORDER.value:
        order = await db.get(Order, item.source_id)
        if order:
            order.is_paid = is_paid
            order.paid_at = item.paid_at if is_paid else None
            order.paid_by_id = item.collected_by_id if is_paid else None
    elif item.source_type == ReceivableSource.MEAL_ORDER.value:
        order = await db.get(MealOrder, item.source_id)
        if order:
            order.is_paid = is_paid
            order.paid_at = item.paid_at if is_paid else None
            order.paid_by_id = item.collected_by_id if is_paid else None
