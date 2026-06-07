"""身份驗證路由 - Google / Discord OAuth2 + JWT Token 管理"""

import logging
from urllib.parse import urlencode, urlsplit

from anyio import to_thread
from authlib.integrations.base_client import OAuthError
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from google.auth.exceptions import GoogleAuthError
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from httpx import ConnectTimeout
from jwt.exceptions import InvalidTokenError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.anomaly_detection import check_suspicious_login, record_login
from api.core.config import settings
from api.core.database import get_db
from api.core.oauth import discord, google
from api.core.permission_codes import PermissionCode
from api.core.posthog import get_posthog_client
from api.core.redirects import safe_next_path
from api.core.security import (
    add_to_blacklist,
    create_access_token,
    create_mfa_challenge_token,
    create_refresh_token,
    decode_token,
    is_blacklisted,
)
from api.dependencies.auth import get_current_active_user
from api.models.user import User
from api.schemas.auth import GoogleOneTapRequest, RefreshRequest
from api.services.discord_bot import (
    get_user_by_discord_id,
)
from api.services.discord_bot import (
    is_configured as discord_is_configured,
)

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
    raw = _origin_from_url(request.query_params.get("frontend_origin"))
    if raw and raw not in settings.ALLOWED_ORIGINS:
        logger.warning("Rejected frontend_origin not in ALLOWED_ORIGINS: %s", raw)
        return None
    return raw


def _origin_if_allowed(origin: str | None) -> str | None:
    """只接受位於 ALLOWED_ORIGINS 白名單內的來源，否則回傳 None。

    防 Host header injection：``X-Forwarded-Host`` / ``Origin`` / ``Referer`` /
    ``Host`` 全是用戶端可控標頭，未經白名單驗證就拿來組 OAuth ``redirect_uri``
    或登入後導回網址，會被用來把流程導向攻擊者網域。
    """
    if origin and origin in settings.ALLOWED_ORIGINS:
        return origin
    return None


def _frontend_origin_for(request: Request, *, use_saved: bool = True) -> str:
    if use_saved:
        saved_origin = request.session.get("frontend_origin")
        # session 由本服務簽章，且寫入時已通過白名單驗證，可信任。
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
        allowed = _origin_if_allowed(_origin_from_host(host, proto))
        if allowed:
            return allowed
        logger.warning("Rejected X-Forwarded-Host not in ALLOWED_ORIGINS: %s", host)

    header_origin = _origin_if_allowed(_origin_from_url(request.headers.get("origin")))
    if header_origin:
        return header_origin

    referer_origin = _origin_if_allowed(_origin_from_url(request.headers.get("referer")))
    if referer_origin:
        return referer_origin

    host = request.headers.get("host")
    if host and not host.startswith(("localhost:8000", "127.0.0.1:8000")):
        proto = request.headers.get("x-forwarded-proto", request.url.scheme)
        proto = proto.split(",", maxsplit=1)[0].strip()
        allowed = _origin_if_allowed(_origin_from_host(host, proto))
        if allowed:
            return allowed

    return _FRONTEND_ORIGIN


def _safe_next_path(value: str | None) -> str:
    return safe_next_path(value, default="/")


def _email_can_login(email: str, existing_user: User | None = None) -> bool:
    # 開放外校/校外帳號登入：登入後無任何 RBAC 權限，等同公開頁檢視層級，
    # 並可使用陳情送件功能。如需恢復校內限定，將 LOGIN_ALLOW_EXTERNAL_USERS 設為 False。
    if settings.LOGIN_ALLOW_EXTERNAL_USERS:
        return True
    normalized = email.strip().lower()
    domain = normalized.rsplit("@", maxsplit=1)[-1] if "@" in normalized else ""
    return (
        domain in settings.LOGIN_ALLOWED_EMAIL_DOMAINS
        or normalized in settings.LOGIN_EMAIL_ALLOWLIST
        or normalized in settings.OWNER_EMAILS
        or normalized in settings.SUPERUSER_EMAILS
        or bool(existing_user and existing_user.is_active and existing_user.allow_external_login)
    )


