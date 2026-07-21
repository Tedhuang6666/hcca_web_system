"""平台產品統計 service。"""

from __future__ import annotations

import re
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.analytics_page_view import AnalyticsPageView
from api.models.user import User
from api.schemas.analytics import DailyRegistrationItem, PageMetricItem, ProductAnalyticsOut


def _range_bounds(date_from: date | None, date_to: date | None) -> tuple[date, date]:
    today = datetime.now(UTC).date()
    end = date_to or today
    start = date_from or end - timedelta(days=29)
    if start > end:
        raise ValueError("date_from 不得晚於 date_to")
    return start, end


def _start_datetime(day: date) -> datetime:
    return datetime.combine(day, time.min, tzinfo=UTC)


def _end_datetime(day: date) -> datetime:
    return datetime.combine(day + timedelta(days=1), time.min, tzinfo=UTC)


def normalize_page_path(path: str) -> str:
    """將含 UUID 或數字 ID 的路徑折疊成可讀的頁面路徑。"""
    value = path.split("?", 1)[0].strip()
    if not value.startswith("/"):
        return "/"
    return re.sub(
        r"/(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|\d+)(?=/|$)",
        "/:id",
        value,
        flags=re.IGNORECASE,
    )[:255]


def page_label(path: str) -> str:
    labels = {
        "/": "首頁",
        "/analytics": "績效統計",
        "/announcements": "公告",
        "/documents": "公文",
        "/regulations": "法規",
        "/meetings": "會議",
        "/petitions": "陳情",
        "/shop": "購票",
        "/meal": "學餐",
        "/surveys": "問卷",
        "/settings": "個人設定",
    }
    root = "/" + path.strip("/").split("/", 1)[0] if path != "/" else "/"
    return labels.get(root, path)


async def record_page_view(db: AsyncSession, user_id, path: str) -> None:
    db.add(AnalyticsPageView(user_id=user_id, path=normalize_page_path(path)))
    await db.flush()


async def get_product_analytics(
    db: AsyncSession,
    date_from: date | None,
    date_to: date | None,
) -> ProductAnalyticsOut:
    start, end = _range_bounds(date_from, date_to)
    start_at = _start_datetime(start)
    end_at = _end_datetime(end)

    user_date = func.date(User.created_at)
    user_rows = (
        await db.execute(
            select(user_date.label("day"), func.count(User.id))
            .where(User.created_at >= start_at, User.created_at < end_at)
            .group_by(user_date)
        )
    ).all()
    user_counts = {str(row.day): int(row[1]) for row in user_rows}
    daily_registrations = [
        DailyRegistrationItem(date=day, count=user_counts.get(day.isoformat(), 0))
        for day in (start + timedelta(days=index) for index in range((end - start).days + 1))
    ]

    total_users = int(
        await db.scalar(
            select(func.count(User.id)).where(User.created_at >= start_at, User.created_at < end_at)
        )
        or 0
    )
    total_page_views = int(
        await db.scalar(
            select(func.count(AnalyticsPageView.id)).where(
                AnalyticsPageView.created_at >= start_at,
                AnalyticsPageView.created_at < end_at,
            )
        )
        or 0
    )
    page_rows = (
        await db.execute(
            select(
                AnalyticsPageView.path,
                func.count(AnalyticsPageView.id).label("views"),
                func.count(func.distinct(AnalyticsPageView.user_id)).label("unique_visitors"),
            )
            .where(
                AnalyticsPageView.created_at >= start_at,
                AnalyticsPageView.created_at < end_at,
            )
            .group_by(AnalyticsPageView.path)
            .order_by(func.count(AnalyticsPageView.id).desc())
            .limit(30)
        )
    ).all()
    page_metrics = [
        PageMetricItem(
            path=row.path,
            label=page_label(row.path),
            views=int(row.views),
            unique_visitors=int(row.unique_visitors),
            click_rate=round(int(row.views) / total_page_views, 4) if total_page_views else 0,
        )
        for row in page_rows
    ]

    return ProductAnalyticsOut(
        date_from=start,
        date_to=end,
        total_users=total_users,
        total_page_views=total_page_views,
        active_pages=len(page_metrics),
        daily_registrations=daily_registrations,
        page_metrics=page_metrics,
    )
