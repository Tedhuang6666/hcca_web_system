"""將校商投稿入口補進既有導覽視角。"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260720050000"
down_revision: str | Sequence[str] | None = "353289ae4fdf"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """更新既有資料庫中的系統導覽設定。"""
    op.execute(
        """
        UPDATE navigation_profiles AS profile
        SET desktop_sections = (
                SELECT jsonb_agg(
                    CASE
                        WHEN section->>'id' IN ('platform', 'teacher-services')
                             AND NOT (section->'items' ? 'merchandiseSubmissions')
                        THEN jsonb_set(
                            section,
                            '{items}',
                            (section->'items') || '["merchandiseSubmissions"]'::jsonb
                        )
                        ELSE section
                    END
                    ORDER BY section_order
                )
                FROM jsonb_array_elements(profile.desktop_sections)
                     WITH ORDINALITY AS sections(section, section_order)
            ),
            mobile_order = CASE
                WHEN profile.mobile_order ? 'merchandiseSubmissions'
                THEN profile.mobile_order
                ELSE profile.mobile_order || '["merchandiseSubmissions"]'::jsonb
            END
        WHERE profile.key IN ('default', 'teacher')
        """
    )


def downgrade() -> None:
    """移除本次新增的導覽項目。"""
    op.execute(
        """
        UPDATE navigation_profiles AS profile
        SET desktop_sections = (
                SELECT jsonb_agg(
                    CASE
                        WHEN section->>'id' IN ('platform', 'teacher-services')
                        THEN jsonb_set(
                            section,
                            '{items}',
                            (section->'items') - 'merchandiseSubmissions'
                        )
                        ELSE section
                    END
                    ORDER BY section_order
                )
                FROM jsonb_array_elements(profile.desktop_sections)
                     WITH ORDINALITY AS sections(section, section_order)
            ),
            mobile_order = profile.mobile_order - 'merchandiseSubmissions'
        WHERE profile.key IN ('default', 'teacher')
        """
    )
