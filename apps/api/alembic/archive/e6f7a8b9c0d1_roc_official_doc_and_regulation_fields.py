"""roc_official_doc_and_regulation_fields

Revision ID: e6f7a8b9c0d1
Revises: d1e2f3a4b5c6
Create Date: 2026-05-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e6f7a8b9c0d1"
down_revision: str | Sequence[str] | None = "d1e2f3a4b5c6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # documents: ROC 正式文書欄位
    declass_enum = sa.Enum(
        "none", "auto_at_date", "manual_approval",
        name="declassificationcondition",
    )
    declass_enum.create(op.get_bind(), checkfirst=True)

    op.add_column("documents", sa.Column("issuer_full_name", sa.String(length=200), nullable=True))
    op.add_column(
        "documents",
        sa.Column(
            "declassification_condition",
            declass_enum,
            nullable=False,
            server_default="none",
        ),
    )
    op.add_column(
        "documents",
        sa.Column("confidentiality_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("documents", sa.Column("file_number", sa.String(length=100), nullable=True))
    op.add_column("documents", sa.Column("retention_period", sa.String(length=100), nullable=True))
    op.add_column("documents", sa.Column("page_info", sa.String(length=50), nullable=True))

    # regulations: 修法治理欄位
    amend_enum = sa.Enum("enact", "amend", "abolish", name="regulationamendmenttype")
    amend_enum.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "regulations",
        sa.Column("amendment_type", amend_enum, nullable=False, server_default="enact"),
    )
    op.add_column("regulations", sa.Column("amended_articles", sa.Text(), nullable=True))
    op.add_column("regulations", sa.Column("effective_date", sa.DateTime(timezone=True), nullable=True))
    op.add_column("regulations", sa.Column("legislative_history", sa.Text(), nullable=True))
    op.add_column("regulations", sa.Column("legal_basis", sa.Text(), nullable=True))
    op.add_column("regulations", sa.Column("proposal_metadata", sa.Text(), nullable=True))

    # 一次性正規化：條文舊層級轉新值
    op.execute(
        """
        UPDATE regulation_articles
        SET article_type = 'article'
        WHERE article_type = 'clause'
        """
    )
    op.execute(
        """
        UPDATE regulation_articles
        SET article_type = 'subparagraph'
        WHERE article_type = 'subsection'
        """
    )


def downgrade() -> None:
    op.drop_column("regulations", "proposal_metadata")
    op.drop_column("regulations", "legal_basis")
    op.drop_column("regulations", "legislative_history")
    op.drop_column("regulations", "effective_date")
    op.drop_column("regulations", "amended_articles")
    op.drop_column("regulations", "amendment_type")

    op.drop_column("documents", "page_info")
    op.drop_column("documents", "retention_period")
    op.drop_column("documents", "file_number")
    op.drop_column("documents", "confidentiality_expires_at")
    op.drop_column("documents", "declassification_condition")
    op.drop_column("documents", "issuer_full_name")
    sa.Enum(name="regulationamendmenttype").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="declassificationcondition").drop(op.get_bind(), checkfirst=True)
