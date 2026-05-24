"""SQLAlchemy 2.0 非同步資料庫設定"""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from api.core.config import settings  # noqa: E402

# --- 非同步 Engine ---
engine = create_async_engine(
    str(settings.DATABASE_URL),
    echo=settings.SQL_ECHO,
    pool_pre_ping=True,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_timeout=settings.DB_POOL_TIMEOUT_SECONDS,
    pool_recycle=settings.DB_POOL_RECYCLE_SECONDS,
)

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
