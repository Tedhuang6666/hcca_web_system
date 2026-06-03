"""SQLAlchemy 2.0 非同步資料庫設定"""

from collections.abc import AsyncGenerator

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


# --- ORM 基礎類別 ---
class Base(DeclarativeBase):
    """所有 ORM Model 的基礎類別"""

    pass


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
