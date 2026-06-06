"""SQLAlchemy 2.0 非同步資料庫設定"""

from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from api.core.config import settings  # noqa: E402

# --- 非同步 Engine ---
# 預設：app 端自管 QueuePool。
# DB_USE_PGBOUNCER=true（走 PgBouncer transaction pooling）時：
#   - 改用 NullPool — 連線池交給 PgBouncer，app 端不再持久連線。
#   - 關閉 asyncpg / SQLAlchemy 的 server-side prepared statement cache，
#     否則 transaction 模式下跨連線會報 "prepared statement does not exist"。
_engine_kwargs: dict = {"echo": settings.SQL_ECHO, "pool_pre_ping": True}
if settings.DB_USE_PGBOUNCER:
    _engine_kwargs["poolclass"] = NullPool
    _engine_kwargs["connect_args"] = {
        "statement_cache_size": 0,
        "prepared_statement_cache_size": 0,
    }
else:
    _engine_kwargs.update(
        pool_size=settings.DB_POOL_SIZE,
        max_overflow=settings.DB_MAX_OVERFLOW,
        pool_timeout=settings.DB_POOL_TIMEOUT_SECONDS,
        pool_recycle=settings.DB_POOL_RECYCLE_SECONDS,
    )

engine = create_async_engine(str(settings.DATABASE_URL), **_engine_kwargs)

# --- Session Factory ---
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


@asynccontextmanager
async def task_session() -> AsyncIterator[AsyncSession]:
    """Celery 同步 task 內 `asyncio.run()` 專用的 DB session。

    每次 `asyncio.run()` 都是新的 event loop。沿用模組層級的 `AsyncSessionLocal`
    （非 PgBouncer 時是持久 QueuePool）會讓 pooled asyncpg 連線綁在已關閉的舊 loop，
    再次使用時拋 `Event loop is closed` / `got Future attached to a different loop`
    （watchdog 已實際發生）。故這裡每次都建專屬 NullPool engine，結束即 dispose，
    語義與 `AsyncSessionLocal` 一致（expire_on_commit/autoflush/autocommit 皆 False）。

    新增需在 Celery worker 內跑 async DB 的 task 時，一律用本函式，勿直接用
    `AsyncSessionLocal`。
    """
    engine = create_async_engine(str(settings.DATABASE_URL), poolclass=NullPool)
    factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
        autocommit=False,
    )
    try:
        async with factory() as session:
            yield session
    finally:
        await engine.dispose()


# --- ORM 基礎類別 ---
class Base(DeclarativeBase):
    """所有 ORM Model 的基礎類別"""

    pass


async def advisory_xact_lock(session: AsyncSession, key: int) -> None:
    """在當前交易期間取得 PostgreSQL advisory lock，序列化臨界區。

    用途：流水號/字號配發等「讀最大值 → +1」操作，避免並發 create 撞同號
    （會觸發 unique constraint → 500）。鎖在交易結束（commit/rollback）時自動釋放。

    測試用 sqlite 無 advisory lock 且為單緒，直接略過。
    """
    if session.bind is not None and session.bind.dialect.name == "postgresql":
        await session.execute(select(func.pg_advisory_xact_lock(key)))


# --- FastAPI 依賴注入用 Session Generator ---
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """提供資料庫 Session 的依賴注入函式"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
