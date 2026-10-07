"""電子證件回應 Schema。"""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class ElectronicCredentialOut(BaseModel):
    """登入者可出示的象徵性電子證件。"""

    model_config = ConfigDict(from_attributes=True)

    display_name: str
    email: str
    student_id: str | None = None
    identity_kind: Literal["student", "teacher", "authorized"]
    identity_label: str
    status_label: str


class ElectronicCredentialSettingsUpdate(BaseModel):
    """管理可使用學生電子證件的學號前三碼。"""

    student_id_prefixes: list[Annotated[str, Field(pattern=r"^[0-9]{3}$")]] = Field(
        min_length=0, max_length=30
    )

    @field_validator("student_id_prefixes")
    @classmethod
    def prefixes_must_be_unique(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("學號前三碼不可重複")
        return value


class ElectronicCredentialSettingsOut(BaseModel):
    """電子證件學生學號資格設定。"""

    student_id_prefixes: list[str]


class ElectronicCredentialAuthorizationCreate(BaseModel):
    """建立特殊身分授權。"""

    email: EmailStr
    identity_label: str = Field(min_length=1, max_length=80)
    note: str | None = Field(default=None, max_length=2000)


class ElectronicCredentialAuthorizationBulkCreate(BaseModel):
    """批量建立同一特殊身分授權。"""

    emails: list[EmailStr] = Field(min_length=1, max_length=5000)
    identity_label: str = Field(min_length=1, max_length=80)
    note: str | None = Field(default=None, max_length=2000)


class ElectronicCredentialAuthorizationUpdate(BaseModel):
    """更新特殊身分授權。"""

    email: EmailStr | None = None
    identity_label: str | None = Field(default=None, min_length=1, max_length=80)
    note: str | None = Field(default=None, max_length=2000)
    is_active: bool | None = None


class ElectronicCredentialAuthorizationOut(BaseModel):
    """管理端特殊身分授權資料。"""

    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    display_name: str | None = None
    student_id: str | None = None
    identity_label: str
    note: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ElectronicCredentialAuthorizationBulkOut(BaseModel):
    """批量建立結果。"""

    created_count: int
    skipped_emails: list[str]
