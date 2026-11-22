"""首次登入時由學生本人設定或確認班級，不授予班級幹部權限。"""

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.models.class_confirmation import ClassConfirmation
from api.models.school_class import ClassRosterEntry, SchoolClass
from api.models.user import User
from api.schemas.class_confirmation import ClassConfirmationCreate, ClassConfirmationOut
from api.schemas.school_class import (
    ClassMembershipCreate,
    ClassRosterEntryCreate,
    MySchoolClassOut,
    SchoolClassListItem,
)
from api.services import school_class as class_svc
from api.services.electronic_credential import get_settings, identity_for_user


async def is_eligible(session: AsyncSession, user: User) -> bool:
    if (
        not user.is_active
        or user.is_superuser
        or user.email.strip().lower() in settings.OWNER_EMAILS
    ):
        return False
    credential_settings = await get_settings(session)
    identity = identity_for_user(user, student_id_prefixes=credential_settings.student_id_prefixes)
    return identity is not None and identity[0] == "student"


async def requires_confirmation(session: AsyncSession, user: User) -> bool:
    if not await is_eligible(session, user):
        return False
    confirmation = await session.scalar(
        select(ClassConfirmation)
        .where(ClassConfirmation.user_id == user.id)
        .order_by(ClassConfirmation.created_at.desc(), ClassConfirmation.id.desc())
        .limit(1)
    )
    if confirmation is None or confirmation.student_id != user.student_id:
        return True
    school_class = await class_svc.resolve_user_class(session, user)
    return (
        school_class is None
        or confirmation.class_id != school_class.id
        or confirmation.seat_number
        != await class_svc.get_user_class_seat_number(session, school_class, user)
    )


async def get_confirmation(session: AsyncSession, user: User) -> ClassConfirmationOut:
    if not await is_eligible(session, user):
        return ClassConfirmationOut(
            required=False, student_id=user.student_id, current_class=None, class_options=[]
        )
    school_class = await class_svc.resolve_user_class(session, user)
    current_class = None
    if school_class is not None:
        current_class = MySchoolClassOut.model_validate(school_class)
        current_class.seat_number = await class_svc.get_user_class_seat_number(
            session, school_class, user
        )
    return ClassConfirmationOut(
        required=await requires_confirmation(session, user),
        student_id=user.student_id,
        current_class=current_class,
        class_options=[
            SchoolClassListItem.model_validate(item)
            for item in await class_svc.list_classes(session, is_active=True)
        ],
    )


async def confirm_class(
    session: AsyncSession, user: User, data: ClassConfirmationCreate
) -> ClassConfirmationOut:
    # 同一帳戶與同一班級的確認依序處理；名冊的 unique constraint 另防管理端競態。
    await session.execute(select(User.id).where(User.id == user.id).with_for_update())
    student_id = user.student_id
    if student_id is None or not await is_eligible(session, user):
        raise PermissionError("僅在校學生可自行確認班級座號")
    school_class = await session.scalar(
        select(SchoolClass).where(SchoolClass.id == data.class_id).with_for_update()
    )
    if school_class is None or not school_class.is_active:
        raise ValueError("請選擇目前有效的班級")

    current = await class_svc.resolve_user_class(session, user)
    if not await requires_confirmation(session, user):
        seat = await class_svc.get_user_class_seat_number(session, school_class, user)
        if current is not None and current.id == school_class.id and seat == data.seat_number:
            return await get_confirmation(session, user)
        raise ValueError("已確認班級；如需更正，請從個人資料提出班級更正申請")

    entries = list(
        await session.scalars(
            select(ClassRosterEntry).where(
                ClassRosterEntry.class_id == school_class.id,
                or_(
                    ClassRosterEntry.user_id == user.id,
                    ClassRosterEntry.student_id == student_id,
                    ClassRosterEntry.seat_number == data.seat_number,
                ),
            )
        )
    )
    own_entry = None
    for entry in entries:
        if entry.student_id != student_id or entry.user_id not in (None, user.id):
            raise ValueError("此座號或名冊已歸屬其他學生，請確認座號或聯絡管理員")
        if own_entry is not None:
            raise ValueError("班級名冊有重複歸戶，請聯絡管理員")
        own_entry = entry

    if current is None or current.id != school_class.id:
        await class_svc.reassign_user_class(session, user.id, school_class)
    if own_entry is None:
        loaded_class = await class_svc.get_class(session, school_class.id)
        if loaded_class is None:
            raise ValueError("請選擇目前有效的班級")
        await class_svc.add_roster_entry(
            session,
            loaded_class,
            data=ClassRosterEntryCreate(student_id=student_id, seat_number=data.seat_number),
        )
    else:
        own_entry.user_id = user.id
        own_entry.seat_number = data.seat_number
        await class_svc.add_membership(
            session, school_class, data=ClassMembershipCreate(user_id=user.id, source="roster")
        )
    session.add(
        ClassConfirmation(
            user_id=user.id,
            class_id=school_class.id,
            student_id=student_id,
            seat_number=data.seat_number,
        )
    )
    await session.flush()
    return await get_confirmation(session, user)
