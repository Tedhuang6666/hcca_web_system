"""Add full-text search vector to regulations.

Revision ID: 20260514111243
Revises: 9a8b7c6d5e4f
Create Date: 2026-05-14 11:12:43.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '20260514111243'
down_revision = '9a8b7c6d5e4f'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add search_vector column
    op.add_column('regulations', sa.Column('search_vector', postgresql.TSVECTOR(), nullable=True))

    # 2. Create GIN index for full-text search
    op.create_index(
        'ix_regulations_search_vector',
        'regulations',
        [sa.text('search_vector')],
        postgresql_using='gin',
    )

    # 3. Initialize existing data
    op.execute("""
        UPDATE regulations
        SET search_vector = to_tsvector('simple',
            coalesce(title, '') || ' ' || coalesce(preface, '')
        )
    """)

    # 4. Create trigger to automatically update search_vector
    op.execute("""
        CREATE OR REPLACE FUNCTION regulations_search_vector_update()
        RETURNS trigger AS $$
        BEGIN
          NEW.search_vector := to_tsvector('simple',
            coalesce(NEW.title, '') || ' ' || coalesce(NEW.preface, '')
          );
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    op.execute("""
        CREATE TRIGGER regulations_search_vector_trigger
        BEFORE INSERT OR UPDATE ON regulations
        FOR EACH ROW EXECUTE FUNCTION regulations_search_vector_update();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS regulations_search_vector_trigger ON regulations")
    op.execute("DROP FUNCTION IF EXISTS regulations_search_vector_update")
    op.drop_index('ix_regulations_search_vector', table_name='regulations')
    op.drop_column('regulations', 'search_vector')
