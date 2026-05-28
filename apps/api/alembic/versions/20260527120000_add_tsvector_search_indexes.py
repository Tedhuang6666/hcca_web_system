"""add_tsvector_search_indexes

Revision ID: 20260527120000
Revises: d71723bb5ccb
Create Date: 2026-05-27 12:00:00.000000

為 documents / regulations / announcements 內容欄位加上 PostgreSQL tsvector
generated column + GIN 索引，加速全文搜尋。中文使用 `simple` config
（不做詞幹化，適合 CJK 字元組成的搜尋）。

注意：
- 若資料庫不是 PostgreSQL（如 aiosqlite 測試環境），自動跳過。
- 後端搜尋查詢仍走 ILIKE 作為 fallback；如要切換到 ts_query，需 service 層
  自行偵測 dialect 並使用 @@ to_tsquery(...) 子句。
"""

from collections.abc import Sequence

from alembic import op
from sqlalchemy.engine import Connection

revision: str = "20260527120000"
down_revision: str | Sequence[str] | None = "d71723bb5ccb"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _is_postgres(conn: Connection) -> bool:
    return conn.dialect.name == "postgresql"


def upgrade() -> None:
    """新增 search_vector generated column + GIN index"""
    conn = op.get_bind()
    if not _is_postgres(conn):
        # SQLite/其他 dialect：跳過，搜尋繼續用 ILIKE
        return

    # documents: title + content
    op.execute(
        """
        ALTER TABLE documents
        ADD COLUMN IF NOT EXISTS search_vector tsvector
        GENERATED ALWAYS AS (
          to_tsvector('simple',
            coalesce(title, '') || ' ' || coalesce(content, '')
          )
        ) STORED
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_documents_search_vector "
        "ON documents USING GIN (search_vector)"
    )

    # regulations: title + preface + content
    op.execute(
        """
        ALTER TABLE regulations
        ADD COLUMN IF NOT EXISTS search_vector tsvector
        GENERATED ALWAYS AS (
          to_tsvector('simple',
            coalesce(title, '') || ' ' ||
            coalesce(preface, '') || ' ' ||
            coalesce(content, '')
          )
        ) STORED
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_regulations_search_vector "
        "ON regulations USING GIN (search_vector)"
    )

    # announcements: title + content_text（content 為 JSONB，取 text 欄位）
    op.execute(
        """
        ALTER TABLE announcements
        ADD COLUMN IF NOT EXISTS search_vector tsvector
        GENERATED ALWAYS AS (
          to_tsvector('simple',
            coalesce(title, '') || ' ' ||
            coalesce(content::text, '')
          )
        ) STORED
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_announcements_search_vector "
        "ON announcements USING GIN (search_vector)"
    )


def downgrade() -> None:
    """移除 search_vector 欄位與索引"""
    conn = op.get_bind()
    if not _is_postgres(conn):
        return

    op.execute("DROP INDEX IF EXISTS ix_announcements_search_vector")
    op.execute("ALTER TABLE announcements DROP COLUMN IF EXISTS search_vector")
    op.execute("DROP INDEX IF EXISTS ix_regulations_search_vector")
    op.execute("ALTER TABLE regulations DROP COLUMN IF EXISTS search_vector")
    op.execute("DROP INDEX IF EXISTS ix_documents_search_vector")
    op.execute("ALTER TABLE documents DROP COLUMN IF EXISTS search_vector")
