# ruff: noqa: E702
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.models.user import User
from api.services.observability import collect_crux_daily, collect_pagespeed, ensure_release
from api.services.observability import overview as get_overview

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
    return {
        "system_health": [
            {"name": "API", "healthy": True},
            {"name": "PostgreSQL", "healthy": db_ok},
            {"name": "Redis", "healthy": True},
            {"name": "Celery", "healthy": True},
        ],
        "reliability": {
            "error_rate": None,
            "affected_users": None,
            "new_issues": 0,
            "regressions": 0,
        },
        "synthetic": {
            "mobile_performance": None,
            "desktop_performance": None,
            "mobile_lcp_ms": None,
            "mobile_tbt_ms": None,
        },
        "field": {"lcp_p75": None, "inp_p75": None, "cls_p75": None, "ttfb_p75": None},
        **(await get_overview(session)),
    }


@router.get("/errors")
async def errors(
    session: DbDep, _admin: Annotated[User, Depends(require_superuser)]
) -> dict[str, Any]:
    return {
        "new_issues": 0,
        "regressions": 0,
        "affected_users": None,
        "error_rate": None,
        "top_exceptions": [],
        "slow_transactions": [],
        "source": "sentry",
    }


@router.get("/real-users")
async def real_users(_admin: Annotated[User, Depends(require_superuser)]) -> dict[str, Any]:
    return {
        "dau": None,
        "sessions": None,
        "pageviews": None,
        "top_routes": [],
        "web_vitals": {"lcp_p75": None, "inp_p75": None, "cls_p75": None},
        "funnel": [],
        "client_errors": None,
        "source": "posthog",
    }


@router.post("/collect/psi")
async def collect_psi(
    session: DbDep, _admin: Annotated[User, Depends(require_superuser)]
) -> dict[str, Any]:
    result = await collect_pagespeed(session)
    await session.commit()
    return result


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
