"""Alembic 環境設定 - SQLAlchemy 2.0 Autogenerate 支援"""

from logging.config import fileConfig

from sqlalchemy import create_engine, pool

from alembic import context

# --- 載入應用程式設定與所有 ORM 模型（Autogenerate 必需）---
import api.models.org  # noqa: F401
import api.models.user  # noqa: F401
import api.models.document  # noqa: F401
from api.core.config import settings
from api.core.database import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# 從 Settings 覆蓋 sqlalchemy.url（使用同步驅動 psycopg2）
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL_SYNC)


def run_migrations_offline() -> None:
    """離線模式：輸出純 SQL，不需要 DB 連線（適合 CI 產生 SQL 稿）"""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """線上模式：連接 DB 執行 Migration（使用同步 psycopg2 驅動）"""
    connectable = create_engine(
        settings.DATABASE_URL_SYNC,
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
