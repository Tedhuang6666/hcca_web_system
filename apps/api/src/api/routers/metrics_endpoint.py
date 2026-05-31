"""Prometheus /metrics endpoint。Phase A2。

不需 auth（依 ADR-001、Cloudflare Access 或 IP 白名單於 edge 保護）。
未安裝 prometheus_client → 回 503 + 安裝指示。
"""

from fastapi import APIRouter, Response

from api.core.prometheus_metrics import (
    CONTENT_TYPE_LATEST,
    metrics_enabled,
    render_metrics,
)

router = APIRouter(tags=["可觀測性"])


@router.get(
    "/metrics",
    response_class=Response,
    include_in_schema=False,
)
async def metrics() -> Response:
    if not metrics_enabled:
        return Response(
            content=(
                "prometheus_client not installed.\n"
                "To enable: `uv add prometheus-client --project apps/api` then restart.\n"
            ),
            media_type="text/plain",
            status_code=503,
        )
    return Response(content=render_metrics(), media_type=CONTENT_TYPE_LATEST)
