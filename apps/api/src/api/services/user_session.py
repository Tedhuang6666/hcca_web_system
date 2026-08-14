"""使用者自助工作階段管理；Router 只負責取出 HTTP metadata。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from jwt.exceptions import InvalidTokenError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.security import BLACKLIST_JTI_PREFIX, decode_token, redis_client
from api.models.user_session import UserSession


def _now() -> datetime:
    return datetime.now(UTC)


def _token_payload(token: str | None, user_id: uuid.UUID) -> dict | None:
    if not token:
        return None
    try:
        payload = decode_token(token)
    except InvalidTokenError:
        return None
    if payload.get("type") != "refresh" or payload.get("sub") != str(user_id):
        return None
    return payload


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


async def ensure_current(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    refresh_token: str | None,
    user_agent: str | None,
    ip_address: str | None,
) -> UserSession | None:
    payload = _token_payload(refresh_token, user_id)
    jti = payload.get("jti") if payload else None
    exp = payload.get("exp") if payload else None
    if not isinstance(jti, str) or not isinstance(exp, (int, float)):
        return None
    session = await db.scalar(select(UserSession).where(UserSession.refresh_token_jti == jti))
    expires_at = datetime.fromtimestamp(float(exp), UTC)
    now = _now()
    if session is None:
        session = UserSession(
            user_id=user_id,
            refresh_token_jti=jti,
            user_agent=(user_agent or "")[:2000] or None,
            ip_address=ip_address,
            last_seen_at=now,
            expires_at=expires_at,
        )
        db.add(session)
    elif session.revoked_at is None:
        session.last_seen_at = now
        session.expires_at = expires_at
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
                )
                .order_by(UserSession.last_seen_at.desc())
                .limit(50)
            )
        ).all()
    )


async def _blacklist_jti(jti: str, expires_at: datetime) -> None:
    ttl = max(0, int((expires_at - _now()).total_seconds()))
    if ttl:
        await redis_client.setex(f"{BLACKLIST_JTI_PREFIX}{jti}", ttl, "1")


async def revoke(db: AsyncSession, session: UserSession) -> None:
    if session.revoked_at is not None:
        return
    await _blacklist_jti(session.refresh_token_jti, session.expires_at)
    session.revoked_at = _now()
    await db.flush()


async def revoke_others(db: AsyncSession, user_id: uuid.UUID, current_id: uuid.UUID | None) -> int:
    sessions = await list_active(db, user_id)
    count = 0
    for session in sessions:
        if current_id and session.id == current_id:
            continue
        await revoke(db, session)
        count += 1
    return count


async def revoke_all(db: AsyncSession, user_id: uuid.UUID) -> int:
    sessions = await list_active(db, user_id)
    for session in sessions:
        await revoke(db, session)
    return len(sessions)
