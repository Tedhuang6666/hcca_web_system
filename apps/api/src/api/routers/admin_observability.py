# ruff: noqa: E702
import asyncio
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.core.database import get_db
from api.core.error_audit import get_recent_errors
from api.core.metrics import get_celery_stats, get_redis_stats
from api.core.query_audit import get_slow_queries
from api.dependencies.auth import get_current_active_user
from api.models.user import User
from api.services.observability import (
    client_route_analytics,
    collect_crux_daily,
    critical_urls,
    crux_history,
    ensure_release,
    latest_page_scores,
    provider_snapshot,
)
from api.services.observability import overview as get_overview
from api.services.observability_tasks import collect_pagespeed_scheduled

router = APIRouter(prefix="/admin/system/observability", tags=["管理員 / Observability"])
DbDep = Annotated[AsyncSession, Depends(get_db)]


async def require_superuser(user: User = Depends(get_current_active_user)) -> User:
    if not user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要超級管理員權限")
    return user


@router.get("/overview", summary="Observability Overview")
async def overview(
    session: DbDep, _admin: Annotated[User, Depends(require_superuser)]
) -> dict[str, Any]:
    db_ok = True
    try:
        await session.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001
        db_ok = False
    redis, celery = await asyncio.gather(get_redis_stats(), get_celery_stats())
    snapshot = await get_overview(session)
    return {
        "system_health": [
            {"name": "API", "healthy": True},
            {"name": "PostgreSQL", "healthy": db_ok},
            {"name": "Redis", "healthy": redis.get("error") is None, "detail": redis},
            {"name": "Celery", "healthy": celery.get("error") is None, "detail": celery},
        ],
        "reliability": {
            "error_rate": None,
            "affected_users": None,
            "new_issues": len(snapshot["recent_errors"]),
            "regressions": snapshot["coverage"]["needs_attention"],
        },
        "providers": await provider_snapshot(),
        **snapshot,
    }


@router.get("/errors")
async def errors(
    session: DbDep, _admin: Annotated[User, Depends(require_superuser)]
) -> dict[str, Any]:
    recent = await get_recent_errors(top=50)
    slow_queries = get_slow_queries(top=50)
    sentry = (await provider_snapshot()).get("sentry", {})
    return {
        "new_issues": len(recent),
        "regressions": None,
        "affected_users": None,
        "error_rate": None,
        "top_exceptions": recent,
        "slow_transactions": slow_queries,
        "sentry": sentry,
        "slow_query_source": "in_memory_query_audit",
        "source": "sentry",
    }


@router.get("/real-users")
async def real_users(
    _admin: Annotated[User, Depends(require_superuser)],
    window_hours: Annotated[int, Query(ge=1, le=168)] = 24,
) -> dict[str, Any]:
    telemetry = await client_route_analytics(window_hours=window_hours)
    routes = telemetry.get("routes", [])
    latest_vitals = {
        key: value
        for route in routes
        for key, value in route.get("web_vitals", {}).items()
        if value is not None
    }
    return {
        "configured": bool(settings.POSTHOG_PERSONAL_API_KEY),
        "data_available": bool(telemetry.get("available")),
        "dau": None,
        "sessions": None,
        "pageviews": telemetry.get("pageviews", 0),
        "top_routes": routes[:30],
        "web_vitals": latest_vitals,
        "funnel": [],
        "client_errors": None,
        "source": telemetry.get("source", "first_party_redis"),
        "message": "第一方 RUM 會自動收集所有已造訪路由；DAU 與 sessions 需另接可查詢的 PostHog Personal API key。",
        "window_hours": telemetry.get("window_hours", 24),
        "telemetry_error": telemetry.get("error"),
    }


@router.get("/performance")
async def performance(
    session: DbDep,
    _admin: Annotated[User, Depends(require_superuser)],
    url: str | None = None,
) -> dict[str, Any]:
    target = url or (critical_urls()[0] if critical_urls() else "")
    base = str(settings.FRONTEND_BASE_URL).rstrip("/")
    if target and not (target == base or target.startswith(f"{base}/")):
        raise HTTPException(status_code=400, detail="只能查詢本站頁面")
    page_scores = await latest_page_scores(session, target)
    try:
        crux = await crux_history(target) if target else {}
    except Exception as exc:  # noqa: BLE001
        crux = {"url": target, "collection_periods": [], "error": exc.__class__.__name__}
    return {
        "url": target,
        "psi": page_scores,
        "crux": crux,
        "lighthouse_regressions": [page for page in page_scores if page["status"] != "pass"],
    }


@router.get("/releases")
async def releases(
    session: DbDep, _admin: Annotated[User, Depends(require_superuser)]
) -> list[dict[str, Any]]:
    from api.models.observability import ObservabilityRelease

    rows = (
        (
            await session.execute(
                select(ObservabilityRelease)
                .order_by(ObservabilityRelease.deployed_at.desc())
                .limit(20)
            )
        )
        .scalars()
        .all()
    )
    return [
        {
            "release": row.release,
            "commit_sha": row.commit_sha,
            "environment": row.environment,
            "deployed_at": row.deployed_at,
        }
        for row in rows
    ]


@router.post("/collect/psi")
async def collect_psi(_admin: Annotated[User, Depends(require_superuser)]) -> dict[str, Any]:
    task = collect_pagespeed_scheduled.delay()
    return {
        "queued": True,
        "task_id": task.id,
        "message": "PSI 採集已排入背景工作，完成後重新整理即可查看結果。",
    }


@router.post("/collect/crux-daily")
async def collect_crux(
    session: DbDep, _admin: Annotated[User, Depends(require_superuser)]
) -> dict[str, Any]:
    result = await collect_crux_daily(session)
    await session.commit()
    return result


@router.post("/releases")
async def create_release(
    session: DbDep, _admin: Annotated[User, Depends(require_superuser)], commit_sha: str
) -> dict[str, Any]:
    release = await ensure_release(session, commit_sha)
    await session.commit()
    return {
        "release": release.release,
        "commit_sha": release.commit_sha,
        "deployed_at": release.deployed_at,
    }
