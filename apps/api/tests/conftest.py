"""Pytest Fixtures - 非同步測試資料庫與 HTTP 客戶端"""

from __future__ import annotations

import contextlib
import os
import uuid

# 測試用 HTTP client 以 base_url="http://test" 發送請求；
# 確保 TrustedHostMiddleware 不會在使用者本機 .env 限縮 ALLOWED_HOSTS 時
# 把所有測試 status 變 400 Invalid host header。必須在 `from api.main import app` 之前設定。
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

from collections.abc import AsyncGenerator, Callable  # noqa: E402
from typing import Any  # noqa: E402

import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient, Response  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool  # noqa: E402

from api.core.config import settings  # noqa: E402
from api.core.database import Base, get_db  # noqa: E402
from api.core.security import create_access_token  # noqa: E402
from api.main import app  # noqa: E402
from api.models.user import User  # noqa: E402


@pytest_asyncio.fixture(autouse=True)
async def _isolate_redis_client_per_test():
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
        with contextlib.suppress(Exception):
            await fresh_pool.disconnect(inuse_connections=True)
        _security.redis_client.connection_pool = old_pool


# 本機快速測試可使用 SQLite；CI 與整合測試必須明確提供 PostgreSQL，
# 避免 SQLite 未強制外鍵或型別差異掩蓋正式環境問題。
TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "sqlite+aiosqlite:///:memory:")
if os.getenv("REQUIRE_POSTGRES_TEST_DB", "").lower() == "true" and not TEST_DATABASE_URL.startswith(
    "postgresql+asyncpg://"
):
    raise RuntimeError(
        "REQUIRE_POSTGRES_TEST_DB=true requires TEST_DATABASE_URL=postgresql+asyncpg://"
    )

_IS_POSTGRES = "postgresql" in TEST_DATABASE_URL


def _worker_schema_name() -> str:
    """pytest-xdist 平行執行時，每個 worker 需要專屬 schema，避免互相 DROP/CREATE 撞名。"""
    worker_id = os.environ.get("PYTEST_XDIST_WORKER")
    return f"test_{worker_id}" if worker_id else "test_master"


_SCHEMA_NAME = _worker_schema_name()
# 跨 worker 序列化 schema 建立/砍除用的 advisory lock key（任意常數，只要不撞 app 自己用的即可）。
_SCHEMA_DDL_LOCK_KEY = 947210001
_SCHEMA_ENGINE_KWARGS: dict[str, Any] = {"echo": False, "poolclass": NullPool}
if _IS_POSTGRES:
    # NullPool：每次 connect() 都建全新連線，不同 test 各自的 event loop 不會共用到
    # 同一條底層 asyncpg 連線，因此可以放心讓 schema engine 跨越整個 session／多個
    # test function 的 event loop 存活，不會撞「Future attached to a different loop」。
    _SCHEMA_ENGINE_KWARGS["connect_args"] = {"server_settings": {"search_path": _SCHEMA_NAME}}

_schema_engine = create_async_engine(TEST_DATABASE_URL, **_SCHEMA_ENGINE_KWARGS)

# 這些 DB 物件只存在於 Alembic migration（不是 ORM model 的一部分），
# Base.metadata.create_all 建不出來。序號產生器（order/document/meal_serial_seq）
# 曾在 shop 測試踩過這個坑，故 schema 初始化時手動補建。
_RAW_DDL_UPGRADE = (
    "CREATE SEQUENCE IF NOT EXISTS order_serial_seq START 1",
    "CREATE SEQUENCE IF NOT EXISTS document_serial_seq START 1 INCREMENT 1",
    "CREATE SEQUENCE IF NOT EXISTS meal_serial_seq START 1 INCREMENT 1",
    """
    CREATE OR REPLACE FUNCTION regulations_search_vector_update()
    RETURNS trigger AS $$
    BEGIN
      NEW.search_vector := to_tsvector('simple',
        coalesce(NEW.title, '') || ' ' || coalesce(NEW.preface, '')
      );
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    """,
    # asyncpg 的 prepared statement 一次只能執行一條指令，DROP/CREATE TRIGGER 須分開送。
    "DROP TRIGGER IF EXISTS regulations_search_vector_trigger ON regulations",
    """
    CREATE TRIGGER regulations_search_vector_trigger
    BEFORE INSERT OR UPDATE ON regulations
    FOR EACH ROW EXECUTE FUNCTION regulations_search_vector_update();
    """,
)


