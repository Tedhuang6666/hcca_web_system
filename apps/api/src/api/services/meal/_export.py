"""報表匯出 / 統計 / 未取餐處理"""
from __future__ import annotations

import io
import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.meal import (
    MealOrder,
    MealOrderItem,
    MealOrderStatus,
    MealPickupStatus,
    MealVendor,
    MenuItem,
    MenuSchedule,
)

logger = logging.getLogger(__name__)


# ── 報表匯出 ──────────────────────────────────────────────────────────────────


async def _fetch_meal_order_rows(
    session: AsyncSession,
    vendor_id: uuid.UUID | None = None,
    schedule_id: uuid.UUID | None = None,
) -> list[dict]:
    """聚合學餐訂單明細資料供 Pandas 處理"""
    from api.models.user import User

    q = (
        select(
            MealOrder.serial_number.label("訂單字號"),
            MealOrder.status.label("訂單狀態"),
            MealOrder.total_price.label("訂單總金額"),
            MealOrder.created_at.label("建立時間"),
            MealOrder.notes.label("備註"),
            User.display_name.label("訂購人"),
            User.student_id.label("學號"),
            MenuSchedule.date.label("服務日期"),
            MealVendor.name.label("商家名稱"),
            MenuItem.name.label("品項名稱"),
            MealOrderItem.product_name_snapshot.label("商品快照"),
            MealOrderItem.quantity.label("數量"),
            MealOrderItem.unit_price.label("單價"),
        )
        .join(MealOrderItem, MealOrder.id == MealOrderItem.order_id)
        .outerjoin(MenuItem, MealOrderItem.menu_item_id == MenuItem.id)
        .outerjoin(MenuSchedule, MealOrder.schedule_id == MenuSchedule.id)
        .join(MealVendor, MealOrder.vendor_id == MealVendor.id)
        .join(User, MealOrder.user_id == User.id)
        .order_by(MenuSchedule.date, MealOrder.created_at)
    )
    if vendor_id:
        q = q.where(MealOrder.vendor_id == vendor_id)
    if schedule_id:
        q = q.where(MealOrder.schedule_id == schedule_id)

    result = await session.execute(q)
    rows = result.mappings().all()
    return [
        {
            "服務日期": str(r["服務日期"] or ""),
            "商家名稱": r["商家名稱"],
            "訂單字號": r["訂單字號"],
            "訂購人": r["訂購人"],
            "學號": r["學號"] or "",
            "品項名稱": r["品項名稱"] or r["商品快照"] or "",
            "數量": r["數量"],
            "單價（NT$）": r["單價"],
            "小計（NT$）": r["數量"] * r["單價"],
            "訂單總金額（NT$）": r["訂單總金額"],
            "訂單狀態": r["訂單狀態"].value if hasattr(r["訂單狀態"], "value") else r["訂單狀態"],
            "備註": r["備註"] or "",
            "建立時間": r["建立時間"].strftime("%Y-%m-%d %H:%M:%S") if r["建立時間"] else "",
        }
        for r in rows
    ]


async def export_meal_orders_excel(
    session: AsyncSession,
    vendor_id: uuid.UUID | None = None,
    schedule_id: uuid.UUID | None = None,
) -> bytes:
    """匯出學餐訂單報表 Excel（.xlsx）"""
    import pandas as pd

    rows = await _fetch_meal_order_rows(session, vendor_id=vendor_id, schedule_id=schedule_id)
    cols = [
        "服務日期",
        "商家名稱",
        "訂單字號",
        "訂購人",
        "學號",
        "品項名稱",
        "數量",
        "單價（NT$）",
        "小計（NT$）",
        "訂單總金額（NT$）",
        "訂單狀態",
        "備註",
        "建立時間",
    ]
    df = pd.DataFrame(rows) if rows else pd.DataFrame(columns=cols)

    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="學餐訂單")
        ws = writer.sheets["學餐訂單"]
        for col in ws.columns:
            max_len = max((len(str(cell.value or "")) for cell in col), default=10)
            ws.column_dimensions[col[0].column_letter].width = min(max_len + 4, 50)

    return buf.getvalue()


async def export_meal_orders_csv(
    session: AsyncSession,
    vendor_id: uuid.UUID | None = None,
    schedule_id: uuid.UUID | None = None,
) -> str:
    """匯出學餐訂單報表 CSV（UTF-8 with BOM）"""
    import pandas as pd

    rows = await _fetch_meal_order_rows(session, vendor_id=vendor_id, schedule_id=schedule_id)
    df = pd.DataFrame(rows) if rows else pd.DataFrame()
    return df.to_csv(index=False, encoding="utf-8-sig")


# ── 未取餐處理 ────────────────────────────────────────────────────────────────


