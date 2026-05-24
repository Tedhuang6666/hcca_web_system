"""校園自治整合平台 API - FastAPI Application"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from api.core.audit import SecurityAuditMiddleware
from api.core.config import settings
from api.core.csrf import CSRFMiddleware
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
from api.routers.documents import serial_router, template_router


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

    @app.get("/health", tags=["系統"], summary="健康檢查")
    async def health_check() -> dict[str, str]:
        return {"status": "ok", "version": settings.APP_VERSION}

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
