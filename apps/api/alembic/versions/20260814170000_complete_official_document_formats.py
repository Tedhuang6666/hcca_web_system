"""補齊公文文別、密等、通知單與正式格式欄位。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260814170000"
down_revision: str | Sequence[str] | None = "20260814160000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _add_enum_values(type_name: str, values: tuple[str, ...]) -> None:
    for value in values:
        op.execute(f"ALTER TYPE {type_name} ADD VALUE IF NOT EXISTS '{value}'")


def upgrade() -> None:
    _add_enum_values(
        "documentclassification",
        ("highly_confidential", "absolutely_confidential"),
    )
    _add_enum_values(
        "documentcategory",
        (
            "presentation",
            "inspection_notice",
            "phone_record",
            "book_letter",
            "directive",
            "signature",
            "memo",
            "appointment",
            "certificate",
            "license",
            "contract",
            "proposal",
            "summary",
            "briefing",
            "form",
        ),
    )
    _add_enum_values("recipienttype", ("attendee", "observer"))

    for table in ("documents", "document_templates"):
        op.add_column(table, sa.Column("issuer_postal_code", sa.String(length=20), nullable=True))
        op.add_column(table, sa.Column("issuer_address", sa.String(length=300), nullable=True))
        op.add_column(table, sa.Column("basis", sa.Text(), nullable=True))
        op.add_column(table, sa.Column("handler_phone", sa.String(length=50), nullable=True))
        op.add_column(table, sa.Column("classification_number", sa.String(length=100), nullable=True))
        if table == "document_templates":
            op.add_column(
                table,
                sa.Column("confidentiality_expires_at", sa.DateTime(timezone=True), nullable=True),
            )

    op.add_column(
        "documents",
        sa.Column("source_document_date", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("documents", sa.Column("source_document_number", sa.String(length=100), nullable=True))
    op.add_column(
        "document_attachments",
        sa.Column("quantity", sa.Integer(), server_default="1", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("document_attachments", "quantity")
    op.drop_column("documents", "source_document_number")
    op.drop_column("documents", "source_document_date")
    for table in ("document_templates", "documents"):
        if table == "document_templates":
            op.drop_column(table, "confidentiality_expires_at")
        op.drop_column(table, "classification_number")
        op.drop_column(table, "handler_phone")
        op.drop_column(table, "basis")
        op.drop_column(table, "issuer_address")
        op.drop_column(table, "issuer_postal_code")

    # PostgreSQL 不支援安全地移除已加入的 enum value；保留值供既有資料相容。
