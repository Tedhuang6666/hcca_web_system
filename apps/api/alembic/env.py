"""Alembic 環境設定 - SQLAlchemy 2.0 Autogenerate 支援"""

from logging.config import fileConfig

from alembic import context
from alembic.script import ScriptDirectory
from sqlalchemy import Connection, create_engine, inspect, pool

import api.legacy_models  # noqa: F401

# --- 載入完整 ORM registry（Autogenerate 必需）---
import api.models  # noqa: F401
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
        starting_rev="20261117010000" if _use_baseline() else None,
    )
    with context.begin_transaction():
        if _use_baseline():
            # starting_rev 讓 Alembic 跳過封存鏈；離線新庫仍須建立版本表。
            migration_context = context.get_context()
            migration_context.execute(
                "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL, "
                "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
            )
            migration_context.execute(
                "INSERT INTO alembic_version (version_num) VALUES ('20261117010000')"
            )
        context.run_migrations()


def run_migrations_online() -> None:
    """線上模式：連接 DB 執行 Migration（使用同步 psycopg2 驅動）"""
    supplied_connection = config.attributes.get("connection")
    if supplied_connection is not None:
        _run_on_connection(supplied_connection)
        return
    connectable = create_engine(
        settings.DATABASE_URL_SYNC,
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        _run_on_connection(connection)
    connectable.dispose()


def _use_baseline() -> bool:
    return bool(config.attributes.get("bootstrap_baseline")) or (
        context.get_x_argument(as_dictionary=True).get("baseline") == "true"
    )


def _run_on_connection(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )
    with context.begin_transaction():
        migration_context = context.get_context()
        if _use_baseline() and not migration_context.get_current_heads():
            tables = set(inspect(connection).get_table_names()) - {"alembic_version"}
            if tables:
                raise RuntimeError("基線僅能建立空 schema；無 revision 的既有資料庫須先人工核對。")
            migration_context.stamp(ScriptDirectory.from_config(config), "20261117010000")
            config.attributes["install_baseline"] = True
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
