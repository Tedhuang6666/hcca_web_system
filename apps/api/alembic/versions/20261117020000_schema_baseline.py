"""學餐清理後的靜態 schema 與 migration 種子資料基線。

舊資料庫沿封存 revision 鏈升級；空庫使用 -x baseline=true 跳過歷史重播。
SQL 快照不依賴目前 ORM，避免未來 model 變更改寫既有 revision 的行為。
"""

import gzip
import hashlib
from pathlib import Path

from alembic import context, op

revision = "20261117020000"
down_revision = "20261117010000"
branch_labels = None
depends_on = None

_SHA256 = "513dbe51b7dcc4d5284aed38dc0e4ab42a61e695414b363a706c8f57f12610f7"


def upgrade() -> None:
    offline_bootstrap = context.is_offline_mode() and (config_bootstrap_requested())
    if not offline_bootstrap and not context.config.attributes.pop("install_baseline", False):
        return  # 既有資料庫已經沿歷史鏈建妥相同結構，僅記錄新的基線邊界。
    path = Path(__file__).parents[1] / "baseline" / "20261117020000.sql.gz"
    raw = gzip.decompress(path.read_bytes())
    if hashlib.sha256(raw).hexdigest() != _SHA256:
        raise RuntimeError("基線快照 checksum 不符")
    bind = op.get_bind()
    schema = (
        "public"
        if offline_bootstrap
        else bind.exec_driver_sql("SELECT current_schema()").scalar_one()
    )
    quoted_schema = bind.dialect.identifier_preparer.quote_schema(schema)
    sql = raw.decode().replace('"__HCCA_SCHEMA__"', quoted_schema)
    if not offline_bootstrap and bind.dialect.driver == "asyncpg":
        # asyncpg 的 prepared statement 限一條指令；原生 execute 支援整份靜態 SQL。
        bind.connection.dbapi_connection.run_async(lambda connection: connection.execute(sql))
        return
    # escape SQLAlchemy TextClause bind markers embedded in PostgreSQL casts / seed literals.
    op.execute(sql.replace(":", r"\:"))


def config_bootstrap_requested() -> bool:
    return bool(context.config.attributes.get("bootstrap_baseline")) or (
        context.get_x_argument(as_dictionary=True).get("baseline") == "true"
    )


def downgrade() -> None:
    raise RuntimeError("不可跨越靜態基線降版；請還原備份，後續 revisions 仍各自提供 downgrade。")
