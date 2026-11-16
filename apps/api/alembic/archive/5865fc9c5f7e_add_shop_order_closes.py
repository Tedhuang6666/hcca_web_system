"""add_shop_order_closes

Revision ID: 5865fc9c5f7e
Revises: 5694b02b3aeb
Create Date: 2026-07-04 15:49:00.198251

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "5865fc9c5f7e"
down_revision = "5694b02b3aeb"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "shop_order_closes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("category_id", sa.UUID(), nullable=False),
        sa.Column("class_id", sa.UUID(), nullable=True),
        sa.Column("closed_by_id", sa.UUID(), nullable=False),
        sa.Column("reopened_by_id", sa.UUID(), nullable=True),
        sa.Column("reopened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
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
        sa.ForeignKeyConstraint(["category_id"], ["product_categories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["class_id"], ["school_classes.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["closed_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["reopened_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_shop_order_closes_category_id"), "shop_order_closes", ["category_id"], unique=False
    )
    op.create_index(
        op.f("ix_shop_order_closes_class_id"), "shop_order_closes", ["class_id"], unique=False
    )
    op.create_index(
        op.f("ix_shop_order_closes_is_active"), "shop_order_closes", ["is_active"], unique=False
    )
    op.drop_index(op.f("ix_audit_logs_actor_email_created_at"), table_name="audit_logs")
    op.drop_index(op.f("ix_document_revisions_changed_by"), table_name="document_revisions")
    op.drop_index(op.f("ix_email_messages_created_at_status"), table_name="email_messages")
    op.drop_index(
        op.f("ix_inventory_procurement_items_item_id"), table_name="inventory_procurement_items"
    )
    op.drop_index(op.f("ix_inventory_transactions_created_at"), table_name="inventory_transactions")
    op.drop_index(op.f("ix_meeting_agenda_items_regulation_id"), table_name="meeting_agenda_items")
    op.drop_index(op.f("ix_meetings_created_by"), table_name="meetings")
    op.drop_index(
        op.f("ix_person_affiliations_person_kind_status"), table_name="person_affiliations"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.create_index(
        op.f("ix_person_affiliations_person_kind_status"),
        "person_affiliations",
        ["person_id", "kind", "status"],
        unique=False,
    )
    op.create_index(op.f("ix_meetings_created_by"), "meetings", ["created_by"], unique=False)
    op.create_index(
        op.f("ix_meeting_agenda_items_regulation_id"),
        "meeting_agenda_items",
        ["regulation_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_inventory_transactions_created_at"),
        "inventory_transactions",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_inventory_procurement_items_item_id"),
        "inventory_procurement_items",
        ["item_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_email_messages_created_at_status"),
        "email_messages",
        ["created_at", "status"],
        unique=False,
    )
    op.create_index(
        op.f("ix_document_revisions_changed_by"),
        "document_revisions",
        ["changed_by"],
        unique=False,
    )
    op.create_index(
        op.f("ix_audit_logs_actor_email_created_at"),
        "audit_logs",
        ["actor_email", "created_at"],
        unique=False,
    )
    op.drop_index(op.f("ix_shop_order_closes_is_active"), table_name="shop_order_closes")
    op.drop_index(op.f("ix_shop_order_closes_class_id"), table_name="shop_order_closes")
    op.drop_index(op.f("ix_shop_order_closes_category_id"), table_name="shop_order_closes")
    op.drop_table("shop_order_closes")
