"""新增特約店家多張宣傳圖。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260728170000"
down_revision: str | Sequence[str] | None = "20260728160000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "partner_business_images",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("business_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=120), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["business_id"], ["partner_businesses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_partner_business_images_business_id",
        "partner_business_images",
        ["business_id"],
    )
    op.execute(
        sa.text(
            """
            INSERT INTO partner_business_images
                (id, business_id, storage_key, filename, content_type, sort_order, created_at, updated_at)
            SELECT gen_random_uuid(), id, flyer_storage_key,
                   COALESCE(flyer_filename, '店家宣傳圖'),
                   COALESCE(flyer_content_type, 'image/*'),
                   0, now(), now()
            FROM partner_businesses
            WHERE flyer_storage_key IS NOT NULL
            """
        )
    )


def downgrade() -> None:
    op.drop_index(
        "ix_partner_business_images_business_id",
        table_name="partner_business_images",
    )
    op.drop_table("partner_business_images")
