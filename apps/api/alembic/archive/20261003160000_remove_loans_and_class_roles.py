"""Remove loans and four retired class roles.

This intentionally deletes loan inventory/records, loan permission grants, and
appointments for lunch manager, treasurer, discipline, and general affairs.
The deleted records cannot be recovered by downgrading this migration.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261003160000"
down_revision: str | Sequence[str] | None = "20261003150000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_REMOVED_CLASS_ROLE_KEYS = ("lunch_manager", "treasurer", "discipline", "general_affairs")


def _remove_loan_defaults() -> None:
    dialect = op.get_bind().dialect.name
    if dialect == "postgresql":
        op.execute(
            sa.text(
                """
                UPDATE orgs
                SET default_permission_codes = COALESCE(
                    (
                        SELECT jsonb_agg(entry.code)
                        FROM jsonb_array_elements_text(orgs.default_permission_codes) AS entry(code)
                        WHERE entry.code NOT IN (
                            'loan:manage', 'loan:checkout', 'loan:view_all'
                        )
                    ),
                    '[]'::jsonb
                )
                WHERE default_permission_codes ?| ARRAY[
                    'loan:manage', 'loan:checkout', 'loan:view_all'
                ]
                """
            )
        )
    elif dialect == "sqlite":
        op.execute(
            sa.text(
                """
                UPDATE orgs
                SET default_permission_codes = COALESCE(
                    (
                        SELECT json_group_array(entry.value)
                        FROM json_each(orgs.default_permission_codes) AS entry
                        WHERE entry.value NOT IN (
                            'loan:manage', 'loan:checkout', 'loan:view_all'
                        )
                    ),
                    '[]'
                )
                WHERE EXISTS (
                    SELECT 1
                    FROM json_each(orgs.default_permission_codes) AS entry
                    WHERE entry.value IN (
                        'loan:manage', 'loan:checkout', 'loan:view_all'
                    )
                )
                """
            )
        )
    else:
        raise NotImplementedError(f"Unsupported database dialect for permission cleanup: {dialect}")


def upgrade() -> None:
    _remove_loan_defaults()
    op.execute(
        sa.text(
            "DELETE FROM permissions "
            "WHERE code IN ('loan:manage', 'loan:checkout', 'loan:view_all')"
        )
    )

    role_keys = sa.table(
        "class_role_bindings",
        sa.column("role_key", sa.String()),
        sa.column("position_id", postgresql.UUID(as_uuid=True)),
    )
    affiliations = sa.table(
        "person_affiliations",
        sa.column("kind", sa.String()),
        sa.column("role_key", sa.String()),
        sa.column("synced_user_position_id", postgresql.UUID(as_uuid=True)),
    )
    user_positions = sa.table(
        "user_positions",
        sa.column("id", postgresql.UUID(as_uuid=True)),
    )
    positions = sa.table("positions", sa.column("id", postgresql.UUID(as_uuid=True)))
    connection = op.get_bind()

    retired_user_position_ids = set(
        connection.execute(
            sa.select(affiliations.c.synced_user_position_id).where(
                affiliations.c.kind == "class_role",
                affiliations.c.role_key.in_(_REMOVED_CLASS_ROLE_KEYS),
                affiliations.c.synced_user_position_id.is_not(None),
            )
        ).scalars()
    )
    candidate_position_ids = set(
        connection.execute(
            sa.select(role_keys.c.position_id).where(
                role_keys.c.role_key.in_(_REMOVED_CLASS_ROLE_KEYS)
            )
        ).scalars()
    )
    connection.execute(
        sa.delete(affiliations).where(
            affiliations.c.kind == "class_role",
            affiliations.c.role_key.in_(_REMOVED_CLASS_ROLE_KEYS),
        )
    )
    if retired_user_position_ids:
        connection.execute(
            sa.delete(user_positions).where(user_positions.c.id.in_(retired_user_position_ids))
        )
    connection.execute(
        sa.delete(role_keys).where(role_keys.c.role_key.in_(_REMOVED_CLASS_ROLE_KEYS))
    )

    if candidate_position_ids:
        remaining_position_ids = set(
            connection.execute(
                sa.select(role_keys.c.position_id).where(
                    role_keys.c.position_id.in_(candidate_position_ids)
                )
            ).scalars()
        )
        unshared_position_ids = candidate_position_ids - remaining_position_ids
        if unshared_position_ids:
            connection.execute(
                sa.delete(positions).where(positions.c.id.in_(unshared_position_ids))
            )

    op.execute(
        sa.text("UPDATE inventory_items SET item_type = 'equipment' WHERE item_type = 'loanable'")
    )
    op.drop_index("ix_inventory_items_loan_item_id", table_name="inventory_items")
    op.drop_column("inventory_items", "loan_item_id")

    op.drop_table("loan_records")
    op.drop_table("loan_units")
    op.drop_table("loan_item_categories")


def downgrade() -> None:
    # Downgrade restores the empty schema only. Deleted rows and role grants cannot be recovered.
    op.create_table(
        "loan_item_categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "org_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("orgs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("image_url", sa.String(500), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("default_due_days", sa.Integer(), nullable=False, server_default="7"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_loan_item_categories_org_id", "loan_item_categories", ["org_id"])
    op.create_index("ix_loan_item_categories_is_active", "loan_item_categories", ["is_active"])

    op.create_table(
        "loan_units",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("loan_item_categories.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("unit_code", sa.String(50), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="available"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("item_id", "unit_code", name="uq_loan_unit_code_per_item"),
    )
    op.create_index("ix_loan_units_item_id", "loan_units", ["item_id"])
    op.create_index("ix_loan_units_status", "loan_units", ["status"])

    op.create_table(
        "loan_records",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "unit_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("loan_units.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("borrower_name", sa.String(100), nullable=False),
        sa.Column("borrower_student_id", sa.String(20), nullable=True),
        sa.Column("borrower_email", sa.String(255), nullable=True),
        sa.Column("borrower_contact", sa.String(50), nullable=True),
        sa.Column("borrowed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("returned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("reminder_sent_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_reminder_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "handled_by_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "return_handled_by_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_loan_records_unit_id", "loan_records", ["unit_id"])
    op.create_index("ix_loan_records_status", "loan_records", ["status"])
    op.create_index("ix_loan_records_due_at", "loan_records", ["due_at"])
    op.create_index("ix_loan_records_handled_by_id", "loan_records", ["handled_by_id"])

    op.add_column(
        "inventory_items",
        sa.Column(
            "loan_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("loan_item_categories.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_inventory_items_loan_item_id", "inventory_items", ["loan_item_id"])
