"""add_matter_slug

Revision ID: 65d22994f220
Revises: 20260704133000
Create Date: 2026-07-05 23:24:31.846539

"""
from typing import Sequence, Union

import re

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '65d22994f220'
down_revision: Union[str, Sequence[str], None] = '20260704133000'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _title_to_slug(title: str) -> str:
    slug = re.sub(r"[^\w一-鿿㐀-䶿぀-ヿ＀-￯]", "-", title)
    slug = re.sub(r"-{2,}", "-", slug).strip("-")
    return slug[:200] or "untitled"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('matters', sa.Column('slug', sa.String(length=300), nullable=True))

    # 回填現有 matters 的 slug
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, title FROM matters WHERE is_active = true ORDER BY created_at")).fetchall()
    used: set[str] = set()
    for row in rows:
        base = _title_to_slug(row.title)
        slug = base
        counter = 2
        while slug in used:
            slug = f"{base}-{counter}"
            counter += 1
        used.add(slug)
        conn.execute(sa.text("UPDATE matters SET slug = :slug WHERE id = :id"), {"slug": slug, "id": str(row.id)})

    op.create_index(op.f('ix_matters_slug'), 'matters', ['slug'], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_matters_slug'), table_name='matters')
    op.drop_column('matters', 'slug')
