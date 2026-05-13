"""身份驗證路由 - Google OAuth2 + JWT Token 管理"""

import logging
from urllib.parse import urlencode, urlsplit

from authlib.integrations.base_client import OAuthError
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from httpx import ConnectTimeout
from jwt.exceptions import InvalidTokenError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.anomaly_detection import check_suspicious_login, record_login
from api.core.config import settings
from api.core.database import get_db
from api.core.oauth import google
from api.core.security import (
    add_to_blacklist,
    create_access_token,
    create_refresh_token,
    decode_token,
    is_blacklisted,
)
from api.dependencies.auth import get_current_active_user
from api.models.user import User
from api.schemas.auth import RefreshRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["身份驗證"])

# 前端 base URL（從 ALLOWED_ORIGINS 第一個取得）
_FRONTEND_ORIGIN = (
    settings.ALLOWED_ORIGINS[0] if settings.ALLOWED_ORIGINS else "http://localhost:3000"
)


def _origin_from_host(host: str, proto: str) -> str:
    hostname = host.rsplit(":", maxsplit=1)[0]
    if hostname in {"localhost", "127.0.0.1", "::1"}:
        proto = "http"
    return f"{proto}://{host}"


def _origin_from_url(url: str | None) -> str | None:
    if not url:
        return None
    parsed = urlsplit(url)
    if not parsed.scheme or not parsed.netloc:
        return None
    return _origin_from_host(parsed.netloc, parsed.scheme)


def _frontend_origin_param(request: Request) -> str | None:
    return _origin_from_url(request.query_params.get("frontend_origin"))


def _frontend_origin_for(request: Request, *, use_saved: bool = True) -> str:
    if use_saved:
        saved_origin = request.session.get("frontend_origin")
        if isinstance(saved_origin, str):
            return saved_origin

    param_origin = _frontend_origin_param(request)
    if param_origin:
        return param_origin

    forwarded_host = request.headers.get("x-forwarded-host")
    if forwarded_host:
        host = forwarded_host.split(",", maxsplit=1)[0].strip()
        proto = request.headers.get("x-forwarded-proto", request.url.scheme)
        proto = proto.split(",", maxsplit=1)[0].strip()
        return _origin_from_host(host, proto)

    header_origin = _origin_from_url(request.headers.get("origin"))
    if header_origin:
        return header_origin

    referer_origin = _origin_from_url(request.headers.get("referer"))
    if referer_origin:
        return referer_origin

    host = request.headers.get("host")
    if host and not host.startswith(("localhost:8000", "127.0.0.1:8000")):
        proto = request.headers.get("x-forwarded-proto", request.url.scheme)
        proto = proto.split(",", maxsplit=1)[0].strip()
        return _origin_from_host(host, proto)

    return _FRONTEND_ORIGIN


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    response.set_cookie(
        settings.ACCESS_TOKEN_COOKIE_NAME,
        access_token,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        path="/",
    )
    response.set_cookie(
        settings.REFRESH_TOKEN_COOKIE_NAME,
        refresh_token,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        path="/",
    )


def _delete_auth_cookies(response: Response) -> None:
    response.delete_cookie(settings.ACCESS_TOKEN_COOKIE_NAME, path="/")
    response.delete_cookie(settings.REFRESH_TOKEN_COOKIE_NAME, path="/")


@router.get("/google/login", summary="發起 Google OAuth2 登入")
async def google_login(request: Request) -> RedirectResponse:
    """將使用者重導向至 Google 授權頁面"""
    frontend_origin = _frontend_origin_for(request, use_saved=False)
    request.session["frontend_origin"] = frontend_origin
    redirect_uri = f"{frontend_origin}/auth/google/callback"
    return await google.authorize_redirect(request, redirect_uri)


