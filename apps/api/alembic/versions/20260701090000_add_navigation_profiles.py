"""add navigation profiles

Revision ID: 20260701090000
Revises: 20260628100000
Create Date: 2026-07-01 09:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260701090000"
down_revision = "20260628100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "navigation_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("key", sa.String(length=50), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("audience", sa.String(length=200), nullable=True),
        sa.Column("priority", sa.Integer(), server_default="100", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("is_system", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("match_any_permissions", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("match_any_prefixes", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("exclude_permissions", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("exclude_prefixes", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("desktop_sections", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("mobile_order", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_navigation_profiles_key", "navigation_profiles", ["key"], unique=True)

    op.create_table(
        "navigation_profile_positions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("profile_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("position_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["position_id"], ["positions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["profile_id"], ["navigation_profiles.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("profile_id", "position_id", name="uq_navigation_profile_position"),
    )
    op.create_index(
        "ix_navigation_profile_positions_position_id",
        "navigation_profile_positions",
        ["position_id"],
        unique=False,
    )
    op.create_index(
        "ix_navigation_profile_positions_profile_id",
        "navigation_profile_positions",
        ["profile_id"],
        unique=False,
    )

    op.execute(
        sa.text(
            """
            INSERT INTO navigation_profiles (
                id, key, label, description, audience, priority, is_active, is_system,
                match_any_permissions, match_any_prefixes, exclude_permissions, exclude_prefixes,
                desktop_sections, mobile_order
            ) VALUES
            (
                gen_random_uuid(), 'mealVendor', '餐商視角',
                '把畫面集中在餐商管理、學餐訂購狀態、待辦與個人設定。',
                '學生餐廳、合作餐商、供餐窗口', 10, true, true,
                '[]'::jsonb, '["meal:"]'::jsonb, '[]'::jsonb,
                '["document:", "regulation:", "admin:", "shop:", "finance:", "org:", "petition:", "election:"]'::jsonb,
                '[{"id":"meal-vendor-main","heading":"餐商工作台","items":["mealVendor","meal","tasks","settings"],"collapsible":false,"default_collapsed":false}]'::jsonb,
                '["mealVendor","meal","tasks","settings"]'::jsonb
            ),
            (
                gen_random_uuid(), 'teacher', '教職員視角',
                '保留教職員常用的通知、行事曆、問卷、題庫、班級收單與學餐入口。',
                '導師、行政老師、協助班級或教學服務的教職員', 20, true, true,
                '["survey:review", "survey:manage"]'::jsonb, '["class:", "exam:"]'::jsonb,
                '[]'::jsonb, '[]'::jsonb,
                '[{"id":"teacher-main","heading":"教職員工作台","items":["dashboard","tasks","announcements","calendar"],"collapsible":false,"default_collapsed":false},{"id":"teacher-services","heading":"常用模組","items":["surveys","examPapers","shopOrders","meal","settings"],"collapsible":false,"default_collapsed":false}]'::jsonb,
                '["dashboard","tasks","surveys","examPapers","shopOrders","meal","settings"]'::jsonb
            ),
            (
                gen_random_uuid(), 'default', '完整平台視角',
                '提供學生會幹部、管理員與一般平台使用者完整導覽，再依權限隱藏不可用項目。',
                '學生代表、學生會幹部、系統管理員', 1000, true, true,
                '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
                '[{"id":"main","heading":"主要","items":["dashboard","tasks","announcements","calendar"],"collapsible":false,"default_collapsed":false},{"id":"platform","heading":"自治與服務","items":["governanceHub","documents","councilProposals","regulations","meetings","judicialPetitions","surveys","petitions","meal","shop","shopOrders","partnerMap","examPapers"],"collapsible":false,"default_collapsed":false},{"id":"workbench","heading":"工作後台","items":["operations","moduleBackoffice","adminDashboard","navigationProfiles","settings","about"],"collapsible":true,"default_collapsed":true}]'::jsonb,
                '["dashboard","tasks","governanceHub","calendar","councilProposals","documents","regulations","judicialPetitions","examPapers","meal","shop","shopOrders","surveys","announcements","partnerMap","petitions","settings"]'::jsonb
            )
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_navigation_profile_positions_profile_id", table_name="navigation_profile_positions")
    op.drop_index("ix_navigation_profile_positions_position_id", table_name="navigation_profile_positions")
    op.drop_table("navigation_profile_positions")
    op.drop_index("ix_navigation_profiles_key", table_name="navigation_profiles")
    op.drop_table("navigation_profiles")
