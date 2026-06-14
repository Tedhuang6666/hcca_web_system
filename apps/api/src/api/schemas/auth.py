"""身份驗證相關 Pydantic Schema"""

import uuid

from pydantic import BaseModel, ConfigDict


class TokenPair(BaseModel):
    """登入成功後回傳的雙 Token"""

    access_token: str | None = None
    refresh_token: str | None = None
    token_type: str = "bearer"


class TokenPayload(BaseModel):
    """JWT Payload 解析結果"""

    sub: str  # 使用者 ID
    type: str  # "access" 或 "refresh"


class RefreshRequest(BaseModel):
    """換發 Access Token 的請求"""

    refresh_token: str | None = None


class GoogleOneTapRequest(BaseModel):
    """Google Identity Services One Tap credential"""

    credential: str
    next: str | None = None


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