async def _auth_user_payload(db: AsyncSession, user: User) -> dict:
    from api.services.permission import get_user_permission_codes

    codes = await get_user_permission_codes(db, user.id)
    return {
        "id": str(user.id),
        "email": user.email,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
        "allow_external_login": user.allow_external_login,
        "is_superuser": user.is_superuser,
        "is_owner": user.email.lower() in settings.OWNER_EMAILS,
        "permissions": sorted(codes),
    }


async def _access_token_claims(db: AsyncSession, user: User) -> dict:
    from api.services.permission import get_user_permission_codes

    codes = await get_user_permission_codes(db, user.id)
    return {
        "is_admin": user.is_superuser or PermissionCode.ADMIN_ALL in codes,
        "permissions": sorted(codes),
    }


async def _upsert_google_user(
    db: AsyncSession,
    *,
    google_sub: str,
    email: str,
    display_name: str,
    avatar_url: str | None,
    client_ip: str,
    user_agent: str | None,
) -> User:
    existing_user_by_email_result = await db.execute(select(User).where(User.email == email))
    existing_user_by_email = existing_user_by_email_result.scalar_one_or_none()

    if not _email_can_login(email, existing_user_by_email):
        logger.warning(
            "Rejected Google login from disallowed email domain",
            extra={"email": email, "client_ip": client_ip},
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="僅允許竹中 Google 帳號或已核准的管理員帳號登入",
        )

    student_id: str | None = None
    if email.endswith("@hchs.hc.edu.tw") and email.startswith("g0"):
        student_id = email[2:].split("@")[0]

    result = await db.execute(select(User).where(User.google_sub == google_sub))
    user = result.scalar_one_or_none() or existing_user_by_email

    is_superuser_candidate = email in settings.SUPERUSER_EMAILS or email in settings.OWNER_EMAILS
    is_superuser = False

    if is_superuser_candidate:
        if settings.ADMIN_IP_WHITELIST and client_ip not in settings.ADMIN_IP_WHITELIST:
            logger.warning(
                "Unauthorized superuser access attempt from non-whitelisted IP",
                extra={"email": email, "ip": client_ip, "allowed_ips": settings.ADMIN_IP_WHITELIST},
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="此 IP 不被授權為管理員"
            )

        is_superuser = True
        logger.info("Superuser login successful", extra={"email": email, "ip": client_ip})
        # 登入必須先簽發 token，讓尚未設定 MFA 的管理員可以進入設定頁。
        # 後台路由再由 require_admin_mfa 強制檢查 MFA。

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
        if is_superuser_candidate:
            user.is_superuser = True
        if student_id and not user.student_id:
            user.student_id = student_id

    await db.flush()

    is_suspicious, reason = await check_suspicious_login(str(user.id), client_ip)
    if is_suspicious:
        logger.warning(
            "Suspicious login detected",
            extra={"user_id": str(user.id), "reason": reason, "ip": client_ip},
        )

    await record_login(str(user.id), client_ip, user_agent)
    return user


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
    request.session["login_next"] = _safe_next_path(request.query_params.get("next"))
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
    login_next = _safe_next_path(request.session.get("login_next"))
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
    email: str = user_info["email"].strip().lower()
    display_name: str = user_info.get("name", email.split("@")[0])
    avatar_url: str | None = user_info.get("picture")

    try:
        user = await _upsert_google_user(
            db,
            google_sub=google_sub,
            email=email,
            display_name=display_name,
            avatar_url=avatar_url,
            client_ip=client_ip,
            user_agent=request.headers.get("user-agent"),
        )
    except HTTPException as exc:
        error_qs = urlencode({"error": str(exc.detail)})
        return RedirectResponse(url=f"{frontend_origin}/login?{error_qs}")

    if user.mfa_enabled:
        challenge_token = create_mfa_challenge_token(subject=str(user.id))
        challenge_qs = urlencode({"challenge": challenge_token, "next": login_next})
        return RedirectResponse(url=f"{frontend_origin}/auth/mfa?{challenge_qs}")

    access_token = create_access_token(
        subject=str(user.id),
        extra_claims=await _access_token_claims(db, user),
    )
    refresh_token = create_refresh_token(subject=str(user.id))

    callback_qs = urlencode({"next": login_next})
    response = RedirectResponse(url=f"{frontend_origin}/auth/callback?{callback_qs}")
    _set_auth_cookies(response, access_token, refresh_token)

    _ph = get_posthog_client()
    if _ph:
        _ph.set(distinct_id=str(user.id), properties={"is_superuser": user.is_superuser})
        _ph.capture(
            distinct_id=str(user.id),
            event="user_logged_in",
            properties={"login_method": "google_oauth"},
        )

    return response


