"""管理員預先建立使用者的業務邏輯。"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.permission_codes import validate_permission_codes
from api.models.org import Org, Permission, Position, PositionCategory, UserPosition
from api.models.person import PersonAffiliationKind, PersonAffiliationSource
from api.models.user import User
from api.models.user_identity import UserIdentity
from api.services import audit as audit_svc
from api.services import person as person_svc

SCHOOL_EMAIL_DOMAIN = "hchs.hc.edu.tw"


class UserRegistrationError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def student_id_from_school_email(email: str) -> str | None:
    local_part, separator, domain = email.strip().lower().partition("@")
    if separator and domain == SCHOOL_EMAIL_DOMAIN and local_part.startswith("g0"):
        student_id = local_part[2:]
        return student_id or None
    return None


async def pre_register_user(
    db: AsyncSession,
    *,
    student_id: str | None,
    email: str | None,
    linked_emails: list[str],
    display_name: str,
    position_ids: list[uuid.UUID],
    custom_permission_org_id: uuid.UUID | None,
    custom_permission_codes: list[str],
    start_date: date,
    end_date: date | None,
    actor: User,
) -> User:
    normalized_student_id = student_id.strip() if student_id else None
    normalized_email = email.strip().lower() if email else None
    if not normalized_email:
        if not normalized_student_id:
            raise UserRegistrationError(422, "未提供 email 時，student_id 為必填")
        normalized_email = f"g0{normalized_student_id}@{SCHOOL_EMAIL_DOMAIN}"

    all_emails = list(
        dict.fromkeys(
            address.strip().lower()
            for address in [normalized_email, *linked_emails]
            if address and address.strip()
        )
    )
    school_student_ids = {
        parsed
        for address in all_emails
        if (parsed := student_id_from_school_email(address)) is not None
    }
    if len(school_student_ids) > 1:
        raise UserRegistrationError(422, "多個校內 Email 對應到不同學號")
    parsed_student_id = next(iter(school_student_ids), None)
    if normalized_student_id and parsed_student_id and normalized_student_id != parsed_student_id:
        raise UserRegistrationError(422, "填寫的學號與校內 Email 不一致")
    normalized_student_id = normalized_student_id or parsed_student_id

    conditions = [User.email.in_(all_emails)]
    if normalized_student_id:
        conditions.append(User.student_id == normalized_student_id)
    duplicate = await db.scalar(select(User).where(or_(*conditions)))
    if duplicate:
        raise UserRegistrationError(409, "學號或 Email 已存在")
    linked_duplicate = await db.scalar(
        select(UserIdentity).where(UserIdentity.email.in_(all_emails))
    )
    if linked_duplicate:
        raise UserRegistrationError(409, "其中一個 Email 已連結其他帳號")

    positions: list[Position] = []
    if position_ids:
        result = await db.execute(
            select(Position)
            .options(selectinload(Position.org))
            .where(Position.id.in_(position_ids))
        )
        positions = list(result.scalars().all())
        position_map = {position.id: position for position in positions}
        for position_id in position_ids:
            position = position_map.get(position_id)
            if not position:
                raise UserRegistrationError(404, f"職位 {position_id} 不存在")
            if position.org and not position.org.is_active:
                raise UserRegistrationError(
                    409,
                    f"職位 {position.name} 所屬組織已停用，無法指派",
                )

    permission_codes = sorted(set(custom_permission_codes))
    custom_org: Org | None = None
    if permission_codes:
        invalid_codes = validate_permission_codes(permission_codes)
        if invalid_codes:
            raise UserRegistrationError(422, f"存在未知權限碼：{', '.join(invalid_codes)}")
        if custom_permission_org_id is None:
            raise UserRegistrationError(422, "使用自訂權限時，custom_permission_org_id 為必填")
        custom_org = await db.get(Org, custom_permission_org_id)
        if custom_org is None:
            raise UserRegistrationError(404, "自訂權限組織不存在")
        if not custom_org.is_active:
            raise UserRegistrationError(409, "自訂權限組織已停用，無法使用")

    user = User(
        email=normalized_email,
        display_name=display_name.strip(),
        student_id=normalized_student_id,
        is_verified=False,
        is_active=True,
        is_superuser=False,
    )
    db.add(user)
    await db.flush()

    now = datetime.now(UTC)
    for address in all_emails:
        db.add(
            UserIdentity(
                user_id=user.id,
                provider="email",
                external_id=address,
                email=address,
                display_name=user.display_name,
                linked_at=now,
            )
        )

    for position in positions:
        assignment = UserPosition(
            user_id=user.id,
            position_id=position.id,
            start_date=start_date,
            end_date=end_date,
        )
        db.add(assignment)
        await db.flush()
        await person_svc.record_affiliation_for_user_position(
            db,
            user=user,
            kind=PersonAffiliationKind.ORG_POSITION,
            position_id=position.id,
            start_date=assignment.start_date,
            end_date=assignment.end_date,
            synced_user_position_id=assignment.id,
            source=PersonAffiliationSource.RBAC_SYNC,
        )

    if permission_codes and custom_org:
        custom_position = Position(
            org_id=custom_org.id,
            name=f"外部協作-{user.display_name}",
            description=f"系統自動建立：{user.email} 的自訂權限職位",
            category=PositionCategory.SYSTEM,
        )
        db.add(custom_position)
        await db.flush()
        for code in permission_codes:
            db.add(Permission(position_id=custom_position.id, code=code))
        db.add(
            UserPosition(
                user_id=user.id,
                position_id=custom_position.id,
                start_date=start_date,
                end_date=end_date,
            )
        )

    await db.flush()
    await audit_svc.record(
        db,
        entity_type="user",
        entity_id=str(user.id),
        action="user.pre_register",
        actor_id=str(actor.id),
        actor_email=actor.email,
        meta={
            "email": user.email,
            "linked_emails": all_emails,
            "student_id": user.student_id,
            "position_ids": [str(position_id) for position_id in position_ids],
            "custom_permission_codes": permission_codes,
            "custom_permission_org_id": (
                str(custom_permission_org_id) if custom_permission_org_id else None
            ),
        },
        summary=f"預先建立使用者「{user.display_name}」",
    )
    return user


async def link_user_emails(
    db: AsyncSession,
    *,
    user: User,
    emails: list[str],
    actor: User,
) -> User:
    normalized_emails = list(
        dict.fromkeys(address.strip().lower() for address in emails if address.strip())
    )
    if not normalized_emails:
        raise UserRegistrationError(422, "請至少提供一個 Email")

    other_user = await db.scalar(
        select(User).where(User.email.in_(normalized_emails), User.id != user.id)
    )
    if other_user:
        raise UserRegistrationError(409, "其中一個 Email 已是其他帳號的主要 Email")
    other_identity = await db.scalar(
        select(UserIdentity).where(
            UserIdentity.email.in_(normalized_emails),
            UserIdentity.user_id != user.id,
        )
    )
    if other_identity:
        raise UserRegistrationError(409, "其中一個 Email 已連結其他帳號")

    school_student_ids = {
        parsed
        for address in normalized_emails
        if (parsed := student_id_from_school_email(address)) is not None
    }
    if len(school_student_ids) > 1:
        raise UserRegistrationError(422, "多個校內 Email 對應到不同學號")
    parsed_student_id = next(iter(school_student_ids), None)
    if user.student_id and parsed_student_id and user.student_id != parsed_student_id:
        raise UserRegistrationError(422, "校內 Email 的學號與帳號既有學號不一致")
    if parsed_student_id and not user.student_id:
        user.student_id = parsed_student_id

    existing_emails = set(
        (
            await db.scalars(
                select(UserIdentity.email).where(
                    UserIdentity.user_id == user.id,
                    UserIdentity.email.in_(normalized_emails),
                )
            )
        ).all()
    )
    now = datetime.now(UTC)
    for address in normalized_emails:
        if address not in existing_emails:
            db.add(
                UserIdentity(
                    user_id=user.id,
                    provider="email",
                    external_id=address,
                    email=address,
                    display_name=user.display_name,
                    linked_at=now,
                )
            )
    await db.flush()
    await audit_svc.record(
        db,
        entity_type="user",
        entity_id=str(user.id),
        action="user.email_link",
        actor_id=str(actor.id),
        actor_email=actor.email,
        meta={"emails": normalized_emails},
        summary=f"連結使用者「{user.display_name}」的登入 Email",
    )
    return user
