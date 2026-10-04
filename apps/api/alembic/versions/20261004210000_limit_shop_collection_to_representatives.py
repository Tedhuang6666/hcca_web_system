"""Limit class shop collection to class representatives."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261004210000"
down_revision: str | Sequence[str] | None = "20261004190000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CLASS_SHOP_COLLECT = "class:shop_collect"
_NON_REPRESENTATIVE_ROLE_KEYS = ("class_leader", "vice_leader")


def _tables() -> tuple[sa.Table, sa.Table]:
    bindings = sa.table(
        "class_role_bindings",
        sa.column("position_id", sa.Uuid(as_uuid=True)),
        sa.column("role_key", sa.String(length=50)),
    )
    permissions = sa.table(
        "permissions",
        sa.column("id", sa.Uuid(as_uuid=True)),
        sa.column("position_id", sa.Uuid(as_uuid=True)),
        sa.column("code", sa.String(length=100)),
    )
    return bindings, permissions


def upgrade() -> None:
    bindings, permissions = _tables()
    position_ids = sa.select(bindings.c.position_id).where(
        bindings.c.role_key.in_(_NON_REPRESENTATIVE_ROLE_KEYS)
    )
    op.get_bind().execute(
        sa.delete(permissions).where(
            permissions.c.position_id.in_(position_ids),
            permissions.c.code == _CLASS_SHOP_COLLECT,
        )
    )


def downgrade() -> None:
    bindings, permissions = _tables()
    connection = op.get_bind()
    position_ids = list(
        connection.execute(
            sa.select(bindings.c.position_id).where(
                bindings.c.role_key.in_(_NON_REPRESENTATIVE_ROLE_KEYS)
            )
        ).scalars()
    )
    for position_id in position_ids:
        exists = connection.scalar(
            sa.select(permissions.c.id).where(
                permissions.c.position_id == position_id,
                permissions.c.code == _CLASS_SHOP_COLLECT,
            )
        )
        if exists is None:
            connection.execute(
                sa.insert(permissions).values(
                    id=uuid.uuid4(),
                    position_id=position_id,
                    code=_CLASS_SHOP_COLLECT,
                )
            )
