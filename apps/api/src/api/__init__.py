"""校園自治整合平台 API - FastAPI Application"""

import logging
import time
import uuid
from asyncio import timeout
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from redis.exceptions import RedisError
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import Response

from api.core.audit import SecurityAuditMiddleware
from api.core.config import settings
from api.core.csrf import CSRFMiddleware
from api.core.database import engine
from api.core.rate_limit import SimpleRateLimitMiddleware
from api.core.security_headers import SecurityHeadersMiddleware
from api.routers import (
    admin,
    analytics,
    announcements,
    audit,
    auth,
    dashboard,
    documents,
    documents_approve,
    documents_attachments,
    email,
    line_webhook,
    meal,
    meetings,
    mfa,
    notifications,
    orgs,
    partner_map,
    petitions,
    positions,
    regulations,
    saved_filters,
    school_class,
    shop,
    survey,
    tasks,
    user_positions,
    users,
    ws,
)
from api.routers.documents_serial import serial_router, template_router

logger = logging.getLogger(__name__)


async def _check_database() -> tuple[bool, str | None]:
    try:
        async with timeout(settings.HEALTHCHECK_TIMEOUT_SECONDS):
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
    except Exception as exc:
        logger.warning("Database readiness check failed", exc_info=True)
        return False, exc.__class__.__name__
    return True, None


async def _check_redis() -> tuple[bool, str | None]:
    from api.core.security import redis_client

    try:
        async with timeout(settings.HEALTHCHECK_TIMEOUT_SECONDS):
            await redis_client.ping()
    except (RedisError, TimeoutError) as exc:
        logger.warning("Redis readiness check failed", exc_info=True)
        return False, exc.__class__.__name__
    except Exception as exc:
        logger.warning("Unexpected Redis readiness check failure", exc_info=True)
        return False, exc.__class__.__name__
    return True, None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """應用程式啟動/關閉生命週期管理"""
    yield
    from api.core.security import redis_client

    await redis_client.aclose()