@pytest_asyncio.fixture(scope="session", loop_scope="session", autouse=True)
async def _build_schema_once() -> AsyncGenerator[None, None]:
    """整個測試 session（每個 xdist worker 各一份）只建一次 schema。

    取代過去每個測試 create_all/DROP CASCADE 整套 300+ 張表；每個 worker 用專屬
    schema（test_master / test_gw0...）彼此不衝突，不需要額外的每 worker 獨立 DB。
    每個 worker 的 300+ 張表 create_all 都是一次性的重 DDL；xdist 下 16 個 worker
    幾乎同時起跑會讓 Postgres 共用鎖表爆掉（`out of shared memory` /
    max_locks_per_transaction），故用 pg_advisory_lock 把「建表／砍表」這段序列化，
    僅此階段排隊，測試本體仍然全平行跑。
    """
    if _IS_POSTGRES:
        lock_conn = await _schema_engine.connect()
        await lock_conn.execute(text("SELECT pg_advisory_lock(:k)"), {"k": _SCHEMA_DDL_LOCK_KEY})
        try:
            async with _schema_engine.begin() as conn:
                # DROP 在前：若前一次執行被中斷（crash／Ctrl+C）留下殘骸，這裡先清乾淨再重建。
                await conn.execute(text(f'DROP SCHEMA IF EXISTS "{_SCHEMA_NAME}" CASCADE'))
                await conn.execute(text(f'CREATE SCHEMA "{_SCHEMA_NAME}"'))

            async with _schema_engine.begin() as conn:
                # 剛建好的空 schema，免除 create_all 預設的 checkfirst 反查 pg_catalog。
                await conn.run_sync(
                    lambda sync_conn: Base.metadata.create_all(sync_conn, checkfirst=False)
                )
                for statement in _RAW_DDL_UPGRADE:
                    await conn.execute(text(statement))
        finally:
            await lock_conn.execute(
                text("SELECT pg_advisory_unlock(:k)"), {"k": _SCHEMA_DDL_LOCK_KEY}
            )
            await lock_conn.close()
    else:
        async with _schema_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    yield

    if _IS_POSTGRES:
        lock_conn = await _schema_engine.connect()
        await lock_conn.execute(text("SELECT pg_advisory_lock(:k)"), {"k": _SCHEMA_DDL_LOCK_KEY})
        try:
            async with _schema_engine.begin() as conn:
                await conn.execute(text(f'DROP SCHEMA IF EXISTS "{_SCHEMA_NAME}" CASCADE'))
        finally:
            await lock_conn.execute(
                text("SELECT pg_advisory_unlock(:k)"), {"k": _SCHEMA_DDL_LOCK_KEY}
            )
            await lock_conn.close()
    await _schema_engine.dispose()


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
async def db_session(_build_schema_once: None) -> AsyncGenerator[AsyncSession, None]:
    """每個測試在獨立連線＋外層交易內執行，結束一律 rollback（schema 只建一次，不逐測試重建）。

    app 內 router/service 會直接呼叫 session.commit()；join_transaction_mode=
    "create_savepoint" 讓這些 commit 落成 SAVEPOINT release 而非真的提交，外層
    交易在測試結束時 rollback，一次清掉整個測試的資料異動。
    """
    connection = await _schema_engine.connect()
    outer_transaction = await connection.begin()

    session_factory = async_sessionmaker(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )

    async with session_factory() as session:
        yield session

    await outer_transaction.rollback()
    await connection.close()


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


# ---------------------------------------------------------------------------
# 共用 fixture：使用者建立與已登入 client
# 目的：避免每個測試檔各自重寫 _make_user / _make_authed_client。
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def make_user(db_session: AsyncSession) -> Callable[..., Any]:
    """回傳可重複呼叫的使用者工廠：await make_user(is_superuser=True, mfa_enabled=True)"""

    async def _factory(**overrides: Any) -> User:
        defaults: dict[str, Any] = {
            "email": f"test-{uuid.uuid4().hex[:8]}@school.edu",
            "display_name": "測試使用者",
            "is_active": True,
            "is_verified": True,
        }
        defaults.update(overrides)
        user = User(**defaults)
        db_session.add(user)
        await db_session.flush()
        return user

    return _factory


@pytest_asyncio.fixture
async def admin_user(make_user: Callable[..., Any]) -> User:
    """具 MFA 的系統管理員帳號，供需要 require_admin_mfa 的端點測試使用。"""
    return await make_user(
        email="admin@school.edu",
        display_name="系統管理員",
        is_superuser=True,
        mfa_enabled=True,
    )


@pytest_asyncio.fixture
async def member_user(make_user: Callable[..., Any]) -> User:
    """一般使用者帳號（無特殊權限）。"""
    return await make_user(email="member@school.edu", display_name="一般使用者")


@pytest_asyncio.fixture
async def authed_client_factory(
    db_session: AsyncSession,
) -> AsyncGenerator[Callable[[User], CSRFAwareAsyncClient], None]:
    """回傳 make_authed_client(user) -> 已登入的測試 client，可為任意 user 建立。"""

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    clients: list[CSRFAwareAsyncClient] = []

    def _factory(user: User) -> CSRFAwareAsyncClient:
        app.dependency_overrides[get_db] = override_get_db
        token = create_access_token(str(user.id))
        ac = CSRFAwareAsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
            cookies={settings.ACCESS_TOKEN_COOKIE_NAME: token},
        )
        clients.append(ac)
        return ac

    yield _factory

    for ac in clients:
        await ac.aclose()
    app.dependency_overrides.clear()
