"""class meal platform integration

Revision ID: 20260523100000
Revises: 20260522120000
Create Date: 2026-05-23 10:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260523100000"
down_revision: str | Sequence[str] | None = "20260522120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "school_classes",
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("ix_school_classes_org_id", "school_classes", ["org_id"])
    op.create_foreign_key(
        "fk_school_classes_org_id_orgs",
        "school_classes",
        "orgs",
        ["org_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "class_memberships",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("class_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("academic_year", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["class_id"], ["school_classes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_class_memberships_class_id", "class_memberships", ["class_id"])
    op.create_index("ix_class_memberships_user_id", "class_memberships", ["user_id"])
    op.create_index(
        "ix_class_memberships_user_active", "class_memberships", ["user_id", "status"]
    )
    op.create_index(
        "ix_class_memberships_class_status", "class_memberships", ["class_id", "status"]
    )

    op.create_table(
        "class_role_bindings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("class_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role_key", sa.String(length=50), nullable=False),
        sa.Column("position_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["class_id"], ["school_classes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["position_id"], ["positions.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("class_id", "role_key", name="uq_class_role_binding"),
    )
    op.create_index("ix_class_role_bindings_class_id", "class_role_bindings", ["class_id"])
    op.create_index("ix_class_role_bindings_position_id", "class_role_bindings", ["position_id"])
    op.create_index("ix_class_role_bindings_role_key", "class_role_bindings", ["role_key"])

    op.add_column(
        "meal_vendors",
        sa.Column("status", sa.String(length=30), server_default="approved", nullable=False),
    )
    op.add_column("meal_vendors", sa.Column("review_note", sa.Text(), nullable=True))
    op.create_index("ix_meal_vendors_status", "meal_vendors", ["status"])

    op.create_table(
        "meal_vendor_applications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("contact_name", sa.String(length=100), nullable=True),
        sa.Column("contact_phone", sa.String(length=20), nullable=True),
        sa.Column("contact_email", sa.String(length=255), nullable=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=30), server_default="pending_review", nullable=False),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("reviewed_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["reviewed_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["vendor_id"], ["meal_vendors.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_meal_vendor_applications_name", "meal_vendor_applications", ["name"])
    op.create_index("ix_meal_vendor_applications_org_id", "meal_vendor_applications", ["org_id"])
    op.create_index("ix_meal_vendor_applications_status", "meal_vendor_applications", ["status"])

    op.create_table(
        "meal_vendor_managers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("position_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("user_position_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["vendor_id"], ["meal_vendors.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["position_id"], ["positions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_position_id"], ["user_positions.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("vendor_id", "user_id", name="uq_meal_vendor_manager"),
    )
    op.create_index("ix_meal_vendor_managers_vendor_id", "meal_vendor_managers", ["vendor_id"])
    op.create_index("ix_meal_vendor_managers_user_id", "meal_vendor_managers", ["user_id"])

    op.create_table(
        "meal_products",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(length=80), nullable=True),
        sa.Column("image_url", sa.String(length=500), nullable=True),
        sa.Column("price", sa.Integer(), nullable=False),
        sa.Column("default_max_quantity", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["vendor_id"], ["meal_vendors.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_meal_products_vendor_id", "meal_products", ["vendor_id"])
    op.create_index("ix_meal_products_category", "meal_products", ["category"])
    op.create_index("ix_meal_products_is_active", "meal_products", ["is_active"])

    op.create_table(
        "meal_product_availabilities",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column("sale_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sale_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("price", sa.Integer(), nullable=False),
        sa.Column("max_quantity", sa.Integer(), nullable=True),
        sa.Column("is_available", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["product_id"], ["meal_products.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["vendor_id"], ["meal_vendors.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_meal_product_availabilities_product_id", "meal_product_availabilities", ["product_id"])
    op.create_index("ix_meal_product_availabilities_vendor_id", "meal_product_availabilities", ["vendor_id"])
    op.create_index("ix_meal_product_availabilities_service_date", "meal_product_availabilities", ["service_date"])

    op.create_table(
        "meal_pickup_slots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("availability_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("label", sa.String(length=80), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("pickup_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("pickup_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("order_deadline", sa.DateTime(timezone=True), nullable=False),
        sa.Column("capacity", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["availability_id"], ["meal_product_availabilities.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_meal_pickup_slots_availability_id", "meal_pickup_slots", ["availability_id"])
    op.create_index("ix_meal_pickup_slots_is_active", "meal_pickup_slots", ["is_active"])

    op.alter_column("meal_orders", "schedule_id", existing_type=postgresql.UUID(as_uuid=True), nullable=True)
    op.add_column("meal_orders", sa.Column("availability_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("meal_orders", sa.Column("pickup_slot_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("meal_orders", sa.Column("class_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("meal_orders", sa.Column("is_paid", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("meal_orders", sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("meal_orders", sa.Column("paid_by_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("meal_orders", sa.Column("pickup_status", sa.String(length=30), server_default="not_picked", nullable=False))
    op.add_column("meal_orders", sa.Column("pickup_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("meal_orders", sa.Column("pickup_by_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_meal_orders_availability_id", "meal_orders", "meal_product_availabilities", ["availability_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key("fk_meal_orders_pickup_slot_id", "meal_orders", "meal_pickup_slots", ["pickup_slot_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key("fk_meal_orders_class_id", "meal_orders", "school_classes", ["class_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key("fk_meal_orders_paid_by_id", "meal_orders", "users", ["paid_by_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key("fk_meal_orders_pickup_by_id", "meal_orders", "users", ["pickup_by_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_meal_orders_availability_id", "meal_orders", ["availability_id"])
    op.create_index("ix_meal_orders_pickup_slot_id", "meal_orders", ["pickup_slot_id"])
    op.create_index("ix_meal_orders_class_id", "meal_orders", ["class_id"])
    op.create_index("ix_meal_orders_pickup_status", "meal_orders", ["pickup_status"])

    op.alter_column("meal_order_items", "menu_item_id", existing_type=postgresql.UUID(as_uuid=True), nullable=True)
    op.add_column("meal_order_items", sa.Column("availability_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("meal_order_items", sa.Column("product_name_snapshot", sa.String(length=200), nullable=True))
    op.create_foreign_key("fk_meal_order_items_availability_id", "meal_order_items", "meal_product_availabilities", ["availability_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_meal_order_items_availability_id", "meal_order_items", ["availability_id"])

    op.create_table(
        "meal_class_pickup_codes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("code", sa.String(length=12), nullable=False),
        sa.Column("class_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("vendor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("pickup_slot_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("issued_to_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("redeemed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("redeemed_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["class_id"], ["school_classes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["vendor_id"], ["meal_vendors.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["pickup_slot_id"], ["meal_pickup_slots.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["issued_to_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["redeemed_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("class_id", "vendor_id", "pickup_slot_id", name="uq_meal_class_pickup_scope"),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_meal_class_pickup_codes_code", "meal_class_pickup_codes", ["code"])


def downgrade() -> None:
    op.drop_table("meal_class_pickup_codes")
    op.drop_index("ix_meal_order_items_availability_id", table_name="meal_order_items")
    op.drop_constraint("fk_meal_order_items_availability_id", "meal_order_items", type_="foreignkey")
    op.drop_column("meal_order_items", "product_name_snapshot")
    op.drop_column("meal_order_items", "availability_id")
    op.alter_column("meal_order_items", "menu_item_id", existing_type=postgresql.UUID(as_uuid=True), nullable=False)

    for name in [
        "ix_meal_orders_pickup_status",
        "ix_meal_orders_class_id",
        "ix_meal_orders_pickup_slot_id",
        "ix_meal_orders_availability_id",
    ]:
        op.drop_index(name, table_name="meal_orders")
    for name in [
        "fk_meal_orders_pickup_by_id",
        "fk_meal_orders_paid_by_id",
        "fk_meal_orders_class_id",
        "fk_meal_orders_pickup_slot_id",
        "fk_meal_orders_availability_id",
    ]:
        op.drop_constraint(name, "meal_orders", type_="foreignkey")
    for col in [
        "pickup_by_id",
        "pickup_at",
        "pickup_status",
        "paid_by_id",
        "paid_at",
        "is_paid",
        "class_id",
        "pickup_slot_id",
        "availability_id",
    ]:
        op.drop_column("meal_orders", col)
    op.alter_column("meal_orders", "schedule_id", existing_type=postgresql.UUID(as_uuid=True), nullable=False)

    op.drop_table("meal_pickup_slots")
    op.drop_table("meal_product_availabilities")
    op.drop_table("meal_products")
    op.drop_table("meal_vendor_managers")
    op.drop_table("meal_vendor_applications")
    op.drop_index("ix_meal_vendors_status", table_name="meal_vendors")
    op.drop_column("meal_vendors", "review_note")
    op.drop_column("meal_vendors", "status")
    op.drop_table("class_role_bindings")
    op.drop_table("class_memberships")
    op.drop_constraint("fk_school_classes_org_id_orgs", "school_classes", type_="foreignkey")
    op.drop_index("ix_school_classes_org_id", table_name="school_classes")
    op.drop_column("school_classes", "org_id")
