"""身份驗證相關 Pydantic Schema"""

import uuid

from pydantic import BaseModel, ConfigDict


class GoogleOneTapRequest(BaseModel):
    """Google Identity Services One Tap credential"""

    credential: str
    next: str | None = None


class AuthSessionOut(BaseModel):
    """登入工作階段的身份、權限及首次登入導引。"""

    id: uuid.UUID
    email: str
    display_name: str
    avatar_url: str | None
    is_superuser: bool
    is_owner: bool
    permissions: list[str]
    can_create_shop_delegation: bool
    is_school_email: bool
    requires_class_confirmation: bool


class UserRead(BaseModel):
    """當前使用者資訊回應"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str
    student_id: str | None = None
    avatar_url: str | None = None
    show_email: bool = True
    is_active: bool
    is_verified: bool
    is_superuser: bool = False
    # Owner 為環境變數 OWNER_EMAILS 驅動的最高權限角色，不存於資料庫，由路由層注入。
    is_owner: bool = False