@router.get("/google/callback", name="google_callback", summary="Google OAuth2 Callback")
async def google_callback(request: Request, db: AsyncSession = Depends(get_db)) -> RedirectResponse:
    """
    處理 Google 授權回呼：
    1. 換取 ID Token
    2. 建立或更新使用者（自動授予 SUPERUSER_EMAILS 中的帳號超級管理員權限）
    3. 重導向至前端 /auth/callback 並附上 Token Pair
    """
    client_ip = request.client.host if request.client else "unknown"
    frontend_origin = _frontend_origin_for(request)
    try:
        token_data = await google.authorize_access_token(request, timeout=30.0)
    except OAuthError as e:
        logger.warning(
            "OAuth2 authentication failed",
            extra={"error": str(e), "client_ip": client_ip},
        )
        error_qs = urlencode({"error": "OAuth2 授權失敗，請重新登入"})
        return RedirectResponse(url=f"{frontend_origin}/login?{error_qs}")
    except ConnectTimeout:
        logger.exception(
            "Google OAuth2 token endpoint connection timed out",
            extra={"client_ip": client_ip},
        )
        error_qs = urlencode({"error": "連線 Google 登入服務逾時，請稍後再試"})
        return RedirectResponse(url=f"{frontend_origin}/login?{error_qs}")
    except Exception:
        logger.error(
            "Unexpected error in OAuth2 callback",
            exc_info=True,
            extra={"client_ip": client_ip},
        )
        error_qs = urlencode({"error": "伺服器內部錯誤"})
        return RedirectResponse(url=f"{frontend_origin}/login?{error_qs}")

    user_info = token_data.get("userinfo") or await google.userinfo(token=token_data)

    google_sub: str = user_info["sub"]
    email: str = user_info["email"]
    display_name: str = user_info.get("name", email.split("@")[0])
    avatar_url: str | None = user_info.get("picture")

    # 從學校信箱自動提取學號（格式：g0{student_id}@hchs.hc.edu.tw）
    student_id: str | None = None
    if email.endswith("@hchs.hc.edu.tw") and email.startswith("g0"):
        student_id = email[2:].split("@")[0]  # 去掉 g0 前綴

    # 查詢或建立使用者
    result = await db.execute(select(User).where(User.google_sub == google_sub))
    user = result.scalar_one_or_none()

    if user is None:
        # 嘗試用 email 找到現有帳號並關聯
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()

    # 檢查是否為超級管理員候選人
    is_superuser_candidate = email in settings.SUPERUSER_EMAILS
    is_superuser = False

    if is_superuser_candidate:
        # IP 白名單檢查
        if settings.ADMIN_IP_WHITELIST and client_ip not in settings.ADMIN_IP_WHITELIST:
            logger.warning(
                "Unauthorized superuser access attempt from non-whitelisted IP",
                extra={"email": email, "ip": client_ip, "allowed_ips": settings.ADMIN_IP_WHITELIST},
            )
            error_qs = urlencode({"error": "此 IP 不被授權為管理員"})
            return RedirectResponse(url=f"{frontend_origin}/login?{error_qs}")

        # 2FA 檢查（若啟用）
        if settings.REQUIRE_2FA_FOR_SUPERUSER:
            # 暫時標記為待 2FA（實現見第 14-15 步）
            logger.info(
                "Superuser login requires 2FA verification",
                extra={"email": email, "ip": client_ip},
            )
            is_superuser = True
        else:
            is_superuser = True
            logger.info(
                "Superuser login successful",
                extra={"email": email, "ip": client_ip},
            )

    if user is None:
        user = User(
            email=email,
            display_name=display_name,
            avatar_url=avatar_url,
            google_sub=google_sub,
            is_verified=True,
            is_superuser=is_superuser,
            student_id=student_id,
        )
        db.add(user)
    else:
        user.google_sub = google_sub
        user.avatar_url = avatar_url
        user.display_name = display_name
        user.is_superuser = is_superuser  # 每次登入時更新超級管理員狀態
        if student_id and not user.student_id:
            user.student_id = student_id  # 補填學號（若尚未設定）

    await db.flush()

    # 檢測異常登入
    is_suspicious, reason = await check_suspicious_login(str(user.id), client_ip)
    if is_suspicious:
        logger.warning(
            "Suspicious login detected",
            extra={"user_id": str(user.id), "reason": reason, "ip": client_ip},
        )
        # 可以選擇要求額外驗證（如 2FA）或發送告警郵件
        # 暫時允許登入，但記錄事件

    # 記錄成功登入
    await record_login(str(user.id), client_ip, request.headers.get("user-agent"))

    access_token = create_access_token(subject=str(user.id))
    refresh_token = create_refresh_token(subject=str(user.id))

    response = RedirectResponse(url=f"{frontend_origin}/auth/callback")
    _set_auth_cookies(response, access_token, refresh_token)
    return response


@router.post("/refresh", summary="使用 Refresh Token 換發 Access Token")
async def refresh_token(
    request: Request,
    response: Response,
    body: RefreshRequest | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """驗證 Refresh Token 並發行新的 Token Pair"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="無效的 Refresh Token"
    )

    token = (body.refresh_token if body else None) or request.cookies.get(
        settings.REFRESH_TOKEN_COOKIE_NAME
    )
    if not token or await is_blacklisted(token):
        raise credentials_exception

    try:
        payload = decode_token(token)
    except InvalidTokenError as e:
        raise credentials_exception from e

    if payload.get("type") != "refresh":
        raise credentials_exception

    user_id: str | None = payload.get("sub")
    if not user_id:
        raise credentials_exception

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise credentials_exception

    # 舊 Refresh Token 加入黑名單（Token Rotation）
    await add_to_blacklist(token)

    access_token = create_access_token(subject=str(user.id))
    refresh_token_value = create_refresh_token(subject=str(user.id))
    _set_auth_cookies(response, access_token, refresh_token_value)

    return {"message": "ok"}


@router.get("/me", summary="取得當前使用者資料")
async def get_me(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """回傳當前登入使用者的基本資料與 is_superuser 旗標"""
    from api.services.permission import get_user_permission_codes

    codes = await get_user_permission_codes(db, current_user.id)
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "display_name": current_user.display_name,
        "avatar_url": current_user.avatar_url,
        "is_superuser": current_user.is_superuser,
        "permissions": sorted(codes),
    }


@router.post("/logout", summary="登出（使 Token 失效）")
async def logout(
    request: Request,
    response: Response,
) -> dict[str, str]:
    """將 Access/Refresh Token 加入黑名單實現登出"""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth[7:]
        await add_to_blacklist(token)
    access_cookie = request.cookies.get(settings.ACCESS_TOKEN_COOKIE_NAME)
    refresh_cookie = request.cookies.get(settings.REFRESH_TOKEN_COOKIE_NAME)
    if access_cookie:
        await add_to_blacklist(access_cookie)
    if refresh_cookie:
        await add_to_blacklist(refresh_cookie)
    _delete_auth_cookies(response)
    return {"message": "已成功登出"}
