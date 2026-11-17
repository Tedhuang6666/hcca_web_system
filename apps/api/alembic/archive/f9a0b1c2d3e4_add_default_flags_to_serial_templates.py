"""add default flags to serial templates

Revision ID: f9a0b1c2d3e4
Revises: cb8827c824f2
Create Date: 2026-05-04 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f9a0b1c2d3e4"
down_revision: str | None = "cb8827c824f2"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "document_serial_templates",
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "document_serial_templates",
        sa.Column(
            "is_default_president_publish",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.create_index(
        "ix_document_serial_templates_is_default",
        "document_serial_templates",
        ["is_default"],
        unique=False,
    )
    op.create_index(
        "ix_document_serial_templates_is_default_president_publish",
        "document_serial_templates",
        ["is_default_president_publish"],
        unique=False,
    )
    op.alter_column("document_serial_templates", "is_default", server_default=None)
    op.alter_column(
        "document_serial_templates",
        "is_default_president_publish",
        server_default=None,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_document_serial_templates_is_default_president_publish",
        table_name="document_serial_templates",
    )
    op.drop_index("ix_document_serial_templates_is_default", table_name="document_serial_templates")
    op.drop_column("document_serial_templates", "is_default_president_publish")
    op.drop_column("document_serial_templates", "is_default")
