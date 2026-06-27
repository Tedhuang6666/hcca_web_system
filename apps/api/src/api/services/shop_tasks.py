"""商品系統 Celery 定時任務 - 商品截止後通知班級幹部結單"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from api.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(
    name="api.services.shop_tasks.notify_class_cadres_on_deadline",
    bind=True,
    max_retries=3,
)
def notify_class_cadres_on_deadline(self) -> dict:  # noqa: ANN001
    """
    Celery Beat 定時任務：商品截止販售後，通知各受影響班級幹部協助結單收費。

    每 5 分鐘執行一次；掃描 sale_end 落在最近 6 分鐘內（剛截止）的商品，
    找出有訂單的班級，對其幹部建立站內通知。視窗略大於排程間隔以避免漏發，
    可能導致極少數情況重複通知，對結單流程無害。
    """

    async def _run() -> int:
        from sqlalchemy import func, select

        from api.core.database import task_session
        from api.models.notification import Notification
        from api.models.school_class import ClassCadre
        from api.models.shop import Order, OrderItem, OrderStatus, Product

        notified = 0
        async with task_session() as session:
            try:
                now = datetime.now(UTC)
                window_start = now - timedelta(minutes=6)
                product_ids = (
                    (
                        await session.execute(
                            select(Product.id).where(
                                Product.sale_end.is_not(None),
                                Product.sale_end > window_start,
                                Product.sale_end <= now,
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                if product_ids:
                    class_rows = (
                        await session.execute(
                            select(
                                Order.class_id,
                                func.count(func.distinct(Order.id)),
                            )
                            .join(OrderItem, OrderItem.order_id == Order.id)
                            .where(
                                OrderItem.product_id.in_(product_ids),
                                Order.status != OrderStatus.CANCELLED,
                                Order.class_id.is_not(None),
                            )
                            .group_by(Order.class_id)
                        )
                    ).all()
                    for class_id, order_count in class_rows:
                        cadre_ids = (
                            (
                                await session.execute(
                                    select(ClassCadre.user_id).where(
                                        ClassCadre.class_id == class_id
                                    )
                                )
                            )
                            .scalars()
                            .all()
                        )
                        for user_id in cadre_ids:
                            session.add(
                                Notification(
                                    user_id=user_id,
                                    type="system",
                                    title="班級商品訂單已結單",
                                    body=(
                                        f"貴班有 {order_count} 筆商品訂單已截止，"
                                        "請協助核對訂購情形與收費。"
                                    ),
                                    link="/shop/class-orders",
                                    related_id=class_id,
                                )
                            )
                            notified += 1
                await session.commit()
                return notified
            except Exception:
                await session.rollback()
                raise

    try:
        count = asyncio.run(_run())
        logger.info("[Celery Beat] 班級結單通知完成，共通知 %d 位幹部", count)
        return {"notified": count}
    except Exception as exc:
        logger.error("[Celery Beat] 班級結單通知失敗: %s", exc)
        raise self.retry(exc=exc, countdown=120) from exc


@celery_app.task(
    name="api.services.shop_tasks.cleanup_expired_seat_holds",
    bind=True,
    max_retries=3,
)
def cleanup_expired_seat_holds(self) -> dict:  # noqa: ANN001
    """Celery Beat 定時任務：清除過期的劃位暫時保留鎖（SeatHold）。

    每分鐘執行；保留鎖過期後座位即釋放回可選狀態。選位畫面查詢時亦會即時
    濾掉過期 hold，此任務只是把垃圾列清掉、避免無限累積。
    """

    async def _run() -> int:
        from api.core.database import task_session
        from api.services import seating as seating_svc

        async with task_session() as session:
            try:
                removed = await seating_svc.cleanup_expired_holds(session)
                await session.commit()
                return removed
            except Exception:
                await session.rollback()
                raise

    try:
        count = asyncio.run(_run())
        if count:
            logger.info("[Celery Beat] 清除過期劃位保留鎖 %d 筆", count)
        return {"removed": count}
    except Exception as exc:
        logger.error("[Celery Beat] 清除過期劃位保留鎖失敗: %s", exc)
        raise self.retry(exc=exc, countdown=60) from exc
