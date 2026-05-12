"""add_survey_system_tables
新增問卷系統資料表（P7）
"""

from collections.abc import Sequence
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "f5a6b7c8d9e0"
down_revision: str | None = "e4f5a6b7c8d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── Enum 型別 (修正點 1：手動檢查並建立) ──────────────────────────────────
    # 建立 surveystatus
    survey_status_enum = postgresql.ENUM(
        "draft", "open", "closed", "archived",
        name="surveystatus",
    )
    survey_status_enum.create(op.get_bind(), checkfirst=True)

    # 建立 questiontype
    question_type_enum = postgresql.ENUM(
        "text", "textarea", "single", "multiple", "rating", "date",
        name="questiontype",
    )
    question_type_enum.create(op.get_bind(), checkfirst=True)

    # ── surveys ───────────────────────────────────────────────────────────────
    op.create_table(
        "surveys",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        # 修正點 2：加入 create_type=False，防止重複建立
        sa.Column("status", postgresql.ENUM("draft", "open", "closed", "archived",
                                          name="surveystatus", create_type=False), 
                  nullable=False, server_default="draft"),
        sa.Column("is_anonymous", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("allow_multiple", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("opens_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closes_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("orgs.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_surveys_status", "surveys", ["status"])

    # ── survey_questions ──────────────────────────────────────────────────────
    op.create_table(
        "survey_questions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("survey_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("surveys.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_index", sa.Integer, nullable=False, server_default="0"),
        sa.Column("question_text", sa.Text, nullable=False),
        # 修正點 3：加入 create_type=False
        sa.Column("question_type", postgresql.ENUM("text", "textarea", "single", "multiple", "rating", "date",
                                                 name="questiontype", create_type=False), 
                  nullable=False, server_default="text"),
        sa.Column("is_required", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("options_json", sa.Text, nullable=True),
        sa.Column("min_value", sa.Integer, nullable=True),
        sa.Column("max_value", sa.Integer, nullable=True),
        sa.Column("placeholder", sa.String(300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  onupdate=sa.func.now(), nullable=False),
    )

    # ── survey_responses ──────────────────────────────────────────────────────
    op.create_table(
        "survey_responses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("survey_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("surveys.id", ondelete="CASCADE"), nullable=False),
        sa.Column("respondent_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("anon_token", sa.String(64), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  onupdate=sa.func.now(), nullable=False),
        sa.UniqueConstraint("survey_id", "respondent_id", name="uq_survey_respondent"),
    )

    # ── survey_answers ────────────────────────────────────────────────────────
    op.create_table(
        "survey_answers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("response_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("survey_responses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("survey_questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("answer_text", sa.Text, nullable=True),
        sa.Column("answer_json", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  onupdate=sa.func.now(), nullable=False),
    )

def downgrade() -> None:
    op.drop_table("survey_answers")
    op.drop_table("survey_responses")
    op.drop_table("survey_questions")
    op.drop_table("surveys")
    op.execute("DROP TYPE IF EXISTS questiontype")
    op.execute("DROP TYPE IF EXISTS surveystatus")