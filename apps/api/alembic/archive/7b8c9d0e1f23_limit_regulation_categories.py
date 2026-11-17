"""limit regulation categories to charter ordinance procedure

Revision ID: 7b8c9d0e1f23
Revises: 32ad9a2850de
Create Date: 2026-05-14 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "7b8c9d0e1f23"
down_revision: str | None = "32ad9a2850de"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE regulations ALTER COLUMN category TYPE text USING category::text")
    op.execute(
        """
        UPDATE regulations
        SET category = CASE
            WHEN title ILIKE '%憲章%' OR title ILIKE '%章程%' THEN 'constitution'
            WHEN title ILIKE '%辦法%' THEN 'procedure'
            WHEN title ILIKE '%條例%' THEN 'ordinance'
            WHEN category = 'constitution' THEN 'constitution'
            WHEN category IN (
                'executive_order',
                'council_order',
                'judicial_order',
                'election_order'
            ) THEN 'procedure'
            ELSE 'ordinance'
        END
        """
    )
    op.execute("DROP TYPE regulationcategory")
    op.execute("CREATE TYPE regulationcategory AS ENUM ('constitution', 'ordinance', 'procedure')")
    op.execute(
        """
        ALTER TABLE regulations
        ALTER COLUMN category TYPE regulationcategory
        USING category::regulationcategory
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE regulations ALTER COLUMN category TYPE text USING category::text")
    op.execute(
        """
        UPDATE regulations
        SET category = CASE
            WHEN category = 'constitution' THEN 'constitution'
            WHEN category = 'procedure' THEN 'executive_order'
            ELSE 'student_council'
        END
        """
    )
    op.execute("DROP TYPE regulationcategory")
    op.execute(
        """
        CREATE TYPE regulationcategory AS ENUM (
            'ACADEMIC',
            'FINANCIAL',
            'DISCIPLINARY',
            'OPERATIONAL',
            'OTHER',
            'constitution',
            'chairman',
            'executive_dept',
            'student_council',
            'judicial_committee',
            'executive_order',
            'council_order',
            'judicial_order',
            'election_order',
            'other'
        )
        """
    )
    op.execute(
        """
        ALTER TABLE regulations
        ALTER COLUMN category TYPE regulationcategory
        USING category::regulationcategory
        """
    )
