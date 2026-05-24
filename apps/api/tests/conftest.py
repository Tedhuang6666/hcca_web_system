"""Pytest Fixtures - 非同步測試資料庫與 HTTP 客戶端"""

from __future__ import annotations

import os

# 測試用 HTTP client 以 base_url="http://test" 發送請求；
# 確保 TrustedHostMiddleware 不會在使用者本機 .env 限縮 ALLOWED_HOSTS 時
# 把所有測試 status 變 400 Invalid host header。必須在 `from api import app` 之前設定。
os.environ.setdefault(
    "ALLOWED_HOSTS",
    '["localhost","127.0.0.1","api","test","testserver"]',
)
# Load shedding 會根據 active_requests / 5xx_ratio / db_pool 動態擋 request。
# 在 pytest 連續執行多 test 時，前面 test 故意觸發的 5xx 會污染同進程的滑動視窗，
# 導致後面 test 全部 503。測試環境一律關閉。
os.environ.setdefault("LOAD_SHED_ENABLED", "false")
# 同理：測試不使用真實 Redis broker，避免事件迴圈跨 test 互鎖。
os.environ.setdefault("WS_PUBSUB_BACKEND", "memory")

from collections.abc import AsyncGenerator  # noqa: E402
from typing import Any  # noqa: E402

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient, Response  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from api import app  # noqa: E402
from api.core.database import Base, get_db  # noqa: E402


@pytest.fixture(autouse=True)
def _isolate_redis_client_per_test():
    """每個 test 前替換 redis_client 的 connection_pool。

    `redis_client` 是 module-level singleton，aioredis 的 connection 在首次 await
    時黏到當前 event loop；pytest-asyncio 每個 test 起新 loop，下個 test 重用同
    一個 pool 就會撞「Future attached to a different loop」。

    我們保持 redis_client 物件本身不變（其他模組已 import），只替換 pool。
    """
    import redis.asyncio as _aioredis

    from api.core import security as _security
    from api.core.config import settings as _settings

    fresh_pool = _aioredis.ConnectionPool.from_url(
        str(_settings.REDIS_URL),
        encoding="utf-8",
        decode_responses=True,
        max_connections=_settings.REDIS_MAX_CONNECTIONS,
    )
    old_pool = _security.redis_client.connection_pool
    _security.redis_client.connection_pool = fresh_pool
    try:
        yield
    finally:
        try:
            fresh_pool.disconnect(inuse_connections=True)
        except Exception:
            pass
        _security.redis_client.connection_pool = old_pool


# 優先使用 PostgreSQL test DB，支援 TSVECTOR 等 PG-specific 特性
# 若無法連線，退回到 aiosqlite in-memory
TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "sqlite+aiosqlite:///:memory:")


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

    async with CSRFAwareAsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # 為測試生成 CSRF token，手動設定到 cookies
        csrf_token = secrets.token_urlsafe(32)
        ac.cookies.set("csrf_token", csrf_token)
        ac._csrf_token = csrf_token
        yield ac

    app.dependency_overrides.clear()
