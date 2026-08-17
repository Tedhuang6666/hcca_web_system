"""唯讀的機器觀測端點，供部署探針與 AI 驗證正式環境狀態。"""

from __future__ import annotations

import asyncio
import hmac
import os
from datetime import UTC, datetime
from typing import Annotated, Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.core.config import settings
from api.core.database import get_db
from api.core.metrics import get_celery_stats, get_redis_stats
from api.core.permission_codes import PermissionCode
from api.core.security import create_access_token
from api.models.observability import PageSpeedAudit, PageSpeedRun
from api.models.user import User
from api.services.observability import (
    _has_pageview_observation,
    _has_rum_observation,
    client_route_analytics,
    discover_public_urls,
    ensure_release,
)
from api.services.observability import overview as get_overview
from api.services.permission import get_user_permission_codes

router = APIRouter(prefix="/internal/observability", tags=["Internal / Observability"])
DbDep = Annotated[AsyncSession, Depends(get_db)]
_TOKEN_ENV = "OBSERVABILITY_AGENT_TOKEN"
_TOKEN_HEADER = "X-Observability-Agent-Token"
_PERFORMANCE_TOKEN_HEADER = "X-Performance-Monitor-Token"


class AuthenticatedAuditIn(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    title: str = Field(default="", max_length=500)
    score: float | None = Field(default=None, ge=0, le=1)
    numeric_value: float | None = None
    display_value: str | None = Field(default=None, max_length=500)


class AuthenticatedRunIn(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    strategy: str = Field(pattern="^(mobile|desktop)$")
    performance_score: float | None = Field(default=None, ge=0, le=100)
    lcp_ms: float | None = Field(default=None, ge=0)
    tbt_ms: float | None = Field(default=None, ge=0)
    cls: float | None = Field(default=None, ge=0)
    status: str = Field(default="ok", pattern="^(ok|error)$")
    error_message: str | None = Field(default=None, max_length=1000)
    audits: list[AuthenticatedAuditIn] = Field(default_factory=list, max_length=64)


class AuthenticatedRunsIn(BaseModel):
    release: str = Field(default="", max_length=128)
    runs: list[AuthenticatedRunIn] = Field(min_length=1, max_length=200)


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


def require_performance_token(request: Request) -> None:
    """保護可發行短效測試 session 與寫入合成結果的 CI 通道。"""
    configured = settings.PERFORMANCE_MONITOR_TOKEN.strip()
    supplied = request.headers.get(_PERFORMANCE_TOKEN_HEADER, "").strip()
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
        "authenticated_coverage": overview["authenticated_coverage"],
        "pages": overview["pages"],
        "synthetic": overview["synthetic"],
        "field": overview["field"],
        "latest_release": overview["latest_release"],
        "recent_errors": _safe_errors(overview["recent_errors"]),
        "slow_queries": overview["slow_queries"],
        "real_users": real_users,
    }


@router.get("/auth-targets", dependencies=[Depends(require_performance_token)])
async def authenticated_targets() -> dict[str, Any]:
    """供 CI 掃描公開關鍵路由、已造訪受保護路由與設定中的核心頁面。"""
    base = str(settings.FRONTEND_BASE_URL).rstrip("/") + "/"
    public_urls = set(await discover_public_urls())
    rum = await client_route_analytics()
    targets: list[str] = []
    for path in settings.PERFORMANCE_AUTHENTICATED_URLS:
        candidate = httpx.URL(path if path.startswith("http") else f"{base}{path.lstrip('/')}")
        if candidate.host != httpx.URL(base).host or candidate.scheme not in {"http", "https"}:
            continue
        normalized = str(candidate).rstrip("/") or str(candidate)
        if normalized not in targets:
            targets.append(normalized)
    for route in rum.get("routes", []):
        if not _has_pageview_observation(route):
            continue
        path = str(route.get("path") or "/")
        candidate = str(httpx.URL(f"{base}{path.lstrip('/')}"))
        if candidate not in public_urls and candidate not in targets:
            targets.append(candidate)
    return {
        "urls": targets,
        "rum_routes": [
            route["path"] for route in rum.get("routes", []) if _has_rum_observation(route)
        ],
    }


@router.get("/public-targets", dependencies=[Depends(require_performance_token)])
async def public_targets() -> dict[str, Any]:
    """供 public Lighthouse workflow 掃描 sitemap 與第一方已發現的所有頁面。"""
    urls = await discover_public_urls()
    return {"urls": urls}


@router.post("/auth-session", dependencies=[Depends(require_performance_token)])
async def authenticated_session(session: DbDep) -> dict[str, Any]:
    """發出只含 access token 的短效 synthetic session，絕不發 refresh token。"""
    try:
        user_id = UUID(settings.PERFORMANCE_MONITOR_USER_ID)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE) from exc

    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
    permissions = await get_user_permission_codes(session, user.id, on_date=local_today())
    access_token = create_access_token(
        str(user.id),
        {
            "is_admin": user.is_superuser or PermissionCode.ADMIN_ALL in permissions,
            "permissions": sorted(permissions),
            "user": {
                "email": user.email,
                "display_name": user.display_name,
                "avatar_url": user.avatar_url,
                "student_id": user.student_id,
                "show_email": user.show_email,
                "is_active": user.is_active,
                "is_verified": user.is_verified,
                "is_superuser": user.is_superuser,
                "notification_preferences": user.notification_preferences or {},
                "ui_theme": user.ui_theme,
                "ui_locale": user.ui_locale,
            },
        },
        amr=["synthetic-performance"],
    )
    return {
        "access_token": access_token,
        "cookie_name": settings.ACCESS_TOKEN_COOKIE_NAME,
        "expires_in_seconds": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }


