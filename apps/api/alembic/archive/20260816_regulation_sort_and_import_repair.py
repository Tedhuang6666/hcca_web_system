"""修正法規排序、沿革最後日期與檔案匯入提案人。"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260816_regulation_sort"
down_revision: str | Sequence[str] | None = "fbc1a34fda7d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 匯入法規的發布日應代表沿革最後一次更改，而非第一筆制定日。
    op.execute(
        """
        UPDATE regulations AS r
        SET published_at = latest.amended_at,
            updated_at = latest.amended_at
        FROM (
            SELECT regulation_id, MAX(amended_at) AS amended_at
            FROM regulation_revisions
            WHERE amended_at IS NOT NULL
            GROUP BY regulation_id
        ) AS latest
        WHERE r.id = latest.regulation_id
          AND r.workflow_status = 'published'
        """
    )
    # 既有 DOCX 匯入以沿革摘要辨識，顯示提案人為不詳。
    op.execute(
        """
        UPDATE regulations AS r
        SET proposal_metadata = '__file_import__'
        WHERE r.proposal_metadata IS NULL
          AND EXISTS (
              SELECT 1 FROM regulation_revisions AS rr
              WHERE rr.regulation_id = r.id
                AND rr.change_brief LIKE '%匯入%'
          )
        """
    )


def downgrade() -> None:
    op.execute(
        "UPDATE regulations SET proposal_metadata = NULL "
        "WHERE proposal_metadata = '__file_import__'"
    )
