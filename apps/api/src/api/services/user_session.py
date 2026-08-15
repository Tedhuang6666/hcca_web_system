"""使用者工作階段：refresh rotation、撤銷與裝置管理。"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from jwt.exceptions import InvalidTokenError
from redis.exceptions import RedisError
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    is_session_revoked,
    revoke_session,
    token_jti_hash,
)
from api.models.user_session import UserSession

logger = logging.getLogger(__name__)


class SessionTokenError(ValueError):
    """refresh token 無效、過期或不屬於目前工作階段。"""


class RefreshTokenReuseError(SessionTokenError):
    """已輪替的 refresh token 被重用；整個 session 必須失效。"""


@dataclass(frozen=True)
class SessionTokenPair:
    access_token: str
    refresh_token: str
    session: UserSession


def _now() -> datetime:
    return datetime.now(UTC)


def _as_utc(value: datetime) -> datetime:
    """正規化 ORM 回傳值；SQLite 的 timezone=True 仍可能給出 naive datetime。"""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _token_payload(token: str | None, user_id: uuid.UUID | None = None) -> dict | None:
    if not token:
        return None
    try:
        payload = decode_token(token)
    except InvalidTokenError:
        return None
    if payload.get("type") != "refresh":
        return None
    if user_id is not None and payload.get("sub") != str(user_id):
        return None
    return payload


def _session_expiry(now: datetime, absolute_expires_at: datetime) -> datetime:
    return min(
        now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS), _as_utc(absolute_expires_at)
    )


def _payload_jti(payload: dict) -> str:
    jti = payload.get("jti")
    if not isinstance(jti, str) or not jti:
        raise SessionTokenError("refresh token 缺少 jti")
    return jti


def _payload_session_id(payload: dict) -> uuid.UUID | None:
    raw_session_id = payload.get("sid")
    if raw_session_id is None:
        return None
    try:
        return uuid.UUID(str(raw_session_id))
    except (TypeError, ValueError) as exc:
        raise SessionTokenError("refresh token 含無效 session id") from exc


def _matches_refresh_jti(stored: str | None, jti: str) -> bool:
    """同時支援 migration 前的 raw jti 與 v2 HMAC digest。"""
    if not stored:
        return False
    return stored == jti or stored == token_jti_hash(jti)


def device_label(user_agent: str | None) -> str:
    value = (user_agent or "").lower()
    device = "手機" if "mobile" in value or "android" in value else "桌面瀏覽器"
    if "edg/" in value:
        browser = "Edge"
    elif "chrome/" in value:
        browser = "Chrome"
    elif "firefox/" in value:
        browser = "Firefox"
    elif "safari/" in value and "chrome/" not in value:
        browser = "Safari"
    else:
        browser = "瀏覽器"
    return f"{browser} · {device}"


async def issue_session_tokens(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    extra_claims: dict | None,
    user_agent: str | None,
    ip_address: str | None,
    auth_method: str,
) -> SessionTokenPair:
    """完成登入時建立工作階段，並發行帶 ``sid`` 的 v2 token pair。"""
    now = _now()
    session_id = uuid.uuid4()
    absolute_expires_at = now + timedelta(days=settings.REFRESH_TOKEN_ABSOLUTE_DAYS)
    expires_at = _session_expiry(now, absolute_expires_at)
    refresh_token = create_refresh_token(str(user_id), session_id=str(session_id))
    refresh_payload = _token_payload(refresh_token, user_id)
    if refresh_payload is None:  # pragma: no cover - self-issued token must be valid
        raise RuntimeError("無法解析剛建立的 refresh token")
    session = UserSession(
        id=session_id,
        user_id=user_id,
        refresh_jti_hash=token_jti_hash(_payload_jti(refresh_payload)),
        user_agent=(user_agent or "")[:2000] or None,
        ip_address=ip_address,
        auth_method=auth_method,
        auth_time=now,
        last_seen_at=now,
        rotated_at=now,
        expires_at=expires_at,
        absolute_expires_at=absolute_expires_at,
    )
    db.add(session)
    await db.flush()
    access_token = create_access_token(
        str(user_id),
        extra_claims,
        session_id=str(session.id),
        auth_time=int(now.timestamp()),
        amr=[auth_method],
    )
    return SessionTokenPair(access_token, refresh_token, session)


async def rotate_session_tokens(
    db: AsyncSession,
    *,
    refresh_token: str,
    user_id: uuid.UUID,
    extra_claims: dict | None,
    user_agent: str | None,
    ip_address: str | None,
) -> SessionTokenPair:
    """鎖定 session 後輪替 refresh；重放舊 token 時撤銷整個 session。"""
    payload = _token_payload(refresh_token, user_id)
    if payload is None:
        raise SessionTokenError("無效 refresh token")
    jti = _payload_jti(payload)
    session_id = _payload_session_id(payload)

    if session_id is None:
        jti_hash = token_jti_hash(jti)
        session = await db.scalar(
            select(UserSession)
            .where(
                UserSession.user_id == user_id,
                or_(
                    UserSession.refresh_jti_hash.in_((jti, jti_hash)),
                    UserSession.previous_refresh_jti_hash.in_((jti, jti_hash)),
                ),
            )
            .with_for_update()
        )
    else:
        session = await db.scalar(
            select(UserSession).where(UserSession.id == session_id).with_for_update()
        )

    if session is None or session.user_id != user_id:
        raise SessionTokenError("找不到有效工作階段")

    now = _now()
    expires_at = _as_utc(session.expires_at)
    absolute_expires_at = _as_utc(session.absolute_expires_at)
    if session.revoked_at is not None or expires_at <= now or absolute_expires_at <= now:
        raise SessionTokenError("工作階段已失效")
    if await is_session_revoked(str(session.id), fail_closed=True):
        raise SessionTokenError("工作階段已撤銷")

    if not _matches_refresh_jti(session.refresh_jti_hash, jti):
        if _matches_refresh_jti(session.previous_refresh_jti_hash, jti):
            await revoke(db, session, reason="refresh_reuse")
            raise RefreshTokenReuseError("偵測到 refresh token 重用")
        raise SessionTokenError("refresh token 不屬於工作階段")

    next_refresh = create_refresh_token(str(user_id), session_id=str(session.id))
    next_payload = _token_payload(next_refresh, user_id)
    if next_payload is None:  # pragma: no cover - self-issued token must be valid
        raise RuntimeError("無法解析剛建立的 refresh token")
    session.previous_refresh_jti_hash = session.refresh_jti_hash
    session.refresh_jti_hash = token_jti_hash(_payload_jti(next_payload))
    session.rotated_at = now
    session.last_seen_at = now
    session.expires_at = _session_expiry(now, absolute_expires_at)
    if user_agent:
        session.user_agent = user_agent[:2000]
    if ip_address:
        session.ip_address = ip_address
    await db.flush()

    access_token = create_access_token(
        str(user_id),
        extra_claims,
        session_id=str(session.id),
        auth_time=int(_as_utc(session.auth_time).timestamp()),
        amr=[session.auth_method],
    )
    return SessionTokenPair(access_token, next_refresh, session)


async def ensure_current(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    refresh_token: str | None,
    user_agent: str | None,
    ip_address: str | None,
) -> UserSession | None:
    """從目前 refresh token 找到 session 並更新 last_seen，不建立隱性 session。"""
    payload = _token_payload(refresh_token, user_id)
    if payload is None:
        return None
    jti = _payload_jti(payload)
    session_id = _payload_session_id(payload)
    if session_id is None:
        jti_hash = token_jti_hash(jti)
        session = await db.scalar(
            select(UserSession).where(
                UserSession.user_id == user_id,
                UserSession.refresh_jti_hash.in_((jti, jti_hash)),
            )
        )
    else:
        session = await db.scalar(select(UserSession).where(UserSession.id == session_id))
    if (
        session is None
        or session.revoked_at is not None
        or not _matches_refresh_jti(session.refresh_jti_hash, jti)
    ):
        return None
    now = _now()
    if _as_utc(session.expires_at) <= now or _as_utc(session.absolute_expires_at) <= now:
        return None
    session.last_seen_at = now
    if user_agent:
        session.user_agent = user_agent[:2000]
    if ip_address:
        session.ip_address = ip_address
    await db.flush()
    return session


async def list_active(db: AsyncSession, user_id: uuid.UUID) -> list[UserSession]:
    now = _now()
    return list(
        (
            await db.scalars(
                select(UserSession)
                .where(
                    UserSession.user_id == user_id,
                    UserSession.revoked_at.is_(None),
                    UserSession.expires_at > now,
                    UserSession.absolute_expires_at > now,
                )
                .order_by(UserSession.last_seen_at.desc())
                .limit(50)
            )
        ).all()
    )


async def list_recent(db: AsyncSession, user_id: uuid.UUID) -> list[UserSession]:
    """列出仍在 refresh 絕對效期內的 session，包含已撤銷記錄供使用者稽核。"""
    now = _now()
    return list(
        (
            await db.scalars(
                select(UserSession)
                .where(
                    UserSession.user_id == user_id,
                    UserSession.absolute_expires_at > now,
                )
                .order_by(UserSession.last_seen_at.desc())
                .limit(50)
            )
        ).all()
    )


async def revoke(db: AsyncSession, session: UserSession, *, reason: str = "explicit") -> None:
    if session.revoked_at is not None:
        return
    now = _now()
    ttl = max(0, int((_as_utc(session.absolute_expires_at) - now).total_seconds()))
    # 資料庫才是 session 真相；Redis 短暫故障不得阻止停用帳號／登出的持久撤銷。
    session.revoked_at = now
    session.revoked_reason = reason
    await db.flush()
    try:
        await revoke_session(str(session.id), ttl)
    except (RedisError, TimeoutError):
        logger.exception("session revocation Redis write failed; DB revocation remains durable")
    from api.core.ws_manager import disconnect_session_websockets

    await disconnect_session_websockets(str(session.id))


async def revoke_others(db: AsyncSession, user_id: uuid.UUID, current_id: uuid.UUID | None) -> int:
    sessions = await list_active(db, user_id)
    count = 0
    for session in sessions:
        if current_id and session.id == current_id:
            continue
        await revoke(db, session, reason="revoke_others")
        count += 1
    return count


async def revoke_all(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    reason: str = "revoke_all",
) -> int:
    sessions = await list_active(db, user_id)
    for session in sessions:
        await revoke(db, session, reason=reason)
    return len(sessions)