async def _record_performance_runs(
    payload: AuthenticatedRunsIn,
    session: AsyncSession,
    *,
    strategy_prefix: str,
) -> dict[str, Any]:
    """Persist CI Lighthouse results for one public or authenticated channel."""
    base = httpx.URL(str(settings.FRONTEND_BASE_URL))
    release = await ensure_release(session, payload.release or None)
    created = 0
    for item in payload.runs:
        target = httpx.URL(item.url)
        if target.scheme != base.scheme or target.host != base.host:
            raise HTTPException(status_code=400, detail="只能寫入本站頁面結果")
        if not item.url.startswith(str(base).rstrip("/")):
            raise HTTPException(status_code=400, detail="結果 URL 不符合正式站來源")
        run = PageSpeedRun(
            url=item.url,
            strategy=f"{strategy_prefix}{item.strategy}",
            release_id=release.id,
            status=item.status,
            error_message=item.error_message,
            performance_score=item.performance_score,
            lcp_ms=item.lcp_ms,
            tbt_ms=item.tbt_ms,
            cls=item.cls,
        )
        session.add(run)
        await session.flush()
        for audit in item.audits:
            session.add(
                PageSpeedAudit(
                    run_id=run.id,
                    audit_id=audit.id,
                    title=audit.title or audit.id,
                    score=audit.score,
                    numeric_value=audit.numeric_value,
                    display_value=audit.display_value,
                )
            )
        created += 1
    await session.flush()
    return {"created": created, "release": release.release}


@router.post("/authenticated-runs", dependencies=[Depends(require_performance_token)])
async def record_authenticated_runs(
    payload: AuthenticatedRunsIn,
    session: DbDep,
) -> dict[str, Any]:
    """接收 CI 產生的 authenticated Lighthouse 結果；只接受本站 URL。"""
    return await _record_performance_runs(payload, session, strategy_prefix="auth-")


@router.post("/public-runs", dependencies=[Depends(require_performance_token)])
async def record_public_runs(
    payload: AuthenticatedRunsIn,
    session: DbDep,
) -> dict[str, Any]:
    """接收 CI 產生的 public Lighthouse 結果；只接受本站 URL。"""
    return await _record_performance_runs(payload, session, strategy_prefix="public-")
