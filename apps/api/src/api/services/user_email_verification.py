"""使用者自助連結 Email 的驗證碼流程。"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.core.security import redis_client
from api.email.sender import send_branded_email
from api.models.user import User
from api.models.user_identity import UserIdentity
from api.services.user_registration import (
    UserRegistrationError,
    link_user_emails,
    merge_user_accounts,
)

CODE_TTL_SECONDS = 600
RESEND_COOLDOWN_SECONDS = 60
MAX_ATTEMPTS = 5


def _pending_key(user_id: uuid.UUID, email: str) -> str:
    digest = hashlib.sha256(email.encode()).hexdigest()[:24]
    return f"user-email-verify:{user_id}:{digest}"


def _rate_key(user_id: uuid.UUID, email: str) -> str:
    digest = hashlib.sha256(email.encode()).hexdigest()[:24]
    return f"user-email-verify-rate:{user_id}:{digest}"


def _code_hash(user_id: uuid.UUID, email: str, code: str) -> str:
    payload = f"{user_id}:{email}:{code}".encode()
    return hmac.new(settings.SECRET_KEY.encode(), payload, hashlib.sha256).hexdigest()


async def list_user_emails(db: AsyncSession, user: User) -> list[str]:
    identity_emails = (
        await db.scalars(
            select(UserIdentity.email)
            .where(UserIdentity.user_id == user.id, UserIdentity.email.is_not(None))
            .distinct()
        )
    ).all()
    return sorted({user.email, *(email for email in identity_emails if email)})


async def _find_external_accounts(
    db: AsyncSession,
    *,
    user: User,
    email: str,
) -> list[User]:
    owner_ids = set(
        (await db.scalars(select(User.id).where(User.email == email, User.id != user.id))).all()
    )
    owner_ids.update(
        (
            await db.scalars(
                select(UserIdentity.user_id).where(
                    UserIdentity.email == email,
                    UserIdentity.user_id != user.id,
                )
            )
        ).all()
    )
    if not owner_ids:
        return []
    return list((await db.scalars(select(User).where(User.id.in_(owner_ids)))).all())


async def _ensure_self_mergeable(accounts: list[User]) -> User | None:
    if len(accounts) > 1:
        raise UserRegistrationError(409, "此 Email 同時對應多個帳戶，請由管理員處理")
    if not accounts:
        return None
    source = accounts[0]
    if not source.is_active:
        raise UserRegistrationError(409, "此 Email 屬於已停用帳戶，請由管理員處理")
    return source


async def request_verification(db: AsyncSession, user: User, email: str) -> None:
    normalized_email = email.strip().lower()
    if "@" not in normalized_email:
        raise UserRegistrationError(422, "Email 格式不正確")

    external_accounts = await _find_external_accounts(
        db,
        user=user,
        email=normalized_email,
    )
    await _ensure_self_mergeable(external_accounts)
    existing_identity = await db.scalar(
        select(UserIdentity).where(
            UserIdentity.email == normalized_email,
            UserIdentity.user_id == user.id,
        )
    )
    if existing_identity:
        raise UserRegistrationError(409, "此 Email 已連結到您的帳號")

    allowed = await redis_client.set(
        _rate_key(user.id, normalized_email),
        "1",
        ex=RESEND_COOLDOWN_SECONDS,
        nx=True,
    )
    if not allowed:
        raise UserRegistrationError(429, "驗證信已寄出，請稍候再重試")

    code = f"{secrets.randbelow(1_000_000):06d}"
    payload = json.dumps(
        {
            "email": normalized_email,
            "code_hash": _code_hash(user.id, normalized_email, code),
            "attempts": 0,
        }
    )
    await redis_client.setex(_pending_key(user.id, normalized_email), CODE_TTL_SECONDS, payload)
    send_branded_email(
        [normalized_email],
        "HCCA 登入 Email 驗證碼",
        "generic",
        {
            "heading": "驗證您的登入 Email",
            "preview_text": "登入 Email 驗證碼",
            "body_html": (
                f'<p>您的驗證碼是 <strong style="font-size:24px;">{code}</strong>。</p>'
                "<p>此驗證碼將於 10 分鐘後失效，請勿轉交他人。</p>"
            ),
            "show_system_footer": True,
        },
    )


async def verify_and_link(
    db: AsyncSession,
    *,
    user: User,
    email: str,
    code: str,
) -> User:
    normalized_email = email.strip().lower()
    key = _pending_key(user.id, normalized_email)
    raw = await redis_client.get(key)
    if not raw:
        raise UserRegistrationError(400, "驗證碼已失效，請重新寄送")

    payload = json.loads(raw)
    attempts = int(payload.get("attempts", 0))
    if attempts >= MAX_ATTEMPTS:
        await redis_client.delete(key)
        raise UserRegistrationError(400, "驗證失敗次數過多，請重新寄送")

    expected = str(payload.get("code_hash", ""))
    actual = _code_hash(user.id, normalized_email, code)
    if not hmac.compare_digest(expected, actual):
        payload["attempts"] = attempts + 1
        await redis_client.setex(key, CODE_TTL_SECONDS, json.dumps(payload))
        raise UserRegistrationError(400, "驗證碼不正確")

    external_accounts = await _find_external_accounts(
        db,
        user=user,
        email=normalized_email,
    )
    source = await _ensure_self_mergeable(external_accounts)
    if source is None:
        await link_user_emails(db, user=user, emails=[normalized_email], actor=user)
    else:
        try:
            await merge_user_accounts(
                db,
                user=user,
                source_user=source,
                actor=user,
            )
        except UserRegistrationError as exc:
            if exc.payload and exc.payload.get("conflicts"):
                raise UserRegistrationError(
                    409,
                    "帳戶資料有衝突，請由管理員在後台選擇要保留的資料",
                ) from exc
            raise
    await redis_client.delete(key)
    return user
