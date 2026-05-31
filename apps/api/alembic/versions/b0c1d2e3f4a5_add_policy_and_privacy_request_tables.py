"""add policy and privacy request tables

Revision ID: b0c1d2e3f4a5
Revises: fad66dfdefa7
Create Date: 2026-05-31 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "b0c1d2e3f4a5"
down_revision: str | Sequence[str] | None = "fad66dfdefa7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "policy_documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("version", sa.String(length=20), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("content_md", sa.Text(), nullable=False),
        sa.Column("summary_md", sa.Text(), nullable=True),
        sa.Column("effective_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("published_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("requires_explicit_consent", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["published_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("kind", "version", name="uq_policy_documents_kind_version"),
    )
    op.create_index("ix_policy_documents_effective_at", "policy_documents", ["effective_at"])
    op.create_index("ix_policy_documents_kind_active", "policy_documents", ["kind", "is_active"])
    op.create_index(
        "uq_policy_documents_one_active_per_kind",
        "policy_documents",
        ["kind"],
        unique=True,
        postgresql_where=sa.text("is_active IS true"),
    )

    op.create_table(
        "policy_consents",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("policy_document_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("agreed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("user_agent", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["policy_document_id"], ["policy_documents.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "policy_document_id", name="uq_policy_consents_user_document"),
    )
    op.create_index("ix_policy_consents_document", "policy_consents", ["policy_document_id"])
    op.create_index("ix_policy_consents_user", "policy_consents", ["user_id"])

    op.create_table(
        "privacy_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("request_type", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=24), server_default="submitted", nullable=False),
        sa.Column("subject", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("submitted_ip_address", sa.String(length=45), nullable=True),
        sa.Column("submitted_user_agent", sa.String(length=500), nullable=True),
        sa.Column("response_message", sa.Text(), nullable=True),
        sa.Column("handled_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("handled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["handled_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_privacy_requests_type_status", "privacy_requests", ["request_type", "status"])
    op.create_index("ix_privacy_requests_user_status", "privacy_requests", ["user_id", "status"])

    _seed_default_policies()


def downgrade() -> None:
    op.drop_index("ix_privacy_requests_user_status", table_name="privacy_requests")
    op.drop_index("ix_privacy_requests_type_status", table_name="privacy_requests")
    op.drop_table("privacy_requests")
    op.drop_index("ix_policy_consents_user", table_name="policy_consents")
    op.drop_index("ix_policy_consents_document", table_name="policy_consents")
    op.drop_table("policy_consents")
    op.drop_index("uq_policy_documents_one_active_per_kind", table_name="policy_documents")
    op.drop_index("ix_policy_documents_kind_active", table_name="policy_documents")
    op.drop_index("ix_policy_documents_effective_at", table_name="policy_documents")
    op.drop_table("policy_documents")


def _seed_default_policies() -> None:
    effective_at = "2026-05-31 00:00:00+08"
    rows = [
        (
            "privacy",
            "隱私政策",
            "個資權利、資料最小化、保存期限與第三方處理者的正式版本。",
            """# HCCA 隱私政策

本平台由新竹高中學生代表大會營運，用於校園自治、公共服務與學生權益治理。平台依個人資料保護法與資料最小化原則處理資料。

## 蒐集資料

我們可能處理姓名、學號、學校信箱、Google OAuth 識別碼、職務/班級資訊、登入與操作紀錄、IP、User-Agent、通知偏好，以及你在公文、法規、會議、購票、學餐、問卷、陳情等模組中主動提供或依法產生的資料。

## 使用目的

資料僅用於身份驗證、權限控管、校園自治流程、通知送達、安全稽核、事故調查、資料備份、依法保存與去識別化統計。

## 保存與刪除

一般帳號資料於最後活動後依資料保存政策保留；公文、法規、會議、稽核等具公共利益或法定保存價值的紀錄不直接刪除，但可依請求進行假名化或限制處理。

## 你的權利

你可以請求查詢、閱覽、匯出、更正、刪除、停止蒐集處理或限制使用。請於「隱私與資料請求」頁送出申請，平台會驗證身分並留下處理紀錄。

## 第三方處理者

平台可能使用 Google OAuth、Cloudflare、Sentry、AWS/S3、LINE、Discord、Email/SMTP 等服務。第三方僅依平台指示與必要範圍處理資料。

## 聯絡窗口

