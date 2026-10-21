"""新增問卷年級填答限制。"""

import sqlalchemy as sa
from alembic import op

revision = "20261022100000"
down_revision = "20261021190000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("surveys", sa.Column("allowed_grades_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("surveys", "allowed_grades_json")
