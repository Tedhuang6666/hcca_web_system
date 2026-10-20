"""從登入帳戶與已驗證的綁定身分辨識現行學生，不變更學號或 RBAC 歸屬。"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.user import User
from api.models.user_identity import UserIdentity
from api.services.electronic_credential import get_settings
from api.services.student_identity_rules import (
    is_current_student_id,
    is_g0_school_account_email,
    student_id_from_school_email,
)


async def has_student_identity(session: AsyncSession, user: User) -> bool:
    if is_g0_school_account_email(user.email):
        current_prefixes = (await get_settings(session)).student_id_prefixes
        return is_current_student_id(student_id_from_school_email(user.email), current_prefixes)
    if user.student_id:
        return True
    emails = await session.scalars(
        select(UserIdentity.email).where(
            UserIdentity.user_id == user.id,
            UserIdentity.email.is_not(None),
        )
    )
    linked_student_ids = [
        student_id
        for email in emails
        if email and (student_id := student_id_from_school_email(email)) is not None
    ]
    if not linked_student_ids:
        return False
    current_prefixes = (await get_settings(session)).student_id_prefixes
    return any(
        is_current_student_id(student_id, current_prefixes) for student_id in linked_student_ids
    )