@router.get("/discord/login", summary="發起 Discord OAuth2 登入")
async def discord_login(request: Request) -> RedirectResponse:
    """使用已綁定的平台 Discord 帳號登入。"""
    if not discord_is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Discord OAuth 尚未設定",
        )
    frontend_origin = _frontend_origin_for(request, use_saved=False)
    request.session["frontend_origin"] = frontend_origin
    request.session["login_next"] = _safe_next_path(request.query_params.get("next"))
    return await discord.authorize_redirect(request, settings.DISCORD_LOGIN_REDIRECT_URI)


@router.get("/discord/callback", summary="Discord OAuth2 Callback")
async def discord_callback(
    request: Request, db: AsyncSession = Depends(get_db)
) -> RedirectResponse:
    """驗證 Discord 身份，並以既有啟用中的帳號綁定完成登入。"""
    client_ip = request.client.host if request.client else "unknown"
    frontend_origin = _frontend_origin_for(request)
    login_next = _safe_next_path(request.session.get("login_next"))

    try:
        token_data = await discord.authorize_access_token(request, timeout=30.0)
        discord_response = await discord.get("users/@me", token=token_data)
        discord_response.raise_for_status()
        user_info = discord_response.json()
    except OAuthError as exc:
        logger.warning(
            "Discord OAuth2 authentication failed",
            extra={"error": str(exc), "client_ip": client_ip},
        )
        error_qs = urlencode({"error": "Discord 授權失敗，請重新登入"})
        return RedirectResponse(url=f"{frontend_origin}/login?{error_qs}")
    except ConnectTimeout:
        logger.exception(
            "Discord OAuth2 endpoint connection timed out",
            extra={"client_ip": client_ip},
        )
        error_qs = urlencode({"error": "連線 Discord 登入服務逾時，請稍後再試"})
        return RedirectResponse(url=f"{frontend_origin}/login?{error_qs}")
    except Exception:
        logger.error(
            "Unexpected error in Discord OAuth2 callback",
            exc_info=True,
            extra={"client_ip": client_ip},
        )
        error_qs = urlencode({"error": "伺服器內部錯誤"})
        return RedirectResponse(url=f"{frontend_origin}/login?{error_qs}")

    user = await get_user_by_discord_id(db, str(user_info["id"]))
    if user is None:
        error_qs = urlencode({"error": "此 Discord 帳號尚未綁定，請先使用 Google 登入後綁定"})
        return RedirectResponse(url=f"{frontend_origin}/login?{error_qs}")

    is_suspicious, reason = await check_suspicious_login(str(user.id), client_ip)
    if is_suspicious:
        logger.warning(
            "Suspicious Discord login detected",
            extra={"user_id": str(user.id), "reason": reason, "ip": client_ip},
        )
    await record_login(str(user.id), client_ip, request.headers.get("user-agent"))

    if user.mfa_enabled:
        challenge_token = create_mfa_challenge_token(subject=str(user.id))
        challenge_qs = urlencode({"challenge": challenge_token, "next": login_next})
        return RedirectResponse(url=f"{frontend_origin}/auth/mfa?{challenge_qs}")

    access_token = create_access_token(
        subject=str(user.id),
        extra_claims=await _access_token_claims(db, user),
    )
    refresh_token = create_refresh_token(subject=str(user.id))
    callback_qs = urlencode({"next": login_next})
    response = RedirectResponse(url=f"{frontend_origin}/auth/callback?{callback_qs}")
    _set_auth_cookies(response, access_token, refresh_token)

    posthog = get_posthog_client()
    if posthog:
        posthog.set(distinct_id=str(user.id), properties={"is_superuser": user.is_superuser})
        posthog.capture(
            distinct_id=str(user.id),
            event="user_logged_in",
            properties={"login_method": "discord_oauth"},
        )

    return response