def create_app() -> FastAPI:
    """應用程式工廠函式"""
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        description="校園自治整合平台 RESTful API",
        docs_url="/docs" if (settings.DEBUG or settings.ENABLE_API_DOCS) else None,
        redoc_url="/redoc" if (settings.DEBUG or settings.ENABLE_API_DOCS) else None,
        lifespan=lifespan,
    )

    app.add_middleware(
        SecurityHeadersMiddleware,
        enabled=settings.SECURITY_HEADERS_ENABLED,
        hsts_enabled=settings.COOKIE_SECURE,
        hsts_max_age=settings.SECURITY_HSTS_MAX_AGE_SECONDS,
        content_security_policy=settings.SECURITY_CSP,
    )
    app.add_middleware(SecurityAuditMiddleware)
    app.add_middleware(
        SimpleRateLimitMiddleware,
        enabled=settings.RATE_LIMIT_ENABLED,
        requests=settings.RATE_LIMIT_REQUESTS,
        window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
    )
    app.add_middleware(CSRFMiddleware, enabled=True, secure=settings.COOKIE_SECURE)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-CSRF-Token"],
    )
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.SECRET_KEY,
        session_cookie=settings.SESSION_COOKIE_NAME,
        same_site=settings.COOKIE_SAMESITE,
        https_only=settings.COOKIE_SECURE,
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.ALLOWED_HOSTS)

    app.include_router(auth.router)
    app.include_router(mfa.router)
    app.include_router(users.router)
    app.include_router(audit.router)
    app.include_router(announcements.router)
    app.include_router(admin.router)
    app.include_router(orgs.router)
    app.include_router(partner_map.router)
    app.include_router(petitions.router)
    app.include_router(positions.router)
    app.include_router(user_positions.router)
    app.include_router(documents.router)
    app.include_router(documents_approve.router)
    app.include_router(documents_attachments.router)
    app.include_router(template_router)
    app.include_router(serial_router)
    app.include_router(regulations.router)
    app.include_router(saved_filters.router)
    app.include_router(shop.router)
    app.include_router(school_class.router)
    app.include_router(meal.router)
    app.include_router(meetings.router)
    app.include_router(meetings.public_router)
    app.include_router(survey.router)
    app.include_router(notifications.router)
    app.include_router(email.router)
    app.include_router(analytics.router)
    app.include_router(dashboard.router)
    app.include_router(tasks.router)
    app.include_router(line_webhook.router)
    app.include_router(ws.router)

    # 使用者上傳檔案（公告媒體、問卷圖片等）的靜態存取；
    # 生產環境通常由反向代理直接服務，此處確保開發環境也可正常顯示。
    app.mount("/uploads", StaticFiles(directory="uploads", check_dir=False), name="uploads")

    @app.middleware("http")
    async def _request_timing_middleware(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - start) * 1000
        response.headers["X-Process-Time-Ms"] = f"{duration_ms:.1f}"
        if duration_ms > settings.SLOW_REQUEST_THRESHOLD_MS:
            logger.warning(
                "Slow request path=%s method=%s status=%s duration_ms=%.1f",
                request.url.path,
                request.method,
                response.status_code,
                duration_ms,
            )
        return response

    @app.exception_handler(StarletteHTTPException)
    async def _http_exception_handler(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        # 4xx 維持原樣（含 detail 訊息），5xx 統一遮蔽具體訊息
        if exc.status_code >= 500:
            err_id = uuid.uuid4().hex[:12]
            logger.error(
                "5xx HTTPException id=%s path=%s detail=%s",
                err_id,
                request.url.path,
                exc.detail,
                exc_info=True,
            )
            return JSONResponse(
                {"detail": "伺服器內部錯誤", "error_id": err_id},
                status_code=exc.status_code,
                headers=getattr(exc, "headers", None) or {},
            )
        return JSONResponse(
            {"detail": exc.detail},
            status_code=exc.status_code,
            headers=getattr(exc, "headers", None) or {},
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            {"detail": "請求格式驗證失敗", "errors": exc.errors()},
            status_code=422,
        )

    @app.exception_handler(Exception)
    async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        err_id = uuid.uuid4().hex[:12]
        logger.error(
            "Unhandled exception id=%s path=%s method=%s",
            err_id,
            request.url.path,
            request.method,
            exc_info=True,
        )
        return JSONResponse(
            {"detail": "伺服器內部錯誤", "error_id": err_id},
            status_code=500,
        )

    @app.get("/health", tags=["系統"], summary="健康檢查")
    async def health_check() -> dict[str, str]:
        return {"status": "ok", "version": settings.APP_VERSION}

    @app.get("/live", tags=["系統"], summary="存活檢查")
    async def liveness_check() -> dict[str, str]:
        return {"status": "ok", "version": settings.APP_VERSION}

    @app.get("/ready", tags=["系統"], summary="就緒檢查")
    async def readiness_check() -> JSONResponse:
        db_ok, db_error = await _check_database()
        redis_ok, redis_error = await _check_redis()
        checks = {
            "database": {"ok": db_ok, "error": db_error},
            "redis": {"ok": redis_ok, "error": redis_error},
        }
        status_code = 200 if db_ok and redis_ok else 503
        status = "ok" if status_code == 200 else "degraded"
        return JSONResponse(
            {"status": status, "version": settings.APP_VERSION, "checks": checks},
            status_code=status_code,
        )

    @app.get("/", tags=["系統"], summary="服務資訊")
    async def root_info() -> dict[str, str | bool | None]:
        return {
            "name": settings.APP_NAME,
            "version": settings.APP_VERSION,
            "status": "ok",
            "docs_url": app.docs_url,
            "debug": settings.DEBUG,
        }

    return app


app = create_app()


def main() -> None:
    import uvicorn

    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
