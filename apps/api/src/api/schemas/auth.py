"""身份驗證相關 Pydantic Schema"""

from pydantic import BaseModel, ConfigDict


class TokenPair(BaseModel):
    """登入成功後回傳的雙 Token"""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenPayload(BaseModel):
    """JWT Payload 解析結果"""

    sub: str  # 使用者 ID
    type: str  # "access" 或 "refresh"


class RefreshRequest(BaseModel):
    """換發 Access Token 的請求"""

    refresh_token: str


class UserRead(BaseModel):
    """當前使用者資訊回應"""

    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    display_name: str
    avatar_url: str | None = None
    is_active: bool
    is_verified: bool
