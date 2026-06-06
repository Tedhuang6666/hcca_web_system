"""Prometheus metrics middleware + /metrics endpoint（ADR-001）。

設計：
- prometheus_client 為 optional 依賴；未安裝時 metrics_enabled = False、
  middleware no-op、/metrics endpoint 回 503
- 安裝後立即生效；無需改 router 或 service 程式碼

啟用方式（生產）：
    uv add prometheus-client --project apps/api
    docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

Metrics 收錄：
    hcca_http_requests_total{method, path_template, status}
    hcca_http_request_duration_seconds{method, path_template}（histogram）
    hcca_http_in_flight{method}
    hcca_db_query_count_per_request（histogram）
    hcca_celery_queue_depth{queue}（gauge；由其他 job 寫入）

對應 docs/SLO.md 的 SLI 量測來源。

注意命名：本檔為對外 Prometheus；內部用的 metrics signal collector 仍在
[apps/api/src/api/core/metrics.py]，兩者用途不同。
"""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable

from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger(__name__)

# ── 條件 import：未安裝 prometheus_client 仍能跑 ────────────────
try:
    from prometheus_client import (
        CONTENT_TYPE_LATEST,
        CollectorRegistry,
        Counter,
        Gauge,
        Histogram,
        generate_latest,
    )

    metrics_enabled = True
except ImportError:
    metrics_enabled = False
    CONTENT_TYPE_LATEST = "text/plain; version=0.0.4; charset=utf-8"
    CollectorRegistry = None  # type: ignore[assignment]
    Counter = Gauge = Histogram = None  # type: ignore[assignment]
    generate_latest = None  # type: ignore[assignment]


_registry = None
_http_requests_total = None
_http_request_duration = None
_http_in_flight = None
_db_query_count = None
_celery_queue_depth = None


def init_metrics() -> None:
    """初始化 metric collectors。冪等。"""
    global _registry, _http_requests_total, _http_request_duration
    global _http_in_flight, _db_query_count, _celery_queue_depth

    if not metrics_enabled:
        logger.info(
            "prometheus_client not installed; "
            "metrics disabled. Run `uv add prometheus-client --project apps/api` to enable."
        )
        return
    if _registry is not None:
        return

    _registry = CollectorRegistry()
    _http_requests_total = Counter(
        "hcca_http_requests_total",
        "Total HTTP requests",
        labelnames=["method", "path_template", "status"],
        registry=_registry,
    )
    _http_request_duration = Histogram(
        "hcca_http_request_duration_seconds",
        "HTTP request latency",
        labelnames=["method", "path_template"],
        buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
        registry=_registry,
    )
    _http_in_flight = Gauge(
        "hcca_http_in_flight",
        "Currently in-flight requests",
        labelnames=["method"],
        registry=_registry,
    )
    _db_query_count = Histogram(
        "hcca_db_query_count_per_request",
        "Number of DB queries per HTTP request",
        labelnames=["method"],
        buckets=(1, 2, 4, 8, 16, 32, 64, 128),
        registry=_registry,
    )
    _celery_queue_depth = Gauge(
        "hcca_celery_queue_depth",
        "Celery queue depth (set by external probe)",
        labelnames=["queue"],
        registry=_registry,
    )


def render_metrics() -> bytes:
    """渲染最新 metrics 為 prometheus text format。"""
    if not metrics_enabled or _registry is None:
        return b"# prometheus_client not installed; metrics disabled\n"
    return generate_latest(_registry)


def set_queue_depth(queue: str, depth: int) -> None:
    """讓外部探測（Celery flower probe / beat task）更新 queue depth。"""
    if not metrics_enabled or _celery_queue_depth is None:
        return
    _celery_queue_depth.labels(queue=queue).set(depth)


def _route_template(request: Request) -> str:
    """從 request 拿 path template（如 /users/{id}）；無 match 時用原 path。"""
    route = request.scope.get("route")
    if route is None:
        return request.url.path
    return getattr(route, "path", request.url.path)


class PrometheusMetricsMiddleware:
    """ASGI middleware：對每個 HTTP request 統計請求 / 延遲 / in-flight。

    用 path_template（而非實際 URL）避免 cardinality 爆炸（每個 user_id 都成 label）。
    """

    def __init__(self, app: Callable[[Request], Awaitable[Response]]) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or not metrics_enabled:
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET")
        start = time.perf_counter()
        status_holder = {"code": 500}

        if _http_in_flight is not None:
            _http_in_flight.labels(method=method).inc()

        async def _send_wrapper(message) -> None:
            if message["type"] == "http.response.start":
                status_holder["code"] = message.get("status", 500)
            await send(message)

        try:
            await self.app(scope, receive, _send_wrapper)
        finally:
            duration = time.perf_counter() - start
            if _http_in_flight is not None:
                _http_in_flight.labels(method=method).dec()

            request = Request(scope, receive=receive)
            tpl = _route_template(request)
            status = str(status_holder["code"])

            if _http_requests_total is not None:
                _http_requests_total.labels(method=method, path_template=tpl, status=status).inc()
            if _http_request_duration is not None:
                _http_request_duration.labels(method=method, path_template=tpl).observe(duration)

            try:
                from api.core.query_audit import get_request_counters

                query_count, _slow_count, _query_ms = get_request_counters()
                if _db_query_count is not None:
                    _db_query_count.labels(method=method).observe(query_count)
            except Exception:
                pass


__all__ = [
    "CONTENT_TYPE_LATEST",
    "PrometheusMetricsMiddleware",
    "init_metrics",
    "metrics_enabled",
    "render_metrics",
    "set_queue_depth",
]
