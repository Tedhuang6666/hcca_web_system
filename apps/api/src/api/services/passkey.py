"""Passkey/WebAuthn business logic.

The WebAuthn cryptographic ceremony is delegated to ``webauthn``. Redis only
holds short-lived, one-time challenges; credentials and counters stay in SQL.
"""

from __future__ import annotations

import base64
import json
import logging
import secrets
import uuid
from typing import Any

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import options_to_json
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from api.core.config import settings
from api.core.security import decode_token, is_blacklisted, redis_client
from api.models.passkey import PasskeyCredential
from api.models.user import User

logger = logging.getLogger(__name__)

_CHALLENGE_PREFIX = "webauthn:"


def _b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _unb64url(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _expected_origins() -> list[str]:
    return list(dict.fromkeys([settings.PASSKEY_ORIGIN, *settings.PASSKEY_ALLOWED_ORIGINS]))


def _challenge_key(transaction_id: str) -> str:
    return f"{_CHALLENGE_PREFIX}{transaction_id}"


async def _save_challenge(
    *,
    challenge: bytes,
    user_id: uuid.UUID | None,
    mode: str,
    challenge_token: str | None = None,
) -> str:
    transaction_id = secrets.token_urlsafe(24)
    payload = {
        "challenge": _b64url(challenge),
        "user_id": str(user_id) if user_id else None,
        "mode": mode,
        "challenge_token": challenge_token,
    }
    await redis_client.setex(
        _challenge_key(transaction_id),
        settings.PASSKEY_CHALLENGE_TTL_SECONDS,
        json.dumps(payload),
    )
    return transaction_id


async def _consume_challenge(transaction_id: str) -> dict[str, Any] | None:
    raw = await redis_client.getdel(_challenge_key(transaction_id))
    if not raw:
        return None
    try:
        payload = json.loads(raw)
        payload["challenge"] = _unb64url(payload["challenge"])
        return payload
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        return None


async def registration_options(db: AsyncSession, user: User) -> dict[str, Any]:
    credentials = (
        await db.scalars(select(PasskeyCredential).where(PasskeyCredential.user_id == user.id))
    ).all()
    options = generate_registration_options(
        rp_id=settings.PASSKEY_RP_ID,
        rp_name=settings.PASSKEY_RP_NAME,
        user_name=user.email,
        user_id=user.id.bytes,
        user_display_name=user.display_name or user.email,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=[
            PublicKeyCredentialDescriptor(id=item.credential_id) for item in credentials
        ],
        challenge=secrets.token_bytes(32),
    )
    transaction_id = await _save_challenge(
        challenge=options.challenge,
        user_id=user.id,
        mode="registration",
    )
    return {"transaction_id": transaction_id, "options": json.loads(options_to_json(options))}


async def verify_registration(
    db: AsyncSession,
    user: User,
    transaction_id: str,
    credential: dict[str, Any],
    device_name: str | None,
) -> PasskeyCredential | None:
    stored = await _consume_challenge(transaction_id)
    if not stored or stored.get("mode") != "registration":
        return None
    if stored.get("user_id") != str(user.id):
        return None
    try:
        verification = verify_registration_response(
            credential=credential,
            expected_challenge=stored["challenge"],
            expected_rp_id=settings.PASSKEY_RP_ID,
            expected_origin=_expected_origins(),
            require_user_verification=True,
        )
    except Exception:
        logger.warning("Passkey registration verification failed", extra={"user_id": str(user.id)})
        return None

    duplicate = await db.scalar(
        select(exists().where(PasskeyCredential.credential_id == verification.credential_id))
    )
    if duplicate:
        return None
    response = credential.get("response", {})
    passkey = PasskeyCredential(
        user_id=user.id,
        credential_id=verification.credential_id,
        public_key=verification.credential_public_key,
        sign_count=verification.sign_count,
        device_name=(device_name or "Passkey").strip()[:100] or "Passkey",
        transports=response.get("transports") or [],
        backed_up=verification.credential_backed_up,
        aaguid=verification.aaguid,
    )
    db.add(passkey)
    await db.flush()
    logger.info(
        "Passkey registered",
        extra={"user_id": str(user.id), "credential_id": _b64url(passkey.credential_id)},
    )
    return passkey


async def authentication_options(
    db: AsyncSession,
    *,
    user: User | None,
    mode: str,
    challenge_token: str | None = None,
) -> dict[str, Any]:
    credentials = []
    if user:
        credentials = (
            await db.scalars(select(PasskeyCredential).where(PasskeyCredential.user_id == user.id))
        ).all()
    options = generate_authentication_options(
        rp_id=settings.PASSKEY_RP_ID,
        challenge=secrets.token_bytes(32),
        allow_credentials=[
            PublicKeyCredentialDescriptor(id=item.credential_id) for item in credentials
        ]
        or None,
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    transaction_id = await _save_challenge(
        challenge=options.challenge,
        user_id=user.id if user else None,
        mode=mode,
        challenge_token=challenge_token,
    )
    return {"transaction_id": transaction_id, "options": json.loads(options_to_json(options))}


async def verify_authentication(
    db: AsyncSession,
    transaction_id: str,
    credential: dict[str, Any],
) -> tuple[User, str, str | None] | None:
    stored = await _consume_challenge(transaction_id)
    if not stored or stored.get("mode") not in {"login", "verify"}:
        return None
    try:
        credential_id = _unb64url(str(credential.get("rawId") or credential["id"]))
    except (KeyError, ValueError, TypeError):
        return None
    passkey = await db.scalar(
        select(PasskeyCredential).where(PasskeyCredential.credential_id == credential_id)
    )
    if passkey is None:
        return None
    if stored.get("user_id") and stored["user_id"] != str(passkey.user_id):
        return None
    try:
        verification = verify_authentication_response(
            credential=credential,
            expected_challenge=stored["challenge"],
            expected_rp_id=settings.PASSKEY_RP_ID,
            expected_origin=_expected_origins(),
            credential_public_key=passkey.public_key,
            credential_current_sign_count=passkey.sign_count,
            require_user_verification=True,
        )
    except Exception:
        logger.warning(
            "Passkey authentication verification failed",
            extra={"credential_id": _b64url(credential_id)},
        )
        return None
    if passkey.sign_count and verification.new_sign_count < passkey.sign_count:
        logger.error(
            "Passkey sign counter rollback detected",
            extra={"credential_id": _b64url(credential_id)},
        )
        return None
    passkey.mark_used(verification.new_sign_count)
    await db.flush()
    user = await db.get(User, passkey.user_id)
    if user is None or not user.is_active:
        return None
    return user, str(stored["mode"]), stored.get("challenge_token")


async def list_credentials(db: AsyncSession, user: User) -> list[PasskeyCredential]:
    return list(
        (
            await db.scalars(
                select(PasskeyCredential)
                .where(PasskeyCredential.user_id == user.id)
                .order_by(PasskeyCredential.created_at.desc())
            )
        ).all()
    )


async def delete_credential(db: AsyncSession, user: User, credential_id: str) -> bool:
    try:
        raw_id = _unb64url(credential_id)
    except (ValueError, TypeError):
        return False
    passkey = await db.scalar(
        select(PasskeyCredential).where(
            PasskeyCredential.user_id == user.id,
            PasskeyCredential.credential_id == raw_id,
        )
    )
    if passkey is None:
        return False
    await db.delete(passkey)
    await db.flush()
    logger.info("Passkey deleted", extra={"user_id": str(user.id), "credential_id": credential_id})
    return True


async def requires_mfa(db: AsyncSession, user: User) -> bool:
    if user.mfa_enabled:
        return True
    return bool(await db.scalar(select(exists().where(PasskeyCredential.user_id == user.id))))


async def resolve_mfa_challenge_user(db: AsyncSession, challenge_token: str) -> User | None:
    if await is_blacklisted(challenge_token):
        return None
    try:
        payload = decode_token(challenge_token)
    except Exception:
        return None
    if payload.get("type") != "mfa_challenge" or not payload.get("sub"):
        return None
    try:
        user_id = uuid.UUID(str(payload["sub"]))
    except ValueError:
        return None
    user = await db.get(User, user_id)
    return user if user and user.is_active else None


def credential_out(item: PasskeyCredential) -> dict[str, Any]:
    return {
        "id": str(item.id),
        "credential_id": _b64url(item.credential_id),
        "device_name": item.device_name,
        "transports": item.transports,
        "backed_up": item.backed_up,
        "created_at": item.created_at,
        "last_used_at": item.last_used_at,
    }
