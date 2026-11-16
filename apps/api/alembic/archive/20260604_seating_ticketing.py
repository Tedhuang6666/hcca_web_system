"""seating / ticketing system on top of shop products

Revision ID: 20260604seating
Revises: abe48bddbc4e
Create Date: 2026-06-04 17:00:00.000000

新增劃位系統：場次(座位圖) / 座位 / 分批開放時段 / 暫時保留鎖 / 劃位結果，
並於 products 加上 requires_seating / seating_mode 兩欄。
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260604seating"
down_revision: Union[str, Sequence[str], None] = "abe48bddbc4e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    seat_status = postgresql.ENUM(
        "available", "disabled", "blocked", name="seatstatus", create_type=False
    )
    assignment_status = postgresql.ENUM(
        "active", "released", name="seatassignmentstatus", create_type=False
    )
    seat_status.create(bind, checkfirst=True)
    assignment_status.create(bind, checkfirst=True)

    # ── products 擴充 ─────────────────────────────────────────────────────────
    op.add_column(
        "products",
        sa.Column(
            "requires_seating",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column("products", sa.Column("seating_mode", sa.String(length=20), nullable=True))

    # ── seating_zones（場次 / 座位圖）─────────────────────────────────────────
    op.create_table(
        "seating_zones",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("seating_opens_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hold_minutes", sa.Integer(), nullable=False, server_default="10"),
        sa.Column(
            "layout",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_seating_zones_product_id", "seating_zones", ["product_id"])
    op.create_index("ix_seating_zones_product_sort", "seating_zones", ["product_id", "sort_order"])

    # ── seats（單一座位）──────────────────────────────────────────────────────
    op.create_table(
        "seats",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("zone_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("label", sa.String(length=40), nullable=False),
        sa.Column("block", sa.String(length=80), nullable=True),
        sa.Column("row_label", sa.String(length=20), nullable=True),
        sa.Column("x", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("y", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("seat_type", sa.String(length=40), nullable=False, server_default="normal"),
        sa.Column("price_delta", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "status",
            postgresql.ENUM(name="seatstatus", create_type=False),
            nullable=False,
            server_default="available",
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["zone_id"], ["seating_zones.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("zone_id", "label", name="uq_seat_zone_label"),
    )
    op.create_index("ix_seats_zone_id", "seats", ["zone_id"])
    op.create_index("ix_seats_zone_status", "seats", ["zone_id", "status"])

    # ── seating_waves（分批開放時段）───────────────────────────────────────────
    op.create_table(
        "seating_waves",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("zone_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "audience",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["zone_id"], ["seating_zones.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_seating_waves_zone_id", "seating_waves", ["zone_id"])
    op.create_index("ix_seating_waves_zone_sort", "seating_waves", ["zone_id", "sort_order"])

    # ── seat_holds（暫時保留鎖）────────────────────────────────────────────────
    op.create_table(
        "seat_holds",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("seat_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("zone_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["seat_id"], ["seats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["zone_id"], ["seating_zones.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("seat_id", name="uq_seat_hold_seat"),
    )
    op.create_index("ix_seat_holds_zone_id", "seat_holds", ["zone_id"])
    op.create_index("ix_seat_holds_user_id", "seat_holds", ["user_id"])
    op.create_index("ix_seat_holds_expires", "seat_holds", ["expires_at"])

    # ── seat_assignments（劃位結果）────────────────────────────────────────────
    op.create_table(
        "seat_assignments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("seat_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("zone_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("order_item_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("assigned_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "status",
            postgresql.ENUM(name="seatassignmentstatus", create_type=False),
            nullable=False,
            server_default="active",
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["seat_id"], ["seats.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["zone_id"], ["seating_zones.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["order_item_id"], ["order_items.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["assigned_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_seat_assignments_zone_id", "seat_assignments", ["zone_id"])
    op.create_index("ix_seat_assignments_order_item_id", "seat_assignments", ["order_item_id"])
    op.create_index("ix_seat_assignments_user_id", "seat_assignments", ["user_id"])
    op.create_index("ix_seat_assignments_order", "seat_assignments", ["order_id"])
    op.create_index("ix_seat_assignments_zone_status", "seat_assignments", ["zone_id", "status"])
    # 一個座位最多一筆 active 劃位
    op.create_index(
        "uq_seat_assignment_active_seat",
        "seat_assignments",
        ["seat_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )


def downgrade() -> None:
    op.drop_table("seat_assignments")
    op.drop_table("seat_holds")
    op.drop_table("seating_waves")
    op.drop_table("seats")
    op.drop_table("seating_zones")
    op.drop_column("products", "seating_mode")
    op.drop_column("products", "requires_seating")

    bind = op.get_bind()
    postgresql.ENUM(name="seatassignmentstatus").drop(bind, checkfirst=True)
    postgresql.ENUM(name="seatstatus").drop(bind, checkfirst=True)
