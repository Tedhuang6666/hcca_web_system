"""平台產品統計 service。"""

from __future__ import annotations

import hashlib
import hmac
import re
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.models.analytics_page_view import AnalyticsPageView
from api.models.public_site_page_view import PublicSitePageView
from api.models.site import PublicSitePage
from api.models.user import User
from api.schemas.analytics import (
    ArticleAnalyticsOut,
    ArticleDeviceMetricItem,
    ArticleMetricItem,
    DailyArticleViewItem,
    DailyRegistrationItem,
    PageMetricItem,
    ProductAnalyticsOut,
    PublicArticleViewCreate,
)


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


def _visitor_hash(visitor_id: str) -> str:
    """以伺服器金鑰雜湊瀏覽器識別碼，避免資料庫保存原始值。"""
    return hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        visitor_id.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


async def record_public_article_view(
    db: AsyncSession, slug: str, data: PublicArticleViewCreate
) -> bool:
    page = await db.scalar(
        select(PublicSitePage).where(
            PublicSitePage.slug == slug,
            PublicSitePage.page_kind == "article",
            PublicSitePage.is_published.is_(True),
        )
    )
    if page is None:
        return False

    db.add(
        PublicSitePageView(
            page_id=page.id,
            visitor_hash=_visitor_hash(data.visitor_id),
            device_class=data.device_class,
        )
    )
    await db.flush()
    return True


async def get_article_analytics(
    db: AsyncSession,
    date_from: date | None,
    date_to: date | None,
) -> ArticleAnalyticsOut:
    start, end = _range_bounds(date_from, date_to)
    start_at = _start_datetime(start)
    end_at = _end_datetime(end)
    view_range = (
        PublicSitePageView.created_at >= start_at,
        PublicSitePageView.created_at < end_at,
    )

    published_articles = int(
        await db.scalar(
            select(func.count(PublicSitePage.id)).where(
                PublicSitePage.page_kind == "article",
                PublicSitePage.is_published.is_(True),
            )
        )
        or 0
    )
    total_views = int(
        await db.scalar(select(func.count(PublicSitePageView.id)).where(*view_range)) or 0
    )
    unique_visitors = int(
        await db.scalar(
            select(func.count(func.distinct(PublicSitePageView.visitor_hash))).where(*view_range)
        )
        or 0
    )

    day_expr = func.date(PublicSitePageView.created_at)
    daily_rows = (
        await db.execute(
            select(
                day_expr.label("day"),
                func.count(PublicSitePageView.id).label("views"),
                func.count(func.distinct(PublicSitePageView.visitor_hash)).label("unique_visitors"),
            )
            .where(*view_range)
            .group_by(day_expr)
            .order_by(day_expr)
        )
    ).all()
    daily_counts = {str(row.day): (int(row.views), int(row.unique_visitors)) for row in daily_rows}
    daily_views = [
        DailyArticleViewItem(
            date=day,
            views=daily_counts.get(day.isoformat(), (0, 0))[0],
            unique_visitors=daily_counts.get(day.isoformat(), (0, 0))[1],
        )
        for day in (start + timedelta(days=index) for index in range((end - start).days + 1))
    ]

    article_rows = (
        await db.execute(
            select(
                PublicSitePage.id.label("page_id"),
                PublicSitePage.slug,
                PublicSitePage.title,
                func.count(PublicSitePageView.id).label("views"),
                func.count(func.distinct(PublicSitePageView.visitor_hash)).label("unique_visitors"),
                func.max(PublicSitePageView.created_at).label("last_viewed_at"),
            )
            .join(PublicSitePageView, PublicSitePageView.page_id == PublicSitePage.id)
            .where(*view_range)
            .group_by(PublicSitePage.id, PublicSitePage.slug, PublicSitePage.title)
            .order_by(func.count(PublicSitePageView.id).desc(), PublicSitePage.title)
            .limit(20)
        )
    ).all()
    top_articles = [
        ArticleMetricItem(
            page_id=row.page_id,
            slug=row.slug,
            title=row.title,
            views=int(row.views),
            unique_visitors=int(row.unique_visitors),
            last_viewed_at=row.last_viewed_at,
        )
        for row in article_rows
    ]

    device_rows = (
        await db.execute(
            select(
                PublicSitePageView.device_class,
                func.count(PublicSitePageView.id).label("views"),
            )
            .where(*view_range)
            .group_by(PublicSitePageView.device_class)
            .order_by(func.count(PublicSitePageView.id).desc())
        )
    ).all()
    device_metrics = [
        ArticleDeviceMetricItem(
            device_class=row.device_class,
            views=int(row.views),
            share=round(int(row.views) / total_views, 4) if total_views else 0,
        )
        for row in device_rows
        if row.device_class in {"mobile", "tablet", "desktop"}
    ]

    return ArticleAnalyticsOut(
        date_from=start,
        date_to=end,
        published_articles=published_articles,
        total_views=total_views,
        unique_visitors=unique_visitors,
        daily_views=daily_views,
        top_articles=top_articles,
        device_metrics=device_metrics,
    )


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
