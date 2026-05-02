"""校園自治整合平台 API - FastAPI Application"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from api.core.config import settings
from api.routers import (
    auth,
    documents,
    line_webhook,
    notifications,
    orgs,
    positions,
    regulations,
    shop,
    user_positions,
    users,
    ws,
)
from api.routers.documents import serial_router


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
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(SessionMiddleware, secret_key=settings.SECRET_KEY)

    app.include_router(auth.router)
    app.include_router(users.router)
    app.include_router(orgs.router)
    app.include_router(positions.router)
    app.include_router(user_positions.router)
    app.include_router(documents.router)
    app.include_router(serial_router)
    app.include_router(regulations.router)
    app.include_router(shop.router)
    app.include_router(notifications.router)
    app.include_router(line_webhook.router)
    app.include_router(ws.router)

    @app.get("/health", tags=["系統"], summary="健康檢查")
    async def health_check() -> dict[str, str]:
        return {"status": "ok", "version": settings.APP_VERSION}

    return app


app = create_app()


def main() -> None:
    import uvicorn

    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
