"""公文系統 Pydantic Schemas — 完整版（含速別、密等、主旨、受文者、字號模板等欄位）"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from api.models.document import (
    ApprovalStepStatus,
    DocumentCategory,
    DocumentClassification,
    DocumentStatus,
    DocumentUrgency,
    RecipientType,
    YearMode,
)

# ── 字號模板 ────────────────────────────────────────────────────────────────────

class SerialTemplateCreate(BaseModel):
    """建立字號模板（需 doc.issue 權限）"""
    org_id: uuid.UUID = Field(..., description="所屬組織 ID")
    org_prefix: str = Field(..., min_length=1, max_length=20, description="組織代碼前綴，如『嶺代』『嶺學』")
    category_char: str = Field(..., min_length=1, max_length=10, description="類別字，如『生』『議』")
    year_mode: YearMode = Field(YearMode.ROC, description="年份制度（roc=民國年，ce=西元年）")
    reset_on_new_year: bool = Field(True, description="是否每年重置流水號")
    description: str | None = Field(None, max_length=200, description="模板說明（如：學生生活輔導類公文）")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "org_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
                "org_prefix": "嶺代",
                "category_char": "生",
                "year_mode": "roc",
                "reset_on_new_year": True,
                "description": "學生生活輔導類公文",
            }
        }
    )


class SerialTemplateOut(BaseModel):
    """字號模板回應"""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    org_prefix: str
    category_char: str
    year_mode: YearMode
    reset_on_new_year: bool
    current_year: int
    counter: int
    is_active: bool
    description: str | None
    created_by: uuid.UUID
    created_at: datetime
    # 預覽下一個字號（計算值，不儲存於 DB）
    preview: str = ""

    @classmethod
    def from_orm_with_preview(cls, template: object) -> SerialTemplateOut:
        obj = cls.model_validate(template)
        yr = getattr(template, "current_year", 0)
        cnt = getattr(template, "counter", 0) + 1
        prefix = getattr(template, "org_prefix", "")
        cat = getattr(template, "category_char", "")
        obj.preview = f"{prefix}{cat}字第 {yr}{cnt:07d} 號（預覽）"
        return obj


# ── 退件模式 ───────────────────────────────────────────────────────────────────

class RejectMode(StrEnum):
    TO_CREATOR = "to_creator"    # 退回至承辦人（流程終止，轉為 REJECTED 狀態）
    TO_PREVIOUS = "to_previous"  # 退回至上一關（流程繼續，文件保持 PENDING 狀態）


# ── 受文者 ─────────────────────────────────────────────────────────────────────

class RecipientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    recipient_type: RecipientType
    name: str
    email: str | None


class RecipientCreate(BaseModel):
    recipient_type: RecipientType = Field(..., description="受文者類型（main=受文者 / primary=正本 / copy=副本）")
    name: str = Field(..., min_length=1, max_length=200, description="單位或個人名稱")
    email: str | None = Field(None, description="聯絡信箱（發文後自動寄送）")


# ── 附件 ───────────────────────────────────────────────────────────────────────

class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    content_type: str
    file_size: int
    url: str = ""
    uploaded_by: uuid.UUID
    created_at: datetime


# ── 版本紀錄 ───────────────────────────────────────────────────────────────────

class RevisionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    revision_number: int
    title: str
    content: str
    change_note: str | None
    changed_by: uuid.UUID
    created_at: datetime


# ── 審核步驟 ───────────────────────────────────────────────────────────────────

class ApproverOut(BaseModel):
    """
    審核人資訊。
    使用 validation_alias 將 ORM 的 display_name 欄位對應到 API 回應的 name 欄位。
    """
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    # User.display_name → ApproverOut.name（API 對外保持 name 欄位名稱）
    name: str = Field(validation_alias="display_name")
    email: str


class ApprovalStepOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    step_order: int
    status: ApprovalStepStatus
    comment: str | None
    decided_at: datetime | None
    is_acting: bool          # 是否以代理身份操作
    approver: ApproverOut
    delegate: ApproverOut | None = None  # 代理人資訊（若有）


# ── 公文詳細輸出 ───────────────────────────────────────────────────────────────

class DocumentOut(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        json_schema_extra={
            "example": {
                "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
                "serial_number": "DOC-2025-000001",
                "title": "關於學期末活動經費核銷事宜",
                "urgency": "normal",
                "classification": "normal",
                "category": "letter",
                "subject": "為辦理本學期末聯合晚會，申請核銷活動經費新台幣伍萬元整，請 鑒核。",
                "doc_description": "本次活動於114年12月20日舉辦，已完成所有採購單據蒐集。",
                "action_required": "請核定核銷清單並撥款。",
                "status": "pending",
                "current_step": 1,
            }
        },
    )

    id: uuid.UUID
    serial_number: str
    title: str
    # 公文格式欄位
    urgency: DocumentUrgency
    classification: DocumentClassification
    category: DocumentCategory
    subject: str | None
    doc_description: str | None
    action_required: str | None
    content: str              # 向下相容欄位
    issuer_org_name: str | None
    # 承辦人
    handler_name: str | None
    handler_unit: str | None
    handler_phone: str | None
    handler_email: str | None
    # 流程
    status: DocumentStatus
    current_step: int
    # 時間
    issued_at: datetime | None
    due_date: datetime | None
    submitted_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    # 關聯
    org_id: uuid.UUID
    created_by: uuid.UUID
    serial_template_id: uuid.UUID | None = None
    revisions: list[RevisionOut] = []
    approvals: list[ApprovalStepOut] = []
    attachments: list[AttachmentOut] = []
    recipients: list[RecipientOut] = []


class DocumentListItem(BaseModel):
    """列表頁的輕量版公文資訊（不含全文與版本）"""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    serial_number: str
    title: str
    urgency: DocumentUrgency
    classification: DocumentClassification
    category: DocumentCategory
    subject: str | None
    status: DocumentStatus
    org_id: uuid.UUID
    created_by: uuid.UUID
    due_date: datetime | None
    submitted_at: datetime | None
    completed_at: datetime | None
    created_at: datetime


# ── 請求體 ─────────────────────────────────────────────────────────────────────

class DocumentCreate(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "title": "關於學期末活動經費核銷事宜",
                "urgency": "normal",
                "classification": "normal",
                "category": "letter",
                "subject": "為辦理本學期末聯合晚會，申請核銷活動經費新台幣伍萬元整，請 鑒核。",
                "doc_description": "本次活動於114年12月20日舉辦，已完成所有採購單據蒐集。",
                "action_required": "請核定核銷清單並撥款。",
                "org_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
                "serial_template_id": None,
                "handler_name": "王小明",
                "handler_unit": "學聯會秘書處",
                "handler_phone": "0912-345-678",
                "handler_email": "secretary@example.edu.tw",
                "due_date": "2025-12-25T00:00:00+08:00",
            }
        }
    )

    title: str = Field(..., min_length=1, max_length=200, description="公文標題（系統顯示用）")
    org_id: uuid.UUID = Field(..., description="所屬組織 ID")
    # 字號模板（None 則使用通用格式 DOC-YYYY-NNNNNN）
    serial_template_id: uuid.UUID | None = Field(
        None, description="字號模板 ID（由長官以 doc.issue 權限建立）"
    )
    # 公文格式欄位
    urgency: DocumentUrgency = Field(DocumentUrgency.NORMAL, description="速別")
    classification: DocumentClassification = Field(DocumentClassification.NORMAL, description="密等")
    category: DocumentCategory = Field(DocumentCategory.LETTER, description="公文類別")
    subject: str | None = Field(None, max_length=500, description="主旨")
    doc_description: str | None = Field(None, description="說明（詳細事由、依據）")
    action_required: str | None = Field(None, description="辦法（具體行動或執行方式）")
    content: str = Field(default="", description="整合性內容（Markdown，向下相容）")
    issuer_org_name: str | None = Field(None, max_length=200, description="發文機關全銜")
    # 承辦人
    handler_name: str | None = Field(None, max_length=50, description="承辦人姓名")
    handler_unit: str | None = Field(None, max_length=100, description="承辦人所屬單位")
    handler_phone: str | None = Field(None, max_length=30, description="承辦人聯絡電話")
    handler_email: str | None = Field(None, description="承辦人電子郵件")
    # 時間
    due_date: datetime | None = Field(None, description="限辦日期")
    # 受文者（可隨建立一起傳入）
    recipients: list[RecipientCreate] = Field(default_factory=list, description="受文者清單")


class DocumentUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    urgency: DocumentUrgency | None = None
    classification: DocumentClassification | None = None
    category: DocumentCategory | None = None
    subject: str | None = Field(None, max_length=500)
    doc_description: str | None = None
    action_required: str | None = None
    content: str | None = None
    issuer_org_name: str | None = Field(None, max_length=200)
    handler_name: str | None = Field(None, max_length=50)
    handler_unit: str | None = Field(None, max_length=100)
    handler_phone: str | None = Field(None, max_length=30)
    handler_email: str | None = None
    due_date: datetime | None = None
    change_note: str | None = Field(None, max_length=500, description="修改備註（將記入版本歷程）")


class SubmitRequest(BaseModel):
    approver_ids: list[uuid.UUID] = Field(
        ..., min_length=1, description="審核人 ID 清單（按順序逐關審核）"
    )
    model_config = ConfigDict(
        json_schema_extra={"example": {"approver_ids": ["uuid-of-approver-1", "uuid-of-approver-2"]}}
    )


class ApproveRequest(BaseModel):
    comment: str | None = Field(None, max_length=1000, description="核准意見（選填）")


class RejectRequest(BaseModel):
    comment: str = Field(..., min_length=1, max_length=1000, description="退件原因（必填）")
    mode: RejectMode = Field(
        RejectMode.TO_CREATOR,
        description=(
            "退件模式：\n"
            "- `to_creator`：退回至承辦人，流程終止（公文轉為 REJECTED 狀態）\n"
            "- `to_previous`：退回至上一關，流程繼續（公文維持 PENDING 狀態）"
        ),
    )
    model_config = ConfigDict(
        json_schema_extra={
            "example": {"comment": "說明部分需補充法律依據，請修正後重送", "mode": "to_creator"}
        }
    )


class RecallRequest(BaseModel):
    """撤回送審請求（僅建立者可操作；第一關尚未決定前有效）"""
    pass

