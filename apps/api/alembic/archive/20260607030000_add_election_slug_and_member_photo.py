"""選舉新增 slug（可含中文的網址名稱）與候選成員照片欄位。

Revision ID: 20260607030000
Revises: 20260607010000
"""

import re
import unicodedata
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260607030000"
down_revision: str | Sequence[str] | None = "20260607010000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _slugify(text: str) -> str:
    """產生保留中文（CJK）的網址 slug；非字母數字與 CJK 的字元改為 '-'。"""
    text = unicodedata.normalize("NFKC", (text or "").strip())
    # 保留：英數、CJK 統一表意文字、注音、全形假名等常見中文字範圍
    kept = re.sub(
        r"[^0-9A-Za-z㐀-䶿一-鿿぀-ヿ０-ｚ]+",
        "-",
        text,
    )
    kept = kept.strip("-").lower()
    return kept[:200]


def upgrade() -> None:
    op.add_column(
        "election_candidate_members",
        sa.Column("photo_url", sa.String(length=500), nullable=True),
    )
    op.add_column("elections", sa.Column("slug", sa.String(length=220), nullable=True))

    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, title FROM elections ORDER BY created_at")).fetchall()
    used: set[str] = set()
    for row in rows:
        base = _slugify(row.title) or str(row.id)[:8]
        candidate = base
        suffix = 2
        while candidate in used:
            candidate = f"{base}-{suffix}"
            suffix += 1
        used.add(candidate)
        bind.execute(
            sa.text("UPDATE elections SET slug = :slug WHERE id = :id"),
            {"slug": candidate, "id": row.id},
        )

    op.create_index("ix_elections_slug", "elections", ["slug"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_elections_slug", table_name="elections")
    op.drop_column("elections", "slug")
    op.drop_column("election_candidate_members", "photo_url")
