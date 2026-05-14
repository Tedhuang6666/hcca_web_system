"""Pytest Fixtures - 非同步測試資料庫與 HTTP 客戶端"""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api import app
from api.core.database import Base, get_db

# 優先使用 PostgreSQL test DB，支援 TSVECTOR 等 PG-specific 特性
# 若無法連線，退回到 aiosqlite in-memory
TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "sqlite+aiosqlite:///:memory:"
)


class CSRFAwareAsyncClient(AsyncClient):
    """測試用 AsyncClient，自動處理 CSRF token"""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._csrf_token: str | None = None

    async def request(
        self,
        method: str,
        url: str | bytes,
        *,
        content: bytes | str | None = None,
        data: dict[str, Any] | None = None,
        files: dict[str, Any] | None = None,
        json: Any = None,
        cookies: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
        **kwargs: Any,
    ) -> Response:
        # 為 unsafe methods 自動添加 CSRF token header
        if method.upper() in ("POST", "PATCH", "PUT", "DELETE"):
            if headers is None:
                headers = {}
            # 從 cookies 取得或自動生成 CSRF token
            csrf_token = self.cookies.get("csrf_token") or self._csrf_token
            if csrf_token:
                headers["X-CSRF-Token"] = csrf_token

        response = await super().request(
            method,
            url,
            content=content,
            data=data,
            files=files,
            json=json,
            cookies=cookies,
            headers=headers,
            **kwargs,
        )

        # 從回應中提取 CSRF token cookie
        if "csrf_token" in response.cookies:
            self._csrf_token = response.cookies.get("csrf_token")

        return response


@pytest_asyncio.fixture(scope="function")
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """每個測試函式建立全新的資料庫（PostgreSQL）或 in-memory（SQLite）"""
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as session:
        yield session

    # 清理測試資料（PostgreSQL 用 CASCADE，SQLite 用 DROP ALL）
    async with engine.begin() as conn:
        if "postgresql" in TEST_DATABASE_URL:
            # PostgreSQL：用 CASCADE 忽略外鍵約束
            for table in reversed(Base.metadata.sorted_tables):
                await conn.execute(text(f"DROP TABLE IF EXISTS {table.name} CASCADE"))
        else:
            await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession) -> AsyncGenerator[CSRFAwareAsyncClient, None]:
    """帶 DB override 的 TestClient（自動處理 CSRF token）"""
    import secrets

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    async with CSRFAwareAsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        # 為測試生成 CSRF token，手動設定到 cookies
        csrf_token = secrets.token_urlsafe(32)
        ac.cookies.set("csrf_token", csrf_token)
        ac._csrf_token = csrf_token
        yield ac

    app.dependency_overrides.clear()
