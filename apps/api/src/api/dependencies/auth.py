"""FastAPI 依賴注入 - 身份驗證相關"""

from typing import TYPE_CHECKING

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.core.database import get_db
from api.core.security import decode_token, is_blacklisted, register_active_token
from api.models.user import User

if TYPE_CHECKING:
    pass

bearer_scheme = HTTPBearer(auto_error=False)


def _token_from_request(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None,
) -> str | None:
    if credentials is not None:
        return credentials.credentials
    return request.cookies.get(settings.ACCESS_TOKEN_COOKIE_NAME)


async def _user_from_access_token(token: str, db: AsyncSession) -> User | None:
    if await is_blacklisted(token):
        return None
    try:
        payload = decode_token(token)
    except (ExpiredSignatureError, InvalidTokenError):
        return None
    if payload.get("type") != "access":
        return None
    user_id: str | None = payload.get("sub")
    if not user_id:
        return None
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        return None
    # 使用即註冊：把 jti 寫進 user_tokens 集合，讓 admin 能 revoke_user 一次清空所有 session
    await register_active_token(
        user_id, payload.get("jti"), settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    )
    return user


# 不拋出 401，直接回傳 None（供公開端點使用）
async def get_optional_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> "User | None":
    """嘗試解析 Bearer Token，失敗或無 token 時回傳 None（不拋出 401）"""
    token = _token_from_request(request, credentials)
    if token is None:
        return None
    return await _user_from_access_token(token, db)


_CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="無效或過期的身份憑證",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """從 Bearer Token 解析並回傳當前使用者"""
    token = _token_from_request(request, credentials)
    if token is None:
        raise _CREDENTIALS_EXCEPTION

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

    # 使用即註冊 jti，供 admin 端 revoke_user 強制登出
    await register_active_token(
        user_id, payload.get("jti"), settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    )

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


async def get_current_school_member(
    current_user: User = Depends(get_current_active_user),
) -> User:
    """確保當前使用者具校內成員身分。"""
    normalized = current_user.email.strip().lower()
    domain = normalized.rsplit("@", maxsplit=1)[-1] if "@" in normalized else ""
    if current_user.student_id or domain in settings.LOGIN_ALLOWED_EMAIL_DOMAINS:
        return current_user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="僅限校內成員使用",
    )
