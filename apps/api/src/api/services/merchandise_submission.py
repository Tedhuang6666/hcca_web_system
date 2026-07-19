"""校商投稿業務邏輯。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.config import settings as app_settings
from api.models.merchandise_submission import (
    MerchandiseSubmission,
    MerchandiseSubmissionFile,
    MerchandiseSubmissionItem,
    MerchandiseSubmissionSettings,
    MerchandiseSubmissionStatus,
)
from api.models.user import User
from api.schemas.merchandise_submission import (
    MerchandiseSubmissionItemCreate,
    MerchandiseSubmissionItemUpdate,
    MerchandiseSubmissionReview,
    MerchandiseSubmissionSave,
    MerchandiseSubmissionSettingsUpdate,
)


async def get_settings(session: AsyncSession) -> MerchandiseSubmissionSettings:
    settings = await session.scalar(select(MerchandiseSubmissionSettings).limit(1))
    if settings is None:
        settings = MerchandiseSubmissionSettings()
        session.add(settings)
        await session.flush()
    return settings


def is_school_email(user: User) -> bool:
    domain = user.email.rsplit("@", 1)[-1].lower() if "@" in user.email else ""
    return domain in {item.lower().lstrip("@") for item in app_settings.LOGIN_ALLOWED_EMAIL_DOMAINS}


def can_submit(settings: MerchandiseSubmissionSettings, user: User) -> bool:
    return not settings.require_school_email or is_school_email(user)


def require_eligible_submitter(settings: MerchandiseSubmissionSettings, user: User) -> None:
    if not can_submit(settings, user):
        raise PermissionError("本次校商投稿僅限使用校務信箱登入的帳號")


async def update_settings(
    session: AsyncSession,
    settings: MerchandiseSubmissionSettings,
    data: MerchandiseSubmissionSettingsUpdate,
    *,
    updated_by_id: uuid.UUID,
) -> MerchandiseSubmissionSettings:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(settings, field, value)
    if settings.opens_at and settings.closes_at and settings.opens_at >= settings.closes_at:
        raise ValueError("全站截止時間必須晚於開放時間")
    settings.updated_by_id = updated_by_id
    await session.flush()
    return settings


def effective_config(
    settings: MerchandiseSubmissionSettings, item: MerchandiseSubmissionItem
) -> tuple[bool, datetime | None, datetime | None, int]:
    is_open = item.is_open_override if item.is_open_override is not None else settings.is_open
    opens_at = item.opens_at_override if item.opens_at_override is not None else settings.opens_at
    closes_at = (
        item.closes_at_override if item.closes_at_override is not None else settings.closes_at
    )
    max_mb = item.max_file_size_mb_override or settings.max_file_size_mb
    now = datetime.now(UTC)
    accepting = (
        item.is_active
        and is_open
        and (opens_at is None or now >= opens_at)
        and (closes_at is None or now <= closes_at)
    )
    return accepting, opens_at, closes_at, max_mb


async def list_items(
    session: AsyncSession, *, include_inactive: bool
) -> list[MerchandiseSubmissionItem]:
    query = select(MerchandiseSubmissionItem).order_by(
        MerchandiseSubmissionItem.sort_order, MerchandiseSubmissionItem.created_at
    )
    if not include_inactive:
        query = query.where(MerchandiseSubmissionItem.is_active == True)  # noqa: E712
    return list((await session.scalars(query)).all())


async def get_item(session: AsyncSession, item_id: uuid.UUID) -> MerchandiseSubmissionItem | None:
    return await session.get(MerchandiseSubmissionItem, item_id)


async def create_item(
    session: AsyncSession, data: MerchandiseSubmissionItemCreate, *, created_by_id: uuid.UUID
) -> MerchandiseSubmissionItem:
    item = MerchandiseSubmissionItem(
        **data.model_dump(exclude={"template_images", "custom_fields"}),
        template_images=[image.model_dump() for image in data.template_images],
        custom_fields=[field.model_dump() for field in data.custom_fields],
        created_by_id=created_by_id,
    )
    _validate_item_times(item)
    session.add(item)
    await session.flush()
    return item


async def update_item(
    session: AsyncSession, item: MerchandiseSubmissionItem, data: MerchandiseSubmissionItemUpdate
) -> MerchandiseSubmissionItem:
    fields = data.model_dump(exclude_unset=True)
    if "template_images" in fields and fields["template_images"] is not None:
        fields["template_images"] = [image.model_dump() for image in data.template_images or []]
    if "custom_fields" in fields and fields["custom_fields"] is not None:
        fields["custom_fields"] = [field.model_dump() for field in data.custom_fields or []]
    for field, value in fields.items():
        setattr(item, field, value)
    _validate_item_times(item)
    await session.flush()
    return item


def _validate_item_times(item: MerchandiseSubmissionItem) -> None:
    if (
        item.opens_at_override
        and item.closes_at_override
        and item.opens_at_override >= item.closes_at_override
    ):
        raise ValueError("品項截止時間必須晚於開放時間")


async def get_submission(
    session: AsyncSession, submission_id: uuid.UUID
) -> MerchandiseSubmission | None:
    query = (
        select(MerchandiseSubmission)
        .options(
            selectinload(MerchandiseSubmission.item),
            selectinload(MerchandiseSubmission.user),
            selectinload(MerchandiseSubmission.reviewer),
            selectinload(MerchandiseSubmission.files),
        )
        .where(MerchandiseSubmission.id == submission_id)
    )
    return (await session.execute(query)).scalar_one_or_none()


async def list_my_submissions(
    session: AsyncSession, *, user_id: uuid.UUID
) -> list[MerchandiseSubmission]:
    query = (
        select(MerchandiseSubmission)
        .options(
            selectinload(MerchandiseSubmission.item),
            selectinload(MerchandiseSubmission.reviewer),
            selectinload(MerchandiseSubmission.files),
        )
        .where(MerchandiseSubmission.user_id == user_id)
        .order_by(MerchandiseSubmission.updated_at.desc())
    )
    return list((await session.scalars(query)).all())


async def list_submissions(
    session: AsyncSession, *, status: MerchandiseSubmissionStatus | None = None
) -> list[MerchandiseSubmission]:
    query = select(MerchandiseSubmission).options(
        selectinload(MerchandiseSubmission.item),
        selectinload(MerchandiseSubmission.user),
        selectinload(MerchandiseSubmission.reviewer),
        selectinload(MerchandiseSubmission.files),
    )
    if status:
        query = query.where(MerchandiseSubmission.status == status)
    query = query.order_by(MerchandiseSubmission.submitted_at.desc().nullslast())
    return list((await session.scalars(query)).all())


def validate_submission_values(item: MerchandiseSubmissionItem, values: dict[str, str]) -> None:
    configured = {str(field["key"]): field for field in item.custom_fields}
    unexpected = set(values) - set(configured)
    if unexpected:
        raise ValueError("含有未設定的投稿欄位")
    for key, field in configured.items():
        value = values.get(key, "").strip()
        if field.get("required") and not value:
            raise ValueError(f"請填寫「{field['label']}」")
        if len(value) > int(field.get("max_length", 200)):
            raise ValueError(f"「{field['label']}」超過字數上限")


async def save_submission(
    session: AsyncSession,
    data: MerchandiseSubmissionSave,
    *,
    user: User,
    submit: bool,
) -> MerchandiseSubmission:
    item = await get_item(session, data.item_id)
    if item is None:
        raise LookupError("找不到投稿品項")
    settings = await get_settings(session)
    require_eligible_submitter(settings, user)
    accepting, _, _, _ = effective_config(settings, item)
    if submit and not accepting:
        raise ValueError("此品項目前未開放投稿")
    validate_submission_values(item, data.field_values)
    if submit and not data.files:
        raise ValueError("請至少上傳一個圖稿檔案")
    storage_prefix = f"merchandise-submissions/{user.id}/"
    if any(not file.storage_key.startswith(storage_prefix) for file in data.files):
        raise ValueError("投稿檔案來源不正確")

    submission = MerchandiseSubmission(
        item_id=item.id,
        user_id=user.id,
        status=MerchandiseSubmissionStatus.SUBMITTED
        if submit
        else MerchandiseSubmissionStatus.DRAFT,
        account_snapshot={
            "display_name": user.display_name,
            "email": user.email,
            "student_id": user.student_id or "",
        },
        field_values={key: value.strip() for key, value in data.field_values.items()},
        submitted_at=datetime.now(UTC) if submit else None,
    )
    session.add(submission)
    await session.flush()
    for file in data.files:
        session.add(
            MerchandiseSubmissionFile(
                submission_id=submission.id,
                storage_key=file.storage_key,
                filename=file.filename,
                content_type=file.content_type,
                file_size=file.file_size,
            )
        )
    await session.flush()
    return (await get_submission(session, submission.id)) or submission


async def review_submission(
    session: AsyncSession,
    submission: MerchandiseSubmission,
    data: MerchandiseSubmissionReview,
    *,
    reviewer_id: uuid.UUID,
) -> MerchandiseSubmission:
    if submission.status == MerchandiseSubmissionStatus.DRAFT:
        raise ValueError("草稿尚未送出，不能審核")
    submission.status = MerchandiseSubmissionStatus(data.status)
    submission.review_note = data.review_note.strip() if data.review_note else None
    submission.reviewer_id = reviewer_id
    submission.reviewed_at = datetime.now(UTC)
    await session.flush()
    return (await get_submission(session, submission.id)) or submission
