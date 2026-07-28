"""電子證件業務邏輯。"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.models.electronic_credential import ElectronicCredentialAuthorization
from api.models.user import User
from api.schemas.electronic_credential import (
    ElectronicCredentialAuthorizationBulkCreate,
    ElectronicCredentialAuthorizationBulkOut,
    ElectronicCredentialAuthorizationCreate,
    ElectronicCredentialAuthorizationOut,
    ElectronicCredentialAuthorizationUpdate,
    ElectronicCredentialOut,
)


def _normalized_email_set(values: list[str] | set[str]) -> set[str]:
    return {value.strip().lower() for value in values if value.strip()}


def identity_for_user(
    user: User, special_identity_label: str | None = None
) -> tuple[str, str] | None:
    """回傳電子證件身份別與顯示標籤；不符合資格時回傳 None。"""
    normalized_email = user.email.strip().lower()
    if special_identity_label:
        return "authorized", special_identity_label

    domain = normalized_email.rsplit("@", maxsplit=1)[-1] if "@" in normalized_email else ""
    campus_domains = {
        value.strip().lower().lstrip("@")
        for value in settings.LOGIN_ALLOWED_EMAIL_DOMAINS
        if value.strip()
    }
    if domain in campus_domains:
        is_student = bool(user.student_id) or normalized_email.startswith("g0")
        return ("student", "校內學生") if is_student else ("teacher", "校內師長")

    authorized_emails = (
        _normalized_email_set(settings.LOGIN_EMAIL_ALLOWLIST)
        | _normalized_email_set(settings.OWNER_EMAILS)
        | _normalized_email_set(settings.SUPERUSER_EMAILS)
    )
    if normalized_email in authorized_emails:
        return "authorized", "特別授權帳號"
    return None


async def _get_active_authorization(
    db: AsyncSession, email: str
) -> ElectronicCredentialAuthorization | None:
    result = await db.execute(
        select(ElectronicCredentialAuthorization).where(
            ElectronicCredentialAuthorization.email == email.strip().lower(),
            ElectronicCredentialAuthorization.is_active.is_(True),
        )
    )
    return result.scalar_one_or_none()


async def get_my_credential(db: AsyncSession, user: User) -> ElectronicCredentialOut | None:
    """取得當前使用者電子證件；資格由後端再次確認。"""
    if not user.is_active:
        return None
    authorization = await _get_active_authorization(db, user.email)
    identity = identity_for_user(user, authorization.identity_label if authorization else None)
    if identity is None:
        return None
    return ElectronicCredentialOut(
        display_name=user.display_name,
        email=user.email,
        student_id=user.student_id,
        identity_kind=identity[0],
        identity_label=identity[1],
        status_label="目前有效",
    )


async def _find_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(func.lower(User.email) == email))
    return result.scalar_one_or_none()


async def _authorization_out(
    db: AsyncSession, authorization: ElectronicCredentialAuthorization
) -> ElectronicCredentialAuthorizationOut:
    user = await _find_user_by_email(db, authorization.email)
    return ElectronicCredentialAuthorizationOut(
        id=str(authorization.id),
        email=authorization.email,
        display_name=user.display_name if user else None,
        student_id=user.student_id if user else None,
        identity_label=authorization.identity_label,
        note=authorization.note,
        is_active=authorization.is_active,
        created_at=authorization.created_at,
        updated_at=authorization.updated_at,
    )


async def list_authorizations(
    db: AsyncSession, *, include_inactive: bool = True
) -> list[ElectronicCredentialAuthorizationOut]:
    statement = select(ElectronicCredentialAuthorization).order_by(
        ElectronicCredentialAuthorization.is_active.desc(),
        ElectronicCredentialAuthorization.updated_at.desc(),
    )
    if not include_inactive:
        statement = statement.where(ElectronicCredentialAuthorization.is_active.is_(True))
    result = await db.execute(statement)
    authorizations = result.scalars().all()
    return [await _authorization_out(db, item) for item in authorizations]


async def create_authorization(
    db: AsyncSession,
    data: ElectronicCredentialAuthorizationCreate,
    actor_id: uuid.UUID,
) -> ElectronicCredentialAuthorizationOut:
    email = str(data.email).strip().lower()
    existing = await db.scalar(
        select(ElectronicCredentialAuthorization).where(
            ElectronicCredentialAuthorization.email == email
        )
    )
    if existing:
        raise ValueError("這個 Email 已有授權資料，請直接編輯原有項目。")

    authorization = ElectronicCredentialAuthorization(
        email=email,
        identity_label=data.identity_label.strip(),
        note=data.note.strip() if data.note else None,
        created_by=actor_id,
        updated_by=actor_id,
    )
    db.add(authorization)
    await db.flush()
    await db.refresh(authorization)
    return await _authorization_out(db, authorization)


async def create_authorizations(
    db: AsyncSession,
    data: ElectronicCredentialAuthorizationBulkCreate,
    actor_id: uuid.UUID,
) -> ElectronicCredentialAuthorizationBulkOut:
    emails = list(dict.fromkeys(str(email).strip().lower() for email in data.emails))
    existing_emails: set[str] = set()
    for offset in range(0, len(emails), 500):
        existing_emails.update(
            await db.scalars(
                select(ElectronicCredentialAuthorization.email).where(
                    ElectronicCredentialAuthorization.email.in_(emails[offset : offset + 500])
                )
            )
        )

    new_emails = [email for email in emails if email not in existing_emails]
    identity_label = data.identity_label.strip()
    note = data.note.strip() if data.note else None
    db.add_all(
        [
            ElectronicCredentialAuthorization(
                email=email,
                identity_label=identity_label,
                note=note,
                created_by=actor_id,
                updated_by=actor_id,
            )
            for email in new_emails
        ]
    )
    await db.flush()
    return ElectronicCredentialAuthorizationBulkOut(
        created_count=len(new_emails),
        skipped_emails=[email for email in emails if email in existing_emails],
    )


async def get_authorization(
    db: AsyncSession, authorization_id: uuid.UUID
) -> ElectronicCredentialAuthorization | None:
    return await db.get(ElectronicCredentialAuthorization, authorization_id)


async def update_authorization(
    db: AsyncSession,
    authorization: ElectronicCredentialAuthorization,
    data: ElectronicCredentialAuthorizationUpdate,
    actor_id: uuid.UUID,
) -> ElectronicCredentialAuthorizationOut:
    fields = data.model_dump(exclude_unset=True)
    if "email" in fields:
        email = str(fields["email"]).strip().lower()
        existing = await db.scalar(
            select(ElectronicCredentialAuthorization).where(
                ElectronicCredentialAuthorization.email == email,
                ElectronicCredentialAuthorization.id != authorization.id,
            )
        )
        if existing:
            raise ValueError("這個 Email 已有其他授權資料。")
        fields["email"] = email
    if "identity_label" in fields and fields["identity_label"] is not None:
        fields["identity_label"] = fields["identity_label"].strip()
    if "note" in fields and fields["note"]:
        fields["note"] = fields["note"].strip()
    for key, value in fields.items():
        setattr(authorization, key, value)
    authorization.updated_by = actor_id
    await db.flush()
    await db.refresh(authorization)
    return await _authorization_out(db, authorization)
