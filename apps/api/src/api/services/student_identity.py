"""從登入帳戶與已驗證的綁定身分辨識學生，不變更學號或 RBAC 歸屬。"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.user import User
from api.models.user_identity import UserIdentity
from api.services.user_registration import student_id_from_school_email


async def has_student_identity(session: AsyncSession, user: User) -> bool:
    if user.student_id or student_id_from_school_email(user.email):
        return True
    emails = await session.scalars(
        select(UserIdentity.email).where(
            UserIdentity.user_id == user.id,
            UserIdentity.email.is_not(None),
        )
    )
    return any(student_id_from_school_email(email) for email in emails if email)
