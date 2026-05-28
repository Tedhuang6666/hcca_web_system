"""Passkey / WebAuthn endpoints."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.core.database import get_db
from api.core.security import create_access_token, create_refresh_token
from api.dependencies.auth import get_current_active_user
from api.models.passkey import PasskeyCredential, WebAuthnChallenge
from api.models.user import User
from api.routers.auth import _access_token_claims, _auth_user_payload, _set_auth_cookies

router = APIRouter(prefix="/auth/passkeys", tags=["Passkeys"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


class PasskeyCredentialOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    last_used_at: datetime | None
    created_at: datetime


class PasskeyFinishRequest(BaseModel):
    credential: dict[str, Any]
    name: str | None = None


class PasskeyLoginStartRequest(BaseModel):
    email: str


class PasskeyLoginFinishRequest(BaseModel):
    credential: dict[str, Any]


def _json_options(options: object) -> dict[str, Any]:
    from webauthn import options_to_json

    return json.loads(options_to_json(options))


def _challenge_value(options: dict[str, Any]) -> str:
    return str(options["challenge"])


async def _store_challenge(
    db: AsyncSession, *, challenge: str, purpose: str, user_id: uuid.UUID | None
) -> None:
    db.add(
        WebAuthnChallenge(
            challenge=challenge,
            purpose=purpose,
            user_id=user_id,
            expires_at=datetime.now(UTC) + timedelta(minutes=5),
        )
    )
    await db.flush()


@router.get("", response_model=list[PasskeyCredentialOut], summary="列出我的 Passkeys")
async def list_passkeys(db: DbDep, current_user: CurrentUser) -> list[PasskeyCredentialOut]:
    rows = (
        await db.execute(
            select(PasskeyCredential)
            .where(PasskeyCredential.user_id == current_user.id)
            .order_by(PasskeyCredential.created_at.desc())
        )
    ).scalars()
    return [PasskeyCredentialOut.model_validate(row) for row in rows]


@router.post("/registration/options", summary="建立 Passkey 註冊 options")
async def registration_options(db: DbDep, current_user: CurrentUser) -> dict[str, Any]:
    from webauthn import generate_registration_options
    from webauthn.helpers.structs import (
        AuthenticatorSelectionCriteria,
        PublicKeyCredentialDescriptor,
        ResidentKeyRequirement,
        UserVerificationRequirement,
    )

    existing = (
        await db.execute(
            select(PasskeyCredential).where(PasskeyCredential.user_id == current_user.id)
        )
    ).scalars()
    options = generate_registration_options(
        rp_id=settings.PASSKEY_RP_ID,
        rp_name=settings.PASSKEY_RP_NAME,
        user_id=str(current_user.id).encode("utf-8"),
        user_name=current_user.email,
        user_display_name=current_user.display_name,
        exclude_credentials=[
            PublicKeyCredentialDescriptor(id=row.credential_id) for row in existing
        ],
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
    )
    payload = _json_options(options)
    await _store_challenge(
        db, challenge=_challenge_value(payload), purpose="registration", user_id=current_user.id
    )
    return payload


@router.post(
    "/registration/verify", response_model=PasskeyCredentialOut, summary="完成 Passkey 註冊"
)
async def verify_registration(
    body: PasskeyFinishRequest, db: DbDep, current_user: CurrentUser
) -> PasskeyCredentialOut:
    from webauthn import base64url_to_bytes, verify_registration_response

    if not body.credential.get("response", {}).get("clientDataJSON"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passkey 回應格式錯誤")

    challenge = (
        await db.execute(
            select(WebAuthnChallenge)
            .where(WebAuthnChallenge.user_id == current_user.id)
            .where(WebAuthnChallenge.purpose == "registration")
            .order_by(WebAuthnChallenge.created_at.desc())
        )
    ).scalar_one_or_none()
    if challenge is None or challenge.is_expired:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passkey 挑戰已失效")

    verification = verify_registration_response(
        credential=body.credential,
        expected_challenge=base64url_to_bytes(challenge.challenge),
        expected_origin=settings.PASSKEY_ORIGIN,
        expected_rp_id=settings.PASSKEY_RP_ID,
        require_user_verification=False,
    )
    await db.delete(challenge)
    row = PasskeyCredential(
        user_id=current_user.id,
        credential_id=verification.credential_id,
        public_key=verification.credential_public_key,
        sign_count=verification.sign_count,
        name=body.name or "Passkey",
        aaguid=str(getattr(verification, "aaguid", "")) or None,
    )
    db.add(row)
    await db.flush()
    return PasskeyCredentialOut.model_validate(row)


@router.post("/authentication/options", summary="建立 Passkey 登入 options")
async def authentication_options(body: PasskeyLoginStartRequest, db: DbDep) -> dict[str, Any]:
    from webauthn import generate_authentication_options
    from webauthn.helpers.structs import PublicKeyCredentialDescriptor, UserVerificationRequirement

    user = (
        await db.execute(select(User).where(User.email == body.email.strip().lower()))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="帳號不存在")

    credentials = (
        await db.execute(select(PasskeyCredential).where(PasskeyCredential.user_id == user.id))
    ).scalars()
    options = generate_authentication_options(
        rp_id=settings.PASSKEY_RP_ID,
        allow_credentials=[
            PublicKeyCredentialDescriptor(id=row.credential_id) for row in credentials
        ],
        user_verification=UserVerificationRequirement.PREFERRED,
    )
    payload = _json_options(options)
    await _store_challenge(
        db, challenge=_challenge_value(payload), purpose="authentication", user_id=user.id
    )
    return payload


@router.post("/authentication/verify", summary="完成 Passkey 登入")
async def verify_authentication(
    body: PasskeyLoginFinishRequest, response: Response, db: DbDep
) -> dict[str, Any]:
    from webauthn import base64url_to_bytes, verify_authentication_response

    raw_id = body.credential.get("rawId") or body.credential.get("id")
    if not raw_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passkey 回應格式錯誤")

    credential_id = base64url_to_bytes(raw_id)
    row = (
        await db.execute(
            select(PasskeyCredential).where(PasskeyCredential.credential_id == credential_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Passkey 不存在")

    challenge = (
        await db.execute(
            select(WebAuthnChallenge)
            .where(WebAuthnChallenge.user_id == row.user_id)
            .where(WebAuthnChallenge.purpose == "authentication")
            .order_by(WebAuthnChallenge.created_at.desc())
        )
    ).scalar_one_or_none()
    if challenge is None or challenge.is_expired:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passkey 挑戰已失效")

    verification = verify_authentication_response(
        credential=body.credential,
        expected_challenge=base64url_to_bytes(challenge.challenge),
        expected_origin=settings.PASSKEY_ORIGIN,
        expected_rp_id=settings.PASSKEY_RP_ID,
        credential_public_key=row.public_key,
        credential_current_sign_count=row.sign_count,
        require_user_verification=False,
    )
    await db.delete(challenge)
    row.mark_used(verification.new_sign_count)
    user = await db.get(User, row.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="帳號不存在或已停用")

    access_token = create_access_token(
        subject=str(user.id),
        extra_claims=await _access_token_claims(db, user),
    )
    refresh_token = create_refresh_token(subject=str(user.id))
    _set_auth_cookies(response, access_token, refresh_token)
    await db.flush()
    return {"user": await _auth_user_payload(db, user), "next": "/"}


@router.delete("/{credential_id}", summary="刪除我的 Passkey")
async def delete_passkey(credential_id: uuid.UUID, db: DbDep, current_user: CurrentUser) -> None:
    row = (
        await db.execute(
            select(PasskeyCredential)
            .where(PasskeyCredential.id == credential_id)
            .where(PasskeyCredential.user_id == current_user.id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Passkey 不存在")
    await db.delete(row)
    await db.flush()