async def check_and_handle_no_shows(session: AsyncSession) -> dict:
    """
    未取餐處理（供 Celery Beat 每小時呼叫）：
    - 結單後 1 小時，訂單仍為 confirmed 且未發提醒：寄信給使用者並設定 reminder_sent_at
    - 結單後 4 小時，訂單仍為 confirmed 且已發提醒：標記 is_no_show=True 並通知管理員
    """
    from datetime import timedelta

    from sqlalchemy.orm import selectinload as _sil

    from api.services import outbox

    now = datetime.now(UTC)
    reminder_threshold = now - timedelta(hours=1)
    no_show_threshold = now - timedelta(hours=4)

    q = (
        select(MealOrder)
        .options(
            _sil(MealOrder.user),
            _sil(MealOrder.schedule).selectinload(MenuSchedule.vendor),
        )
        .join(MenuSchedule, MealOrder.schedule_id == MenuSchedule.id)
        .where(MealOrder.status == MealOrderStatus.CONFIRMED)
        .where(MealOrder.is_no_show == False)  # noqa: E712
        .where(MenuSchedule.is_closed == True)  # noqa: E712
        .where(MenuSchedule.order_deadline <= reminder_threshold)
    )
    result = await session.execute(q)
    orders = result.scalars().all()

    reminded = 0
    marked_no_show = 0

    for order in orders:
        deadline = order.schedule.order_deadline
        user_email = order.user.email if order.user else None
        vendor_name = order.schedule.vendor.name if order.schedule.vendor else "商家"
        schedule_date = str(order.schedule.date)

        if order.reminder_sent_at is not None and deadline <= no_show_threshold:
            order.is_no_show = True
            marked_no_show += 1
            logger.info("標記未取餐 serial=%s user=%s", order.serial_number, order.user_id)
            from api.core.config import settings

            if settings.MAIL_FROM:
                try:
                    await outbox.emit(
                        session,
                        event_type="email.send",
                        payload={
                            "to": settings.MAIL_FROM,
                            "subject": (f"[未取餐通知] {vendor_name} {schedule_date} 有訂單未取"),
                            "body": (
                                f"<p>以下訂單已超過 4 小時未取餐，已自動標記：</p>"
                                f"<ul>"
                                f"<li>代碼：<strong>{order.pickup_code}</strong></li>"
                                f"<li>字號：{order.serial_number}</li>"
                                f"<li>金額：NT${order.total_price}</li>"
                                f"<li>商家：{vendor_name}</li>"
                                f"<li>日期：{schedule_date}</li>"
                                f"</ul>"
                                f"<p>請至後台查閱並做後續處理。</p>"
                            ),
                        },
                    )
                except Exception as mail_err:
                    logger.warning(
                        "管理員通知 email outbox 失敗 serial=%s err=%s",
                        order.serial_number,
                        mail_err,
                    )

        elif order.reminder_sent_at is None and user_email:
            order.reminder_sent_at = now
            reminded += 1
            logger.info("發送未取餐提醒 serial=%s email=%s", order.serial_number, user_email)
            try:
                await outbox.emit(
                    session,
                    event_type="email.send",
                    payload={
                        "to": user_email,
                        "subject": f"[學餐提醒] 您在 {vendor_name} 的餐點尚未取",
                        "body": (
                            f"<p>您好，</p>"
                            f"<p>您於 <strong>{schedule_date}</strong> 在 "
                            f"<strong>{vendor_name}</strong> 的訂餐"
                            f"（代碼：<strong>{order.pickup_code}</strong>）尚未取餐。</p>"
                            f"<p>請盡快前往取餐，若超時未取將自動標記為未取餐並通知管理員。</p>"
                            f"<p>感謝您使用學餐系統。</p>"
                        ),
                    },
                )
            except Exception as mail_err:
                logger.warning(
                    "提醒 email outbox 失敗 serial=%s err=%s", order.serial_number, mail_err
                )

    if reminded or marked_no_show:
        await session.flush()

    return {"reminded": reminded, "marked_no_show": marked_no_show}


# ── 統計 / 核銷輔助查詢 ───────────────────────────────────────────────────────


async def get_schedule_item_stats(session: AsyncSession, schedule_id: uuid.UUID) -> list[dict]:
    """
    查詢某排程各品項的已訂數量（排除已取消訂單），供前端熱門排序使用。
    返回 list of {item_id, item_name, total_ordered}。
    """
    result = await session.execute(
        select(
            MealOrderItem.menu_item_id,
            MenuItem.name.label("item_name"),
            func.sum(MealOrderItem.quantity).label("total_ordered"),
        )
        .join(MenuItem, MealOrderItem.menu_item_id == MenuItem.id)
        .join(MealOrder, MealOrderItem.order_id == MealOrder.id)
        .where(MealOrder.schedule_id == schedule_id)
        .where(MealOrder.status != MealOrderStatus.CANCELLED)
        .group_by(MealOrderItem.menu_item_id, MenuItem.name)
    )
    return [
        {
            "item_id": str(r.menu_item_id),
            "item_name": r.item_name,
            "total_ordered": int(r.total_ordered),
        }
        for r in result
    ]


async def get_schedule_pickup_list(session: AsyncSession, schedule_id: uuid.UUID) -> list[dict]:
    """
    取得排程的領餐名單（含訂購人姓名 / 學號 / 訂單狀態），用於核銷作業。
    排除已取消的訂單，依狀態（pending→confirmed→completed）+ 建立時間排序。
    """
    from api.models.user import User

    result = await session.execute(
        select(
            MealOrder.id,
            MealOrder.serial_number,
            MealOrder.pickup_code,
            MealOrder.status,
            MealOrder.total_price,
            MealOrder.notes,
            MealOrder.created_at,
            MealOrder.is_no_show,
            User.display_name,
            User.student_id,
        )
        .join(User, MealOrder.user_id == User.id)
        .where(MealOrder.schedule_id == schedule_id)
        .where(MealOrder.status != MealOrderStatus.CANCELLED)
        .order_by(MealOrder.status, MealOrder.created_at)
    )
    return [
        {
            "order_id": str(r.id),
            "serial_number": r.serial_number,
            "pickup_code": r.pickup_code,
            "status": r.status.value,
            "total_price": r.total_price,
            "notes": r.notes,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "is_no_show": r.is_no_show,
            "display_name": r.display_name,
            "student_id": r.student_id,
        }
        for r in result.mappings().all()
    ]
