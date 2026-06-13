"""Prometheus metrics middleware + /metrics endpoint（ADR-001）。

prometheus_client 是正式依賴，API 與 worker 啟動後立即生效。

Metrics 收錄：
    hcca_http_requests_total{method, path_template, status}
    hcca_http_request_duration_seconds{method, path_template}（histogram）
    hcca_http_in_flight{method}
    hcca_db_query_count_per_request（histogram）
    hcca_celery_queue_depth{queue}（gauge；由其他 job 寫入）
    hcca_celery_tasks_total{task,status}
    hcca_document_approval_total{status}
    hcca_email_delivery_total{status}
    hcca_webhook_delivery_total{event_type,status}
    hcca_outbox_delivery_total{event_type,status}
    hcca_backup_runs_total{kind,status}
    hcca_websocket_connections

對應 docs/SLO.md 的 SLI 量測來源。

注意命名：本檔為對外 Prometheus；內部用的 metrics signal collector 仍在
[apps/api/src/api/core/metrics.py]，兩者用途不同。
"""

from __future__ import annotations

import logging
import os
import time

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger(__name__)

metrics_enabled = True


_registry = None
_http_requests_total = None
_http_request_duration = None
_http_in_flight = None
_db_query_count = None
_celery_queue_depth = None
_celery_tasks_total = None
_document_approval_total = None
_email_delivery_total = None
_webhook_delivery_total = None
_outbox_delivery_total = None
_backup_runs_total = None
_backup_last_success = None
_websocket_connections = None
_metrics_server_started = False


def init_metrics() -> None:
    """初始化 metric collectors。冪等。"""
    global _registry, _http_requests_total, _http_request_duration
    global _http_in_flight, _db_query_count, _celery_queue_depth
    global _celery_tasks_total, _document_approval_total, _email_delivery_total
    global _webhook_delivery_total, _outbox_delivery_total, _backup_runs_total
    global _backup_last_success, _websocket_connections

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
    _celery_tasks_total = Counter(
        "hcca_celery_tasks_total",
        "Celery task outcomes",
        labelnames=["task", "status"],
        registry=_registry,
    )
    _document_approval_total = Counter(
        "hcca_document_approval_total",
        "Document approval state-machine outcomes",
        labelnames=["status"],
        registry=_registry,
    )
    _email_delivery_total = Counter(
        "hcca_email_delivery_total",
        "Email delivery outcomes",
        labelnames=["status"],
        registry=_registry,
    )
    _webhook_delivery_total = Counter(
        "hcca_webhook_delivery_total",
        "Webhook delivery outcomes",
        labelnames=["event_type", "status"],
        registry=_registry,
    )
    _outbox_delivery_total = Counter(
        "hcca_outbox_delivery_total",
        "Outbox delivery outcomes",
        labelnames=["event_type", "status"],
        registry=_registry,
    )
    _backup_runs_total = Counter(
        "hcca_backup_runs_total",
        "Backup run outcomes",
        labelnames=["kind", "status"],
        registry=_registry,
    )
    _backup_last_success = Gauge(
        "hcca_backup_last_success_timestamp_seconds",
        "Unix timestamp of the latest successful backup",
        labelnames=["kind"],
        registry=_registry,
    )
    _websocket_connections = Gauge(
        "hcca_websocket_connections",
        "Current WebSocket connections in this API process",
        registry=_registry,
    )


def render_metrics() -> bytes:
    """渲染最新 metrics 為 prometheus text format。"""
    if _registry is None:
        init_metrics()
    assert _registry is not None  # nosec B101
    return generate_latest(_registry)


def start_metrics_server_from_env() -> bool:
    """Start a worker-local metrics HTTP server when a port is configured."""
    global _metrics_server_started
    if _metrics_server_started or not metrics_enabled:
        return _metrics_server_started
    raw_port = os.getenv("PROMETHEUS_METRICS_PORT", "").strip()
    if not raw_port:
        return False

    from prometheus_client import start_http_server

    init_metrics()
    assert _registry is not None  # nosec B101
    start_http_server(int(raw_port), registry=_registry)
    _metrics_server_started = True
    logger.info("Prometheus worker metrics listening on port %s", raw_port)
    return True


def set_queue_depth(queue: str, depth: int) -> None:
    """讓外部探測（Celery flower probe / beat task）更新 queue depth。"""
    if not metrics_enabled or _celery_queue_depth is None:
        return
    _celery_queue_depth.labels(queue=queue).set(depth)


def record_celery_task(task: str | None, status: str) -> None:
    if _celery_tasks_total is not None:
        _celery_tasks_total.labels(task=task or "unknown", status=status).inc()


def record_document_approval(status: str) -> None:
    if _document_approval_total is not None:
        _document_approval_total.labels(status=status).inc()


def record_email_delivery(status: str) -> None:
    if _email_delivery_total is not None:
        _email_delivery_total.labels(status=status).inc()


def record_webhook_delivery(event_type: str, status: str) -> None:
    if _webhook_delivery_total is not None:
        _webhook_delivery_total.labels(event_type=event_type, status=status).inc()


def record_outbox_delivery(event_type: str, status: str) -> None:
    if _outbox_delivery_total is not None:
        _outbox_delivery_total.labels(event_type=event_type, status=status).inc()


def record_backup_run(kind: str, status: str) -> None:
    if _backup_runs_total is not None:
        _backup_runs_total.labels(kind=kind, status=status).inc()
    if status == "success" and _backup_last_success is not None:
        _backup_last_success.labels(kind=kind).set_to_current_time()


def set_websocket_connections(count: int) -> None:
    if _websocket_connections is not None:
        _websocket_connections.set(count)


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

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not metrics_enabled:
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET")
        start = time.perf_counter()
        status_holder = {"code": 500}

        if _http_in_flight is not None:
            _http_in_flight.labels(method=method).inc()

        async def _send_wrapper(message: Message) -> None:
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
            except Exception:  # nosec B110
                pass


__all__ = [
    "CONTENT_TYPE_LATEST",
    "PrometheusMetricsMiddleware",
    "init_metrics",
    "metrics_enabled",
    "record_backup_run",
    "record_celery_task",
    "record_document_approval",
    "record_email_delivery",
    "record_outbox_delivery",
    "record_webhook_delivery",
    "render_metrics",
    "set_queue_depth",
    "set_websocket_connections",
    "start_metrics_server_from_env",
]
