"""公文系統 Pydantic Schemas — 完整版（含速別、密等、主旨、受文者、字號模板等欄位）"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, EmailStr, Field, HttpUrl, model_validator

from api.models.document import (
    ApprovalStepStatus,
    DeclassificationCondition,
    DelegateSource,
    DocumentCategory,
    DocumentClassification,
    DocumentStatus,
    DocumentUrgency,
    DocumentVisibility,
    RecipientType,
    YearMode,
)

# ── 字號模板 ────────────────────────────────────────────────────────────────────


class SerialTemplateCreate(BaseModel):
    """建立字號模板（需 serial:create 權限）。
    org_prefix 由系統從 Org.prefix 自動取得，使用者只需填入分類字元（細別）。
    """

    org_id: uuid.UUID = Field(..., description="所屬組織 ID")
    category_char: str = Field(
        ..., min_length=1, max_length=10, description="分類字元（細別），如『生』『議』"
    )
    year_mode: YearMode = Field(YearMode.ROC, description="年份制度（roc=民國年，ce=西元年）")
    reset_on_new_year: bool = Field(True, description="是否每年重置流水號")
    description: str | None = Field(
        None, max_length=200, description="模板說明（如：學生生活輔導類公文）"
    )
    is_default: bool = Field(False, description="是否設為組織預設字號模板")
    is_default_president_publish: bool = Field(
        False, description="是否設為主席公布法規專用預設字號模板"
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "org_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
                "category_char": "生",
                "year_mode": "roc",
                "reset_on_new_year": True,
                "description": "學生生活輔導類公文",
                "is_default": True,
                "is_default_president_publish": False,
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
    is_default: bool
    is_default_president_publish: bool
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


class SerialTemplateUpdate(BaseModel):
    """更新字號模板（僅可修改說明與狀態）"""

    description: str | None = Field(None, max_length=200)
    is_active: bool | None = None
    reset_on_new_year: bool | None = None
    year_mode: YearMode | None = None
    is_default: bool | None = None
    is_default_president_publish: bool | None = None


# ── 退件模式 ───────────────────────────────────────────────────────────────────


class RejectMode(StrEnum):
    TO_CREATOR = "to_creator"  # 退回至承辦人（流程終止，轉為 REJECTED 狀態）
    TO_PREVIOUS = "to_previous"  # 退回至上一關（流程繼續，文件保持 PENDING 狀態）


# ── 受文者 ─────────────────────────────────────────────────────────────────────


class RecipientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    recipient_type: RecipientType
    name: str
    email: str | None


class RecipientCreate(BaseModel):
    recipient_type: RecipientType = Field(
        ..., description="受文者類型（main=受文者 / primary=正本 / copy=副本）"
    )
    name: str = Field(..., min_length=1, max_length=200, description="單位或個人名稱")
    email: EmailStr | None = Field(None, description="聯絡信箱（發文後自動寄送）")


# ── 附件 ───────────────────────────────────────────────────────────────────────


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    display_name: str | None = None
    content_type: str | None = None
    file_size: int | None = None
    url: str = ""
    link_url: str | None = None
    uploaded_by: uuid.UUID
    created_at: datetime


class AttachmentLinkCreate(BaseModel):
    url: HttpUrl = Field(...)
    display_text: str | None = Field(None, max_length=255)


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
    is_acting: bool  # 是否以代理身份操作
    delegate_source: DelegateSource | None = None
    approver: ApproverOut
    delegate: ApproverOut | None = None  # 代理人資訊（若有）
    approver_title: str | None = None
    delegate_title: str | None = None


class DocumentApprovalDelegationCreate(BaseModel):
    org_id: uuid.UUID
    delegate_user_id: uuid.UUID
    start_at: datetime
    end_at: datetime | None = None
    reason: str | None = Field(None, max_length=1000)

    @model_validator(mode="after")
    def validate_range(self) -> DocumentApprovalDelegationCreate:
        if self.end_at and self.end_at < self.start_at:
            raise ValueError("代理結束時間不得早於開始時間")
        return self


class DocumentApprovalDelegationUpdate(BaseModel):
    delegate_user_id: uuid.UUID | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    reason: str | None = Field(None, max_length=1000)
    is_active: bool | None = None


class DocumentApprovalDelegationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    principal_user_id: uuid.UUID
    delegate_user_id: uuid.UUID
    start_at: datetime
    end_at: datetime | None
    reason: str | None
    is_active: bool
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime
    principal_user: ApproverOut
    delegate_user: ApproverOut


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
    issuer_full_name: str | None = None
    # 公文格式欄位
    urgency: DocumentUrgency
    classification: DocumentClassification
    declassification_condition: DeclassificationCondition = DeclassificationCondition.NONE
    confidentiality_expires_at: datetime | None = None
    category: DocumentCategory
    subject: str | None
    doc_description: str | None
    action_required: str | None
    content: str  # 向下相容欄位
    # 開會通知單專屬欄位
    meeting_purpose: str | None = None
    meeting_time: datetime | None = None
    meeting_location: str | None = None
    meeting_chairperson: str | None = None
    # 承辦人
    handler_name: str | None
    handler_unit: str | None
    handler_phone: str | None
    handler_email: str | None
    file_number: str | None = None
    retention_period: str | None = None
    # 流程
    status: DocumentStatus
    current_step: int
    # 時間
    issued_at: datetime | None
    due_date: datetime | None
    submitted_at: datetime | None
    completed_at: datetime | None
    page_info: str | None = None
    created_at: datetime
    updated_at: datetime
    # 可見度
    visibility_level: DocumentVisibility = DocumentVisibility.ORG_ONLY
    is_public: bool = False
    # 關聯
    org_id: uuid.UUID
    created_by: uuid.UUID
    serial_template_id: uuid.UUID | None = None
    regulation_id: uuid.UUID | None = None  # 此令所公布的法規（僅令類公文）
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
    issuer_full_name: str | None = Field(None, max_length=200, description="發文機關全銜")
    org_id: uuid.UUID = Field(..., description="所屬組織 ID")
    # 字號模板（None 則使用通用格式 DOC-YYYY-NNNNNN）
    serial_template_id: uuid.UUID | None = Field(
        None, description="字號模板 ID（由長官以 doc.issue 權限建立）"
    )
    # 公文格式欄位
    urgency: DocumentUrgency = Field(DocumentUrgency.NORMAL, description="速別")
    classification: DocumentClassification = Field(
        DocumentClassification.NORMAL, description="密等"
    )
    declassification_condition: DeclassificationCondition = Field(
        DeclassificationCondition.NONE, description="解密條件"
    )
    confidentiality_expires_at: datetime | None = Field(None, description="保密期限訖日")
    category: DocumentCategory = Field(DocumentCategory.LETTER, description="公文類別")
    subject: str | None = Field(None, max_length=500, description="主旨")
    doc_description: str | None = Field(None, description="說明（詳細事由、依據）")
    action_required: str | None = Field(None, description="辦法（具體行動或執行方式）")
    content: str = Field(default="", description="整合性內容（Markdown，向下相容）")
    # 開會通知單專屬欄位
    meeting_purpose: str | None = Field(None, max_length=500, description="開會事由")
    meeting_time: datetime | None = Field(None, description="開會時間")
    meeting_location: str | None = Field(None, max_length=200, description="開會地點")
    meeting_chairperson: str | None = Field(None, max_length=100, description="主席")
    # 承辦人
    handler_name: str | None = Field(None, max_length=50, description="承辦人姓名")
    handler_unit: str | None = Field(None, max_length=100, description="承辦人所屬單位")
    handler_phone: str | None = Field(None, max_length=30, description="承辦人聯絡電話")
    handler_email: EmailStr | None = Field(None, description="承辦人電子郵件")
    file_number: str | None = Field(None, max_length=100, description="檔號")
    retention_period: str | None = Field(None, max_length=100, description="保存年限")
    # 時間
    due_date: datetime | None = Field(None, description="限辦日期")
    visibility_level: DocumentVisibility = Field(
        DocumentVisibility.ORG_ONLY,
        description="可見度：subject_only=僅當事人 / org_only=機關成員 / public=全體登入 / publicly_open=公開（含未登入）",
    )
    is_public: bool = Field(False, description="向下相容，由 visibility_level 自動同步")
    page_info: str | None = Field(None, max_length=50, description="頁次資訊（列印後回填）")
    # 受文者（可隨建立一起傳入）
    recipients: list[RecipientCreate] = Field(default_factory=list, description="受文者清單")

    @model_validator(mode="after")
    def validate_official_fields(self) -> DocumentCreate:
        if self.category == DocumentCategory.MEETING_NOTICE:
            if not self.meeting_purpose or not self.meeting_time or not self.meeting_location:
                raise ValueError("開會通知單需填寫開會事由、時間與地點")
        else:
            if not self.subject or not self.subject.strip():
                raise ValueError("主旨為必填且不可為空白")
            if self.subject and len(self.subject.strip()) < 8:
                raise ValueError("主旨長度過短，請使用正式句式")

        if (
            self.classification != DocumentClassification.NORMAL
            and self.declassification_condition == DeclassificationCondition.AUTO_AT_DATE
            and not self.confidentiality_expires_at
        ):
            raise ValueError("選擇自動解密時必須提供保密期限訖日")
        return self


class DocumentUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    issuer_full_name: str | None = Field(None, max_length=200)
    urgency: DocumentUrgency | None = None
    classification: DocumentClassification | None = None
    declassification_condition: DeclassificationCondition | None = None
    confidentiality_expires_at: datetime | None = None
    category: DocumentCategory | None = None
    subject: str | None = Field(None, max_length=500)
    doc_description: str | None = None
    action_required: str | None = None
    content: str | None = None
    meeting_purpose: str | None = Field(None, max_length=500)
    meeting_time: datetime | None = None
    meeting_location: str | None = Field(None, max_length=200)
    meeting_chairperson: str | None = Field(None, max_length=100)
    handler_name: str | None = Field(None, max_length=50)
    handler_unit: str | None = Field(None, max_length=100)
    handler_phone: str | None = Field(None, max_length=30)
    handler_email: EmailStr | None = None
    file_number: str | None = Field(None, max_length=100)
    retention_period: str | None = Field(None, max_length=100)
    due_date: datetime | None = None
    visibility_level: DocumentVisibility | None = None
    is_public: bool | None = None
    page_info: str | None = Field(None, max_length=50)
    change_note: str | None = Field(None, max_length=500, description="修改備註（將記入版本歷程）")


class SubmitRequest(BaseModel):
    approver_ids: list[uuid.UUID] = Field(
        ..., min_length=1, description="審核人 ID 清單（按順序逐關審核）"
    )
    model_config = ConfigDict(
        json_schema_extra={
            "example": {"approver_ids": ["uuid-of-approver-1", "uuid-of-approver-2"]}
        }
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
