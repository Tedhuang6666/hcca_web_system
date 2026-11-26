"""共用應收款服務。"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.spreadsheet import safe_row
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
    class_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    status: str | None = None,
    limit: int = 200,
) -> list[Receivable]:
    stmt = select(Receivable).order_by(Receivable.updated_at.desc()).limit(limit)
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
    class_id: uuid.UUID | None = None,
) -> dict:
    stmt = select(
        func.count(Receivable.id),
        func.coalesce(func.sum(Receivable.amount), 0),
        func.coalesce(func.sum(Receivable.paid_amount), 0),
        func.coalesce(func.sum(Receivable.refunded_amount), 0),
    )
    status_stmt = select(Receivable.status, func.count(Receivable.id)).group_by(Receivable.status)
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


class ReceivableStateError(ValueError):
    """目前狀態不允許此操作（對應 HTTP 409）。"""


class ReceivableAmountError(ValueError):
    """金額不合法（對應 HTTP 422）。"""


_STATUS_LABELS = {
    ReceivableStatus.UNPAID.value: "未收款",
    ReceivableStatus.PARTIAL.value: "部分收款",
    ReceivableStatus.PAID.value: "已收款",
    ReceivableStatus.REFUNDING.value: "部分退款",
    ReceivableStatus.REFUNDED.value: "已退款",
    ReceivableStatus.CANCELED.value: "已取消",
}
_PAYABLE_STATUSES = frozenset({ReceivableStatus.UNPAID.value, ReceivableStatus.PARTIAL.value})
_REFUNDABLE_STATUSES = frozenset(
    {
        ReceivableStatus.PAID.value,
        ReceivableStatus.PARTIAL.value,
        ReceivableStatus.REFUNDING.value,
    }
)
_MONEY_FIELDS = frozenset({"amount", "paid_amount", "refunded_amount", "status"})


async def _locked(db: AsyncSession, item: Receivable) -> Receivable:
    """鎖定應收款列；並行的收款／退款會在此排隊，以資料庫中的最新值判斷。"""
    locked = await db.scalar(
        select(Receivable)
        .where(Receivable.id == item.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if locked is None:
        raise ReceivableStateError("應收款不存在")
    return locked


def _validate_amounts(amount: int, paid: int, refunded: int) -> None:
    if amount < 0 or paid < 0 or refunded < 0:
        raise ReceivableAmountError("金額不可為負數")
    if paid > amount:
        raise ReceivableAmountError("已收金額不可超過應收金額")
    if refunded > paid:
        raise ReceivableAmountError("退款金額不可超過已收金額")


async def update_receivable(
    db: AsyncSession, item: Receivable, data: ReceivableUpdate
) -> Receivable:
    item = await _locked(db, item)
    fields = data.model_dump(exclude_unset=True)
    money_fields = _MONEY_FIELDS & fields.keys()
    if money_fields and item.source_type != ReceivableSource.MANUAL.value:
        # 訂單同步的應收款以訂單為準；直接改這裡會與訂單收款狀態分歧，下次同步又被覆寫。
        raise ReceivableStateError("由訂單產生的應收款，金額與狀態請在原訂單調整")
    requested_status = fields.pop("status", None)
    if requested_status is not None and requested_status != ReceivableStatus.CANCELED:
        raise ReceivableAmountError("收款狀態依金額自動計算，只能手動設為已取消")
    # 先以合併後的值驗證，失敗時不留下半套修改。
    _validate_amounts(
        int(fields.get("amount", item.amount) or 0),
        int(fields.get("paid_amount", item.paid_amount) or 0),
        int(fields.get("refunded_amount", item.refunded_amount) or 0),
    )
    for key, value in fields.items():
        setattr(item, key, value)
    if requested_status == ReceivableStatus.CANCELED:
        item.status = ReceivableStatus.CANCELED.value
    elif money_fields:
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
    item = await _locked(db, item)
    if item.status not in _PAYABLE_STATUSES:
        label = _STATUS_LABELS.get(item.status, item.status)
        raise ReceivableStateError(f"此應收款目前為「{label}」，不能登記收款")
    new_paid = paid_amount if paid_amount is not None else item.amount
    if new_paid <= 0:
        raise ReceivableAmountError("收款金額必須大於 0")
    if new_paid > item.amount:
        raise ReceivableAmountError("已收金額不可超過應收金額")
    order = await _locked_source_order(db, item)
    if order is not None and order.status not in (OrderStatus.PENDING, OrderStatus.CONFIRMED):
        raise ReceivableStateError("訂單已取消或退款，不能登記收款")
    item.paid_amount = new_paid
    item.status = _status_for_amounts(item.amount, item.paid_amount, item.refunded_amount).value
    item.collected_by_id = actor_id
    item.paid_at = datetime.now(UTC)
    if note:
        item.note = note
    await _sync_source_payment(
        db,
        item,
        is_paid=item.status == ReceivableStatus.PAID.value,
        received=item.paid_amount,
    )
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
    item = await _locked(db, item)
    if item.status not in _REFUNDABLE_STATUSES or int(item.paid_amount or 0) <= 0:
        label = _STATUS_LABELS.get(item.status, item.status)
        raise ReceivableStateError(f"此應收款目前為「{label}」，沒有可退款的已收金額")
    new_refunded = refunded_amount if refunded_amount is not None else item.paid_amount
    if new_refunded <= 0:
        raise ReceivableAmountError("退款金額必須大於 0")
    if new_refunded > item.paid_amount:
        raise ReceivableAmountError("退款金額不可超過已收金額")
    await _locked_source_order(db, item)
    item.refunded_amount = new_refunded
    fully_refunded = item.refunded_amount >= item.paid_amount
    item.status = (
        ReceivableStatus.REFUNDED.value if fully_refunded else ReceivableStatus.REFUNDING.value
    )
    item.collected_by_id = actor_id
    item.refunded_at = datetime.now(UTC)
    if note:
        item.note = note
    await _sync_source_payment(
        db,
        item,
        is_paid=False,
        received=item.paid_amount - item.refunded_amount,
    )
    if fully_refunded and item.source_type == ReceivableSource.SHOP_ORDER.value and item.source_id:
        # 全額退款：訂單轉為已退款並釋放優惠使用次數（庫存系統已退役，不回補庫存）。
        from api.services.shop._orders import mark_order_refunded

        await mark_order_refunded(db, item.source_id)
    await db.flush()
    await db.refresh(item)
    return item


async def _locked_source_order(db: AsyncSession, item: Receivable) -> Order | None:
    if item.source_type != ReceivableSource.SHOP_ORDER.value or not item.source_id:
        return None
    return await db.scalar(
        select(Order)
        .where(Order.id == item.source_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


async def cancel_for_source(db: AsyncSession, source_type: str, source_id: uuid.UUID) -> None:
    item = await db.scalar(
        select(Receivable).where(
            Receivable.source_type == source_type, Receivable.source_id == source_id
        )
    )
    if item:
        item.status = ReceivableStatus.CANCELED.value
        await db.flush()


async def sync_shop_order(db: AsyncSession, order: Order) -> Receivable | None:
    if order.test_product_id is not None:
        return None
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
    refunded = int(item.refunded_amount or 0)
    # 訂單的 received_amount 是退款後的淨額；應收款保留「曾收金額」與「已退金額」兩欄。
    net_received = order.total_price if order.is_paid else order.received_amount
    item.paid_amount = net_received + refunded
    item.paid_at = order.paid_at
    item.collected_by_id = order.paid_by_id
    if order.status == OrderStatus.CANCELLED:
        item.status = ReceivableStatus.CANCELED.value
    elif order.status == OrderStatus.REFUNDED:
        item.status = ReceivableStatus.REFUNDED.value
    elif refunded > 0:
        item.status = ReceivableStatus.REFUNDING.value
    else:
        item.status = _status_for_amounts(item.amount, item.paid_amount, refunded).value
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
            safe_row(
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
        )
    return output.getvalue()


async def _sync_source_payment(
    db: AsyncSession, item: Receivable, *, is_paid: bool, received: int
) -> None:
    """把收款結果回寫來源訂單；``received`` 是扣除退款後實際留在班聯的淨額。"""
    if not item.source_id:
        return
    if item.source_type == ReceivableSource.SHOP_ORDER.value:
        order = await db.get(Order, item.source_id)
        if order:
            from api.services.shop._collection_ledger import record_class_collection

            record_class_collection(
                db,
                order,
                amount=received - order.received_amount,
                actor_id=item.collected_by_id,
            )
            if order.supplement_class_id is not None and not order.is_class_balance:
                order.class_id = order.supplement_class_id if is_paid else None
                item.class_id = order.class_id
            order.is_paid = is_paid
            order.received_amount = received
            order.paid_at = item.paid_at if is_paid else None
            order.paid_by_id = item.collected_by_id if is_paid else None
