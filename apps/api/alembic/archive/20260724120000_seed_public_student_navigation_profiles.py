"""seed public and student navigation profiles

Revision ID: 20260724120000
Revises: 20260724010000
Create Date: 2026-07-24 12:00:00.000000
"""

from __future__ import annotations

from alembic import op

revision = "20260724120000"
down_revision = "20260724010000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().exec_driver_sql(
        """
        INSERT INTO navigation_profiles (
            id, key, label, description, audience, priority, is_active, is_system,
            match_any_permissions, match_any_prefixes, exclude_permissions, exclude_prefixes,
            desktop_sections, mobile_order
        ) VALUES
        (
            gen_random_uuid(), 'public', '公開查詢視角',
            '提供未登入訪客檢視公開公告、公文、法規與校園服務資訊。',
            '未登入訪客', 900, true, true,
            '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
            '[{"id":"public-main","heading":"公開查詢","items":["publicRegulations","publicDocuments","publicAnnouncements","publicPartnerMap","publicRecommendedVendors","publicPetition","publicAbout"],"collapsible":false,"default_collapsed":false}]'::jsonb,
            '["publicRegulations","publicDocuments","publicAnnouncements","publicPartnerMap","publicRecommendedVendors","publicPetition","publicAbout"]'::jsonb
        ),
        (
            gen_random_uuid(), 'student', '一般學生視角',
            '集中一般學生最常使用的公告、公開公文與法規、問卷及校園服務。',
            '一般學生、未持有行政或商家管理權限的登入使用者', 950, true, true,
            '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
            '[{"id":"student-main","heading":"我的校園服務","items":["dashboard","announcements","documents","regulations","surveys"],"collapsible":false,"default_collapsed":false},{"id":"student-services","heading":"常用入口","items":["meal","shop","merchandiseSubmissions","partnerMap","recommendedVendors","examPapers","settings"],"collapsible":false,"default_collapsed":false}]'::jsonb,
            '["dashboard","announcements","surveys","meal","shop","merchandiseSubmissions","petitions","partnerMap","settings"]'::jsonb
        )
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.get_bind().exec_driver_sql(
        "DELETE FROM navigation_profiles WHERE is_system = true AND key IN ('public', 'student')"
    )