@router.post("/google/one-tap", summary="Google One Tap 登入")
async def google_one_tap(
    body: GoogleOneTapRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """驗證 Google Identity Services credential，建立登入 cookie。"""
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="尚未設定 Google Client ID"
        )

    def verify_credential() -> dict:
        return google_id_token.verify_oauth2_token(
            body.credential,
            google_requests.Request(),
            settings.GOOGLE_CLIENT_ID,
        )

    try:
        idinfo = await to_thread.run_sync(verify_credential)
    except (ValueError, GoogleAuthError) as exc:
        logger.warning("Invalid Google One Tap credential", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Google 登入憑證無效"
        ) from exc

    if not idinfo.get("email_verified"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Google 信箱尚未驗證")

    client_ip = request.client.host if request.client else "unknown"
    user = await _upsert_google_user(
        db,
        google_sub=str(idinfo["sub"]),
        email=str(idinfo["email"]).strip().lower(),
        display_name=str(idinfo.get("name") or str(idinfo["email"]).split("@")[0]),
        avatar_url=idinfo.get("picture"),
        client_ip=client_ip,
        user_agent=request.headers.get("user-agent"),
    )

    login_next = _safe_next_path(body.next)
    if user.mfa_enabled:
        challenge_token = create_mfa_challenge_token(subject=str(user.id))
        return {"mfa_required": True, "challenge": challenge_token, "next": login_next}

    access_token = create_access_token(
        subject=str(user.id),
        extra_claims=await _access_token_claims(db, user),
    )
    refresh_token = create_refresh_token(subject=str(user.id))
    _set_auth_cookies(response, access_token, refresh_token)

    _ph = get_posthog_client()
    if _ph:
        _ph.set(distinct_id=str(user.id), properties={"is_superuser": user.is_superuser})
        _ph.capture(
            distinct_id=str(user.id),
            event="user_logged_in",
            properties={"login_method": "google_one_tap"},
        )

    return {
        "mfa_required": False,
        "next": login_next,
        "user": await _auth_user_payload(db, user),
    }


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

    access_token = create_access_token(
        subject=str(user.id),
        extra_claims=await _access_token_claims(db, user),
    )
    refresh_token_value = create_refresh_token(subject=str(user.id))
    _set_auth_cookies(response, access_token, refresh_token_value)

    return {"message": "ok"}


@router.get("/me", summary="取得當前使用者資料")
async def get_me(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """回傳當前登入使用者的基本資料與 is_superuser 旗標"""
    return await _auth_user_payload(db, current_user)


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

    _ph = get_posthog_client()
    if _ph:
        _raw_token = access_cookie or (auth[7:] if auth.lower().startswith("bearer ") else None)
        if _raw_token:
            try:
                _tok_payload = decode_token(_raw_token)
                _ph.capture(
                    distinct_id=_tok_payload.get("sub", "anonymous"), event="user_logged_out"
                )
            except Exception:
                pass

    return {"message": "已成功登出"}
