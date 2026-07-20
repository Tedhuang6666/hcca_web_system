"""平台產品統計 API schema。"""

from datetime import date

from pydantic import BaseModel, Field


class PageViewCreate(BaseModel):
    path: str = Field(min_length=1, max_length=255)


class DailyRegistrationItem(BaseModel):
    date: date
    count: int


class PageMetricItem(BaseModel):
    path: str
    label: str
    views: int
    unique_visitors: int
    click_rate: float


class ProductAnalyticsOut(BaseModel):
    date_from: date
    date_to: date
    total_users: int
    total_page_views: int
    active_pages: int
    daily_registrations: list[DailyRegistrationItem]
    page_metrics: list[PageMetricItem]