隱私權問題請聯絡平台管理團隊或學生代表大會指定窗口。正式上線前應替換為實際信箱。""",
        ),
        (
            "terms",
            "服務條款",
            "平台使用規則、帳號義務、停權與服務中斷處理。",
            """# HCCA 服務條款

使用本平台即表示你同意依校園自治目的、平台規範與中華民國法律使用服務。

## 服務範圍

平台提供公文簽核、法規查詢、會議、公告、購票、學餐、問卷、陳情、通知與相關管理功能。部分資料屬公開治理資訊，部分資料僅限授權角色處理。

## 使用者義務

你應妥善保管帳號，不得共用、冒用、繞過權限、干擾服務、批量擷取非公開資料、上傳違法或侵害他人權益之內容。

## 權限與停權

平台得依職務、班級、任期、法規或安全風險調整權限。違反條款或造成資安風險時，得暫停帳號或限制功能，並保留稽核紀錄。

## 服務維護

平台可能因維護、事故、資安事件或第三方服務異常暫停部分功能，將盡可能公告並保留復原紀錄。

## 條款更新

重大更新會要求重新同意。不同意新版條款時，可能無法繼續使用需登入或寫入資料的功能。""",
        ),
        (
            "cookie",
            "Cookie 政策",
            "必要 Cookie、偏好設定與分析工具使用說明。",
            """# HCCA Cookie 政策

平台使用 Cookie 與瀏覽器儲存空間維持登入、安全防護與偏好設定。

## 必要 Cookie

必要 Cookie 用於登入狀態、CSRF 防護、OAuth 流程、維護模式、防濫用與安全稽核。停用後平台可能無法正常登入或送出表單。

## 偏好資料

主題、導覽排序、首次提示關閉狀態等偏好可能存於 localStorage。這些資料通常只存在你的裝置上。

## 分析與錯誤追蹤

若啟用 PostHog 或 Sentry，平台會以最小化方式紀錄頁面瀏覽、效能與錯誤資訊，預設不送出完整個資內容。

## 管理方式

你可以在瀏覽器清除 Cookie 與網站資料；清除後需重新登入，部分偏好會重設。""",
        ),
        (
            "accessibility",
            "無障礙聲明",
            "鍵盤操作、對比、輔助科技與問題回報承諾。",
            """# HCCA 無障礙聲明

平台目標是讓學生、幹部、教職員與公眾能以鍵盤、螢幕閱讀器與不同裝置完成主要流程。

## 設計原則

平台盡量提供語意化標記、清楚焦點、足夠對比、可縮放文字、減少動態效果設定與可理解的錯誤訊息。

## 已知限制

部分複雜編輯器、地圖、拖拉排序與舊頁面仍可能需要替代操作或進一步改善。

## 回報方式

若你因視覺、聽覺、肢體、認知或裝置限制無法使用功能，請回報頁面、操作步驟與需要的替代方式。平台會優先處理影響核心自治權益的流程。""",
        ),
        (
            "security",
            "安全揭露政策",
            "漏洞回報、負責任揭露與禁止行為。",
            """# HCCA 安全揭露政策

如果你發現漏洞，請以負責任方式回報。請不要存取、修改、下載或公開非自己的資料。

## 回報內容

請提供漏洞摘要、影響範圍、重現步驟、截圖或錄影、你的聯絡方式。正式上線前應設定專用安全信箱與 PGP key。

## 我們的承諾

平台會在合理時間內確認、評估、修補並回覆。善意研究者若遵守本政策且不造成損害，平台不會主張懲戒或法律追究。

## 禁止事項

禁止破壞服務、社交工程、持續掃描、外洩資料、植入後門、攻擊第三方服務或公開未修補漏洞。""",
        ),
    ]
    for kind, title, summary, content in rows:
        op.execute(
            sa.text(
                """
                INSERT INTO policy_documents (
                    id, kind, version, title, content_md, summary_md, effective_at,
                    is_active, published_by, requires_explicit_consent, created_at, updated_at
                )
                VALUES (
                    gen_random_uuid(), :kind, '1.0.0', :title, :content, :summary,
                    :effective_at, true, NULL, :requires_consent, now(), now()
                )
                """
            ).bindparams(
                kind=kind,
                title=f"{title} v1.0.0",
                content=content,
                summary=summary,
                effective_at=effective_at,
                requires_consent=kind in {"privacy", "terms", "cookie"},
            )
        )
