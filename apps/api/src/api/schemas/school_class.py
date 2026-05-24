"""班級系統 Pydantic Schemas"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

# ── 使用者精簡 ────────────────────────────────────────────────────────────────


class ClassUserBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str
    student_id: str | None = None
    email: str


# ── 學號區間 ──────────────────────────────────────────────────────────────────


class ClassStudentRangeCreate(BaseModel):
    student_id_start: str = Field(..., min_length=1, max_length=20, description="學號區間起")
    student_id_end: str = Field(..., min_length=1, max_length=20, description="學號區間迄")


class ClassStudentRangeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    class_id: uuid.UUID
    student_id_start: str
    student_id_end: str


# ── 班級幹部 ──────────────────────────────────────────────────────────────────


class ClassCadreCreate(BaseModel):
    user_id: uuid.UUID = Field(..., description="幹部使用者 ID")


class ClassCadreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    class_id: uuid.UUID
    user_id: uuid.UUID
    user: ClassUserBrief | None = None


class ClassMembershipCreate(BaseModel):
    user_id: uuid.UUID
    source: str = Field("manual", max_length=20)
    start_date: date | None = None


class ClassMembershipOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    class_id: uuid.UUID
    user_id: uuid.UUID
    academic_year: int
    source: str
    status: str
    start_date: date
    end_date: date | None = None
    user: ClassUserBrief | None = None


class ClassRoleBindingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    class_id: uuid.UUID
    role_key: str
    position_id: uuid.UUID


class ClassRoleHolderOut(BaseModel):
    user_position_id: uuid.UUID
    user_id: uuid.UUID
    display_name: str
    email: str
    student_id: str | None = None
    start_date: date
    end_date: date | None = None


class ClassRoleOut(BaseModel):
    id: uuid.UUID
    class_id: uuid.UUID
    role_key: str
    label: str
    position_id: uuid.UUID
    permission_codes: list[str] = []
    holders: list[ClassRoleHolderOut] = []


class ClassRoleAssign(BaseModel):
    user_id: uuid.UUID
    start_date: date | None = None
    end_date: date | None = None


# ── 手動成員 ──────────────────────────────────────────────────────────────────


class ClassManualMemberCreate(BaseModel):
    user_id: uuid.UUID = Field(..., description="要手動加入班級的使用者 ID")


class ClassManualMemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    class_id: uuid.UUID
    user_id: uuid.UUID
    user: ClassUserBrief | None = None


# ── 班級 ──────────────────────────────────────────────────────────────────────


class SchoolClassCreate(BaseModel):
    academic_year: int = Field(..., ge=1, le=999, description="學年度（民國年，如 115）")
    class_code: str = Field(..., min_length=1, max_length=20, description="數字班級代碼")
    grade: int = Field(0, ge=0, le=12, description="年級（報表分組用）")
    label: str | None = Field(None, max_length=100, description="顯示名稱")
    ranges: list[ClassStudentRangeCreate] = Field(default_factory=list, description="學號區間規則")


class ClassStudentRangeTemplate(BaseModel):
    student_id_start_template: str = Field(
        "{academic_year}{grade}{class_no_padded}{student_no_padded}",
        min_length=1,
        max_length=100,
        description="學號起始模板",
    )
    student_id_end_template: str = Field(
        "{academic_year}{grade}{class_no_padded}{student_no_padded}",
        min_length=1,
        max_length=100,
        description="學號結束模板",
    )
    student_no_start: int = Field(1, ge=0, le=999, description="座號起")
    student_no_end: int = Field(40, ge=0, le=999, description="座號迄")
    class_no_width: int = Field(2, ge=1, le=4, description="班號補零寬度")
    student_no_width: int = Field(2, ge=1, le=4, description="座號補零寬度")


class ClassStudentRangeOverride(BaseModel):
    class_no: int = Field(..., ge=0, le=99, description="要覆寫的班號")
    student_no_start: int | None = Field(None, ge=0, le=999, description="此班座號起")
    student_no_end: int | None = Field(None, ge=0, le=999, description="此班座號迄")


class SchoolClassBulkGradeCreate(BaseModel):
    grade: int = Field(..., ge=0, le=12, description="年級")
    class_start: int = Field(..., ge=0, le=99, description="起始班號")
    class_end: int = Field(..., ge=0, le=99, description="結束班號")
    class_code_template: str = Field(
        "{grade}{class_no_padded}",
        min_length=1,
        max_length=50,
        description="班級代碼模板",
    )
    label_template: str | None = Field(
        "{academic_year} 學年度 {grade} 年 {class_no} 班",
        max_length=100,
        description="顯示名稱模板",
    )
    range_template: ClassStudentRangeTemplate | None = Field(
        default_factory=ClassStudentRangeTemplate,
        description="快捷學號區間模板；設為 null 時不建立區間",
    )
    class_overrides: list[ClassStudentRangeOverride] = Field(
        default_factory=list,
        max_length=100,
        description="單班座號起迄覆寫",
    )


class SchoolClassBulkCreate(BaseModel):
    academic_year: int = Field(..., ge=1, le=999, description="學年度（民國年，如 115）")
    is_active: bool = Field(True, description="是否設為當前學年度班級")
    grades: list[SchoolClassBulkGradeCreate] = Field(..., min_length=1, max_length=12)


class SchoolClassUpdate(BaseModel):
    class_code: str | None = Field(None, min_length=1, max_length=20)
    grade: int | None = Field(None, ge=0, le=12)
    label: str | None = Field(None, max_length=100)
    is_active: bool | None = None


class SchoolClassListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    academic_year: int
    class_code: str
    grade: int
    label: str | None
    is_active: bool


class SchoolClassOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    academic_year: int
    class_code: str
    grade: int
    label: str | None
    is_active: bool
    created_by: uuid.UUID
    org_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime
    ranges: list[ClassStudentRangeOut] = []
    cadres: list[ClassCadreOut] = []
    memberships: list[ClassMembershipOut] = []
    role_bindings: list[ClassRoleBindingOut] = []


class SchoolClassBulkCreateResult(BaseModel):
    class_code: str
    label: str | None = None
    ok: bool
    class_id: uuid.UUID | None = None
    detail: str | None = None


class SchoolClassBulkCreateOut(BaseModel):
    total: int
    succeeded: int
    skipped: int
    failed: int
    results: list[SchoolClassBulkCreateResult]


class SchoolClassBulkAction(BaseModel):
    class_ids: list[uuid.UUID] = Field(..., min_length=1, max_length=200)
    action: str = Field(..., pattern="^(activate|deactivate|delete)$")


class SchoolClassBulkActionResult(BaseModel):
    class_id: uuid.UUID
    label: str | None = None
    ok: bool
    detail: str | None = None


class SchoolClassBulkActionOut(BaseModel):
    total: int
    succeeded: int
    failed: int
    results: list[SchoolClassBulkActionResult]


class ClassMemberOut(BaseModel):
    """班級成員（由學號區間推導），含是否為幹部"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str
    student_id: str | None
    email: str
    is_cadre: bool = False
    source: str = "range"
    manual_member_id: uuid.UUID | None = None


__all__ = [
    "ClassCadreCreate",
    "ClassCadreOut",
    "ClassManualMemberCreate",
    "ClassManualMemberOut",
    "ClassMembershipCreate",
    "ClassMembershipOut",
    "ClassMemberOut",
    "ClassRoleAssign",
    "ClassRoleBindingOut",
    "ClassRoleHolderOut",
    "ClassRoleOut",
    "ClassStudentRangeCreate",
    "ClassStudentRangeOverride",
    "ClassStudentRangeOut",
    "ClassStudentRangeTemplate",
    "ClassUserBrief",
    "SchoolClassBulkAction",
    "SchoolClassBulkActionOut",
    "SchoolClassBulkActionResult",
    "SchoolClassBulkCreate",
    "SchoolClassBulkCreateOut",
    "SchoolClassBulkCreateResult",
    "SchoolClassBulkGradeCreate",
    "SchoolClassCreate",
    "SchoolClassListItem",
    "SchoolClassOut",
    "SchoolClassUpdate",
]
