"""唯讀的機器觀測端點，供部署探針與 AI 驗證正式環境狀態。"""

from __future__ import annotations

import asyncio
import hmac
import os
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.metrics import get_celery_stats, get_redis_stats
from api.services.observability import client_route_analytics
from api.services.observability import overview as get_overview

router = APIRouter(prefix="/internal/observability", tags=["Internal / Observability"])
DbDep = Annotated[AsyncSession, Depends(get_db)]
_TOKEN_ENV = "OBSERVABILITY_AGENT_TOKEN"
_TOKEN_HEADER = "X-Observability-Agent-Token"


def _safe_errors(items: list[dict[str, object]]) -> list[dict[str, object]]:
    """僅輸出除錯所需欄位，避免 agent snapshot 帶出 IP、Cookie 或身份資訊。"""
    fields = (
        "error_id",
        "category",
        "exc_type",
        "message",
        "method",
        "path",
        "status_code",
        "first_seen",
        "last_seen",
        "occurrences",
        "source",
    )
    return [{field: item.get(field) for field in fields} for item in items]


def require_agent_token(request: Request) -> None:
    """只允許部署端注入的固定 token；未設定時端點保持關閉。"""
    configured = os.environ.get(_TOKEN_ENV, "").strip()
    supplied = request.headers.get(_TOKEN_HEADER, "").strip()
    if not configured or not supplied or not hmac.compare_digest(supplied, configured):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


@router.get("/snapshot", dependencies=[Depends(require_agent_token)])
async def snapshot(
    session: DbDep,
    window_hours: Annotated[int, Query(ge=1, le=168)] = 24,
) -> dict[str, Any]:
    """回傳不含身份資料的完整觀測快照；不提供任何寫入或控制能力。"""
    db_ok = True
    try:
        await session.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001
        db_ok = False

    redis, celery = await asyncio.gather(get_redis_stats(), get_celery_stats())
    overview = await get_overview(session)
    real_users = await client_route_analytics(window_hours=window_hours)
    return {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "build": {
            "commit_sha": os.environ.get("BUILD_COMMIT", ""),
            "release": os.environ.get("APP_RELEASE", ""),
            "environment": os.environ.get("ENVIRONMENT", ""),
        },
        "system_health": {
            "database": db_ok,
            "redis": redis,
            "celery": celery,
        },
        "coverage": overview["coverage"],
        "pages": overview["pages"],
        "synthetic": overview["synthetic"],
        "field": overview["field"],
        "latest_release": overview["latest_release"],
        "recent_errors": _safe_errors(overview["recent_errors"]),
        "slow_queries": overview["slow_queries"],
        "real_users": real_users,
    }
