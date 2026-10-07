"""電子證件學生資格設定

Revision ID: 504e3ea112ea
Revises: 20261007010000
Create Date: 2026-10-07 09:18:41.634507

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "504e3ea112ea"
down_revision: str | Sequence[str] | None = "20261007010000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "electronic_credential_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "student_id_prefixes",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            server_default=sa.text('\'["310", "410", "510"]\''),
            nullable=False,
        ),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("id = 1", name="ck_electronic_credential_settings_singleton"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(
        sa.text(
            "INSERT INTO electronic_credential_settings (id, student_id_prefixes, updated_by) "
            'VALUES (1, \'["310", "410", "510"]\'::jsonb, NULL)'
        )
    )


def downgrade() -> None:
    op.drop_table("electronic_credential_settings")
