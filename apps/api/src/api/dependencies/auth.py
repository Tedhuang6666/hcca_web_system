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


def _user_from_snapshot(payload: dict, user_id: uuid.UUID) -> User | None:
    snapshot = payload.get("user")
    if not isinstance(snapshot, dict):
        return None
    email = snapshot.get("email")
    display_name = snapshot.get("display_name")
    if not isinstance(email, str) or not isinstance(display_name, str):
        return None
    notification_preferences = snapshot.get("notification_preferences")
    return User(
        id=user_id,
        email=email,
        display_name=display_name,
        avatar_url=snapshot.get("avatar_url") if isinstance(snapshot.get("avatar_url"), str) else None,
        student_id=snapshot.get("student_id") if isinstance(snapshot.get("student_id"), str) else None,
        show_email=bool(snapshot.get("show_email", True)),
        is_active=bool(snapshot.get("is_active", True)),
        is_verified=bool(snapshot.get("is_verified", False)),
        is_superuser=bool(snapshot.get("is_superuser", False)),
        notification_preferences=(notification_preferences if isinstance(notification_preferences, dict) else {}),
        ui_theme=snapshot.get("ui_theme") if isinstance(snapshot.get("ui_theme"), str) else "auto",
        ui_locale=snapshot.get("ui_locale") if isinstance(snapshot.get("ui_locale"), str) else "zh-TW",
    )


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

    # JWT v2 在登入／refresh 時放入最小使用者快照。帳號停用、權限異動及全裝置
    # 登出會撤銷 session，因此一般 access 驗證不必為了載入 User 再打一次 DB。
    # impersonation 與 migration 期間的無快照舊 token 仍走原本的 DB 驗證流程。
    if token_type == "access":
        snapshot_user = _user_from_snapshot(payload, user_id)
        if snapshot_user is not None:
            return snapshot_user

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

    identity_emails = {user.email}
    if not isinstance(payload.get("user"), dict):
        rows = await db.scalars(
            select(UserIdentity.email).where(
                UserIdentity.user_id == user.id,
                UserIdentity.email.is_not(None),
            )
        )
        identity_emails.update(email for email in rows.all() if email)
    block = await find_identity_block(
        user_id=str(user.id),
        emails=identity_emails,
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
