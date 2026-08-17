"""平台產品統計 API schema。"""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class PageViewCreate(BaseModel):
    path: str = Field(min_length=1, max_length=2048)

    @field_validator("path")
    @classmethod
    def bound_path_for_storage(cls, value: str) -> str:
        """Keep telemetry from failing when an editor URL exceeds the DB limit."""
        return value if len(value) <= 255 else f"{value[:252]}..."


class ClientMetricCreate(BaseModel):
    metric: str = Field(min_length=1, max_length=50, pattern=r"^[a-z0-9_]+$")
    value: float = Field(ge=0, le=86_400_000)
    path: str = Field(min_length=1, max_length=255)
    status: int | None = Field(default=None, ge=0, le=599)
    duration_ms: float | None = Field(default=None, ge=0, le=86_400_000)
    attempts: int | None = Field(default=None, ge=0, le=10)
    circuit_open: bool = False
    component_name: str | None = Field(default=None, min_length=1, max_length=150)
    resource_name: str | None = Field(default=None, min_length=1, max_length=500)
    initiator_type: str | None = Field(default=None, min_length=1, max_length=50)
    start_time_ms: float | None = Field(default=None, ge=0, le=86_400_000)
    response_end_ms: float | None = Field(default=None, ge=0, le=86_400_000)
    interaction_id: str | None = Field(default=None, min_length=1, max_length=80)
    interaction_name: str | None = Field(default=None, min_length=1, max_length=120)
    interaction_kind: Literal["click", "submit", "change"] | None = None
    operation_kind: Literal["simple_get", "crud", "heavy"] | None = None
    method: str | None = Field(default=None, min_length=1, max_length=12)
    budget_ms: float | None = Field(default=None, ge=0, le=86_400_000)
    device_class: Literal["mobile", "desktop"] | None = None
    auth_state: Literal["public", "authenticated"] | None = None
    connection_type: str | None = Field(default=None, min_length=1, max_length=20)
    release: str | None = Field(default=None, min_length=1, max_length=64)


class ClientMetricBatchCreate(BaseModel):
    items: list[ClientMetricCreate] = Field(min_length=1, max_length=100)


class ComponentMetricCreate(BaseModel):
    component_name: str = Field(min_length=1, max_length=150)
    path: str = Field(min_length=1, max_length=255)
    render_count: int = Field(ge=1, le=1_000_000)
    total_render_time_ms: float = Field(ge=0, le=86_400_000)
    avg_render_time_ms: float = Field(ge=0, le=86_400_000)
    max_render_time_ms: float = Field(ge=0, le=86_400_000)
    last_render_time_ms: float = Field(ge=0, le=86_400_000)
    actual_duration_ms: float | None = Field(default=None, ge=0, le=86_400_000)
    base_duration_ms: float | None = Field(default=None, ge=0, le=86_400_000)
    phase: Literal["mount", "update", "nested-update", "unmount"] | None = None
    tags: dict[str, str] = Field(default_factory=dict)


class ComponentMetricBatchCreate(BaseModel):
    items: list[ComponentMetricCreate] = Field(min_length=1, max_length=50)


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
