"""normalize_enum_values_to_lowercase

Revision ID: e5f6a7b8c9d0
Revises: 2a6f8ad10de1
"""
from alembic import op

revision = 'e5f6a7b8c9d0'
down_revision = '2a6f8ad10de1'

def upgrade() -> None:
    # ── 1. 補上標籤 (必須先跑完並提交) ──────────────────────────────────
    enum_configs = {
        'documenturgency': ('express', 'priority', 'normal'),
        'documentclassification': ('normal', 'confidential', 'secret'),
        'documentcategory': ('decree', 'letter', 'announcement', 'report', 'other'),
        'documentstatus': ('draft', 'pending', 'approved', 'rejected', 'archived'),
        'approvalstepstatus': ('waiting', 'pending', 'approved', 'rejected', 'skipped'),
        'recipienttype': ('main', 'primary', 'copy')
    }

    for type_name, values in enum_configs.items():
        for val in values:
            # 使用 IF NOT EXISTS 避免重複執行的錯誤
            op.execute(f"ALTER TYPE {type_name} ADD VALUE IF NOT EXISTS '{val}'")

    # 🔥 關鍵一步：強制提交事務
    # 這樣 PostgreSQL 才會把上面的新標籤真正寫入系統表
    op.execute("COMMIT")

    # ── 2. 更新數據 (此時事務會自動重新開始) ──────────────────────────────
    
    # 更新 documents 表
    op.execute("""
        UPDATE documents
        SET 
            urgency = LOWER(urgency::text)::documenturgency,
            classification = LOWER(classification::text)::documentclassification,
            category = LOWER(category::text)::documentcategory,
            status = LOWER(status::text)::documentstatus
        WHERE 
            urgency::text ~ '^[A-Z]+$' OR 
            classification::text ~ '^[A-Z]+$' OR 
            category::text ~ '^[A-Z]+$' OR 
            status::text ~ '^[A-Z]+$'
    """)

    # 更新審核步驟
    op.execute("""
        UPDATE document_approvals
        SET status = LOWER(status::text)::approvalstepstatus
        WHERE status::text ~ '^[A-Z]+$'
    """)

    # 更新收件人類型
    op.execute("""
        UPDATE document_recipients
        SET recipient_type = LOWER(recipient_type::text)::recipienttype
        WHERE recipient_type::text ~ '^[A-Z]+$'
    """)

def downgrade() -> None:
    pass