"""學餐自動結單／未取餐追蹤背景任務測試（apps/api/src/api/services/meal_tasks.py）。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.meal import MealOrderStatus
from api.models.user import User
from api.services import meal as meal_svc
from api.services.meal._export import check_and_handle_no_shows
from api.services.meal._schedule import auto_close_expired_schedules
from api.services.meal_tasks import auto_close_meal_schedules, check_meal_no_shows


def _close_coro(coro, value=None, exc=None):  # noqa: ANN001
    coro.close()
    if exc is not None:
        raise exc
    return value


def test_auto_close_meal_schedules_returns_closed_count() -> None:
    with patch(
        "api.services.meal_tasks.asyncio.run",
        side_effect=lambda coro: _close_coro(coro, 3),
    ):
        result = auto_close_meal_schedules()
    assert result == {"closed_count": 3}


def test_auto_close_meal_schedules_retries_on_failure() -> None:
    with (
        patch.object(auto_close_meal_schedules, "retry", side_effect=Exception("retry called")),
        patch(
            "api.services.meal_tasks.asyncio.run",
            side_effect=lambda coro: _close_coro(coro, exc=RuntimeError("db down")),
        ),
        pytest.raises(Exception, match="retry called"),
    ):
        auto_close_meal_schedules()


def test_check_meal_no_shows_returns_result() -> None:
    fake_result = {"reminded": 1, "marked_no_show": 2}
    with patch(
        "api.services.meal_tasks.asyncio.run",
        side_effect=lambda coro: _close_coro(coro, fake_result),
    ):
        result = check_meal_no_shows()
    assert result == fake_result


async def test_auto_close_expired_schedules_closes_only_past_deadline(
    admin_user: User, db_session: AsyncSession
) -> None:
    vendor = await meal_svc.create_vendor(
        db_session, data=_vendor_create(), created_by=admin_user.id
    )
    # create_schedule 要求 deadline 晚於現在，故先建在未來，再撥回過去模擬
    # 「已過結單時間但尚未關閉」的情境。
    past = await meal_svc.create_schedule(
        db_session,
        data=_schedule_create(vendor.id, datetime.now(UTC) + timedelta(minutes=5)),
        created_by=admin_user.id,
    )
    past.order_deadline = datetime.now(UTC) - timedelta(hours=1)
    future = await meal_svc.create_schedule(
        db_session,
        data=_schedule_create(vendor.id, datetime.now(UTC) + timedelta(days=1)),
        created_by=admin_user.id,
    )
    await db_session.flush()

    count = await auto_close_expired_schedules(db_session)

    assert count >= 1
    await db_session.refresh(past)
    await db_session.refresh(future)
    assert past.is_closed is True
    assert future.is_closed is False


async def test_check_and_handle_no_shows_marks_confirmed_orders(
    admin_user: User, make_user, db_session: AsyncSession
) -> None:
    vendor = await meal_svc.create_vendor(
        db_session, data=_vendor_create(), created_by=admin_user.id
    )
    # 建立時 deadline 設在未來，讓 create_meal_order 通過驗證；建完訂單後再
    # 把 deadline 撥回過去、標記已結單，模擬「結單後追蹤未取餐」的情境。
    schedule = await meal_svc.create_schedule(
        db_session,
        data=_schedule_create(vendor.id, datetime.now(UTC) + timedelta(minutes=5)),
        created_by=admin_user.id,
    )
    item = await meal_svc.add_menu_item(db_session, schedule, data=_menu_item_create())
    buyer = await make_user(email="meal-noshow-buyer@school.edu")
    from api.schemas.meal import MealOrderCreate, MealOrderItemCreate

    order = await meal_svc.create_meal_order(
        db_session,
        user_id=buyer.id,
        data=MealOrderCreate(
            schedule_id=schedule.id,
            items=[MealOrderItemCreate(menu_item_id=item.id, quantity=1)],
        ),
    )
    await meal_svc.confirm_meal_order(db_session, order)
    schedule.order_deadline = datetime.now(UTC) - timedelta(hours=5)
    schedule.is_closed = True
    order.reminder_sent_at = datetime.now(UTC) - timedelta(hours=2)
    await db_session.flush()

    result = await check_and_handle_no_shows(db_session)

    await db_session.refresh(order)
    assert result["marked_no_show"] >= 1
    assert order.is_no_show is True
    assert order.status == MealOrderStatus.CONFIRMED


def _vendor_create():
    from api.schemas.meal import MealVendorCreate

    return MealVendorCreate(name="未取餐測試商家")


def _schedule_create(vendor_id, deadline):  # noqa: ANN001
    from api.schemas.meal import MenuScheduleCreate

    return MenuScheduleCreate(vendor_id=vendor_id, date=deadline.date(), order_deadline=deadline)


def _menu_item_create():
    from api.schemas.meal import MenuItemCreate

    return MenuItemCreate(name="測試餐點", price=50)
