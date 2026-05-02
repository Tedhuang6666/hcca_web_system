"""FastAPI 依賴注入 - 身份驗證相關"""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.security import decode_token, is_blacklisted
from api.models.user import User

bearer_scheme = HTTPBearer(auto_error=False)

_CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="無效或過期的身份憑證",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """從 Bearer Token 解析並回傳當前使用者"""
    if credentials is None:
        raise _CREDENTIALS_EXCEPTION

    token = credentials.credentials

    # 檢查黑名單
    if await is_blacklisted(token):
        raise _CREDENTIALS_EXCEPTION

    # 解碼 JWT
    try:
        payload = decode_token(token)
    except ExpiredSignatureError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token 已過期",
            headers={"WWW-Authenticate": "Bearer"},
        ) from e
    except InvalidTokenError as e:
        raise _CREDENTIALS_EXCEPTION from e

    # 驗證 Token 類型
    if payload.get("type") != "access":
        raise _CREDENTIALS_EXCEPTION

    user_id: str | None = payload.get("sub")
    if user_id is None:
        raise _CREDENTIALS_EXCEPTION

    # 查詢使用者
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise _CREDENTIALS_EXCEPTION

    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """確保當前使用者為活躍狀態"""
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="帳號已停用",
        )
    return current_user
