"""新增推薦商家分類與多媒體菜單。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "2b7e4c8d1f20"
down_revision: str | Sequence[str] | None = "2a8f1d7c9b10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "recommended_vendor_categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
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
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_recommended_vendor_categories_name"),
    )
    op.create_index(
        "ix_recommended_vendor_categories_name",
        "recommended_vendor_categories",
        ["name"],
    )
    op.create_index(
        "ix_recommended_vendor_categories_is_active",
        "recommended_vendor_categories",
        ["is_active"],
    )
    op.add_column(
        "recommended_vendors",
        sa.Column("category_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("ix_recommended_vendors_category_id", "recommended_vendors", ["category_id"])
    op.create_foreign_key(
        "fk_recommended_vendors_category_id",
        "recommended_vendors",
        "recommended_vendor_categories",
        ["category_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_table(
        "recommended_vendor_menus",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("storage_key", sa.Text(), nullable=True),
        sa.Column("filename", sa.String(length=255), nullable=True),
        sa.Column("content_type", sa.String(length=120), nullable=True),
        sa.Column("file_size", sa.Integer(), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
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
        sa.ForeignKeyConstraint(["vendor_id"], ["recommended_vendors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_recommended_vendor_menus_vendor_id", "recommended_vendor_menus", ["vendor_id"]
    )
    op.create_index(
        "ix_recommended_vendor_menus_is_active", "recommended_vendor_menus", ["is_active"]
    )


def downgrade() -> None:
    op.drop_index("ix_recommended_vendor_menus_is_active", table_name="recommended_vendor_menus")
    op.drop_index("ix_recommended_vendor_menus_vendor_id", table_name="recommended_vendor_menus")
    op.drop_table("recommended_vendor_menus")
    op.drop_constraint(
        "fk_recommended_vendors_category_id", "recommended_vendors", type_="foreignkey"
    )
    op.drop_index("ix_recommended_vendors_category_id", table_name="recommended_vendors")
    op.drop_column("recommended_vendors", "category_id")
    op.drop_index(
        "ix_recommended_vendor_categories_is_active", table_name="recommended_vendor_categories"
    )
    op.drop_index(
        "ix_recommended_vendor_categories_name", table_name="recommended_vendor_categories"
    )
    op.drop_table("recommended_vendor_categories")
