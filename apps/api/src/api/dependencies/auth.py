"""FastAPI 依賴注入 - 身份驗證相關"""

import uuid
from typing import TYPE_CHECKING

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.auth_cookies import access_token_from_cookies
from api.core.config import settings
from api.core.database import get_db
from api.core.defense import find_identity_block
from api.core.security import decode_token, is_blacklisted, is_session_revoked
from api.models.user import User
from api.models.user_identity import UserIdentity

if TYPE_CHECKING:
    pass

bearer_scheme = HTTPBearer(auto_error=False)


def _token_from_request(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None,
) -> str | None:
    # 瀏覽器一般登入只接受 HttpOnly cookie；唯一保留的 Bearer 例外是既有的
    # 管理員 impersonation token。它必須優先於 cookie，否則管理員無法在自己的
    # cookie 仍有效時代行目標使用者。
    if credentials is not None:
        try:
            payload = decode_token(credentials.credentials)
        except (ExpiredSignatureError, InvalidTokenError):
            pass
        else:
            if payload.get("type") == "impersonation":
                return credentials.credentials
    return access_token_from_cookies(request.cookies)


async def _user_from_access_token(token: str, db: AsyncSession) -> User | None:
    if await is_blacklisted(token):
        return None
    try:
        payload = decode_token(token)
    except (ExpiredSignatureError, InvalidTokenError):
        return None
    token_type = payload.get("type")
    if token_type not in {"access", "impersonation"}:
        return None
    raw_user_id: str | None = payload.get("sub")
    if not raw_user_id:
        return None
    if await is_session_revoked(payload.get("sid")):
        return None
    try:
        user_id = uuid.UUID(raw_user_id)
    except (TypeError, ValueError):
        return None
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        return None

    if token_type == "impersonation":
        raw_actor_id = payload.get("imp")
        if not raw_actor_id:
            return None
        try:
            actor_id = uuid.UUID(str(raw_actor_id))
        except (TypeError, ValueError):
            return None
        actor = await db.scalar(select(User).where(User.id == actor_id))
        if actor is None or not actor.is_active:
            return None
        if not actor.is_superuser:
            from api.core.permission_codes import PermissionCode
            from api.services.permission import get_user_permission_codes

            actor_permissions = await get_user_permission_codes(db, actor.id)
            if PermissionCode.ADMIN_IMPERSONATE not in actor_permissions:
                return None
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

    if payload.get("type") not in {"access", "impersonation"}:
        raise _CREDENTIALS_EXCEPTION

    user = await _user_from_access_token(token, db)
    if user is None:
        raise _CREDENTIALS_EXCEPTION

    identity_emails = await db.scalars(
        select(UserIdentity.email).where(
            UserIdentity.user_id == user.id,
            UserIdentity.email.is_not(None),
        )
    )
    block = await find_identity_block(
        user_id=str(user.id),
        emails={user.email, *(email for email in identity_emails.all() if email)},
    )
    if block:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "message": "此帳號已被網站封鎖",
                "blocked": True,
                "reason": block.get("reason") or "未提供原因",
                "expires_at": block.get("expires_at"),
            },
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
