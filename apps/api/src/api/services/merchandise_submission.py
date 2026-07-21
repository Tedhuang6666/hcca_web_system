"""校商投稿業務邏輯。"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.config import settings as app_settings
from api.models.announcement import Announcement, AnnouncementAudience
from api.models.merchandise_submission import (
    MerchandiseSubmission,
    MerchandiseSubmissionFile,
    MerchandiseSubmissionItem,
    MerchandiseSubmissionSettings,
    MerchandiseSubmissionStatus,
)
from api.models.org import Org
from api.models.survey import QuestionType, Survey, SurveyQuestion, SurveyStatus
from api.models.user import User
from api.schemas.merchandise_submission import (
    MerchandiseSubmissionItemCreate,
    MerchandiseSubmissionItemUpdate,
    MerchandiseSubmissionReview,
    MerchandiseSubmissionSave,
    MerchandiseSubmissionSettingsUpdate,
)
from api.services.storage import get_storage


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


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


async def update_settings(
    session: AsyncSession,
    settings: MerchandiseSubmissionSettings,
    data: MerchandiseSubmissionSettingsUpdate,
    *,
    updated_by_id: uuid.UUID,
) -> MerchandiseSubmissionSettings:
    fields = data.model_dump(exclude_unset=True)
    if "global_fields" in fields and fields["global_fields"] is not None:
        fields["global_fields"] = [field.model_dump() for field in data.global_fields or []]
    for field, value in fields.items():
        setattr(settings, field, value)
    if settings.opens_at and settings.closes_at and settings.opens_at >= settings.closes_at:
        raise ValueError("全站截止時間必須晚於開放時間")
    settings.updated_by_id = updated_by_id
    await sync_announcement(session, settings, author_id=updated_by_id)
    await session.flush()
    return settings


def _announcement_content(message: str) -> dict:
    return {"format": "markdown", "markdown": message}


async def sync_announcement(
    session: AsyncSession,
    settings: MerchandiseSubmissionSettings,
    *,
    author_id: uuid.UUID,
) -> None:
    message = (settings.announcement or "").strip()
    announcement = (
        await session.get(Announcement, settings.announcement_id)
        if settings.announcement_id
        else None
    )
    if not message:
        if announcement:
            announcement.is_published = False
            announcement.is_urgent = False
        return
    if announcement is None:
        announcement = Announcement(id=uuid.uuid4(), author_id=author_id)
        session.add(announcement)
        settings.announcement_id = announcement.id
    announcement.title = (settings.announcement_title or "校商投稿公告").strip()
    announcement.content = _announcement_content(message)
    announcement.is_published = True
    announcement.is_urgent = settings.show_announcement_popup
    announcement.urgent_until = settings.closes_at if settings.show_announcement_popup else None
    announcement.link_url = "/merchandise-submissions"
    announcement.link_label = "前往投稿"
    announcement.show_on_every_visit = settings.show_announcement_popup
    announcement.org_id = None
    # 投稿資格可限定校務信箱，但公告仍是全站公告，確保公告模組可正常檢視。
    announcement.audience_type = AnnouncementAudience.ALL.value
    if announcement.published_at is None:
        announcement.published_at = datetime.now(UTC)


def effective_config(
    settings: MerchandiseSubmissionSettings, item: MerchandiseSubmissionItem
) -> tuple[bool, datetime | None, datetime | None, int]:
    is_open = (
        item.is_open_override
        if item.is_open_override is not None
        else settings.is_open or settings.opens_at is not None or settings.closes_at is not None
    )
    opens_at = item.opens_at_override if item.opens_at_override is not None else settings.opens_at
    closes_at = (
        item.closes_at_override if item.closes_at_override is not None else settings.closes_at
    )
    max_mb = item.max_file_size_mb_override or settings.max_file_size_mb
    now = datetime.now(UTC)
    accepting = (
        item.is_active
        and is_open
        and (opens_at is None or now >= _as_utc(opens_at))
        and (closes_at is None or now <= _as_utc(closes_at))
    )
    return accepting, opens_at, closes_at, max_mb


def effective_custom_fields(
    settings: MerchandiseSubmissionSettings, item: MerchandiseSubmissionItem
) -> list[dict]:
    """合併全域欄位與品項覆寫；同 key 的品項設定優先。"""
    fields: dict[str, dict] = {}
    for field in settings.global_fields:
        fields[str(field["key"])] = dict(field)
    for field in item.custom_fields:
        fields[str(field["key"])] = dict(field)
    return list(fields.values())


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
            selectinload(MerchandiseSubmission.voting_survey),
            selectinload(MerchandiseSubmission.files),
        )
        .where(MerchandiseSubmission.id == submission_id)
    )
    return (await session.execute(query)).scalar_one_or_none()


async def get_submission_file(
    session: AsyncSession, storage_key: str
) -> MerchandiseSubmissionFile | None:
    query = (
        select(MerchandiseSubmissionFile)
        .options(selectinload(MerchandiseSubmissionFile.submission))
        .where(MerchandiseSubmissionFile.storage_key == storage_key)
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
            selectinload(MerchandiseSubmission.voting_survey),
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
        selectinload(MerchandiseSubmission.voting_survey),
        selectinload(MerchandiseSubmission.files),
    )
    if status:
        query = query.where(MerchandiseSubmission.status == status)
    query = query.order_by(MerchandiseSubmission.submitted_at.desc().nullslast())
    return list((await session.scalars(query)).all())


def validate_submission_values(
    fields: list[dict], values: dict[str, str], *, require_required_fields: bool = True
) -> None:
    configured = {str(field["key"]): field for field in fields}
    unexpected = set(values) - set(configured)
    if unexpected:
        raise ValueError("含有未設定的投稿欄位")
    for key, field in configured.items():
        value = values.get(key, "").strip()
        if require_required_fields and field.get("required") and not value:
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
    validate_submission_values(
        effective_custom_fields(settings, item),
        data.field_values,
        require_required_fields=submit,
    )
    if submit and not data.files:
        raise ValueError("請至少上傳一個圖稿檔案")
    storage_prefix = f"merchandise-submissions/{user.id}/"
    if any(not file.storage_key.startswith(storage_prefix) for file in data.files):
        raise ValueError("投稿檔案來源不正確")
    if len({file.storage_key for file in data.files}) != len(data.files):
        raise ValueError("投稿檔案不可重複")

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
    session.expire(submission, ["files"])
    return (await get_submission(session, submission.id)) or submission


async def update_submission(
    session: AsyncSession,
    submission: MerchandiseSubmission,
    data: MerchandiseSubmissionSave,
    *,
    user: User,
    submit: bool,
) -> MerchandiseSubmission:
    if submission.user_id != user.id:
        raise PermissionError("只能編輯自己的投稿")
    if submission.status not in {
        MerchandiseSubmissionStatus.DRAFT,
        MerchandiseSubmissionStatus.REVISION_REQUESTED,
    }:
        raise ValueError("此投稿已進入審核流程，無法再編輯")
    if data.item_id != submission.item_id:
        raise ValueError("編輯投稿時不可更換品項")
    item = submission.item or await get_item(session, submission.item_id)
    if item is None:
        raise LookupError("找不到投稿品項")
    settings = await get_settings(session)
    require_eligible_submitter(settings, user)
    accepting, _, _, _ = effective_config(settings, item)
    if submit and not accepting:
        raise ValueError("此品項目前未開放投稿")
    validate_submission_values(
        effective_custom_fields(settings, item),
        data.field_values,
        require_required_fields=submit,
    )
    if submit and not data.files:
        raise ValueError("請至少上傳一個圖稿檔案")
    storage_prefix = f"merchandise-submissions/{user.id}/"
    if any(not file.storage_key.startswith(storage_prefix) for file in data.files):
        raise ValueError("投稿檔案來源不正確")
    if len({file.storage_key for file in data.files}) != len(data.files):
        raise ValueError("投稿檔案不可重複")
    existing_files = {file.storage_key: file for file in submission.files}
    submitted_keys = {file.storage_key for file in data.files}
    for storage_key, existing in existing_files.items():
        if storage_key not in submitted_keys:
            await session.delete(existing)
    submission.field_values = {key: value.strip() for key, value in data.field_values.items()}
    submission.status = (
        MerchandiseSubmissionStatus.SUBMITTED if submit else MerchandiseSubmissionStatus.DRAFT
    )
    submission.submitted_at = datetime.now(UTC) if submit else None
    for file in data.files:
        existing = existing_files.get(file.storage_key)
        if existing:
            existing.filename = file.filename
            existing.content_type = file.content_type
            existing.file_size = file.file_size
            continue
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
    session.expire(submission, ["files"])
    return (await get_submission(session, submission.id)) or submission


async def admin_upload_submission_file(
    session: AsyncSession,
    submission: MerchandiseSubmission,
    upload: UploadFile,
    *,
    replace_file_id: uuid.UUID | None = None,
) -> MerchandiseSubmission:
    """由管理員替投稿增加或替換檔案，不受投稿開放狀態限制。"""
    if replace_file_id is not None:
        target = next((file for file in submission.files if file.id == replace_file_id), None)
        if target is None:
            raise LookupError("找不到投稿檔案")
    elif len(submission.files) >= 10:
        raise ValueError("投稿最多只能有 10 個檔案")
    else:
        target = None

    settings = await get_settings(session)
    item = submission.item or await get_item(session, submission.item_id)
    if item is None:
        raise LookupError("找不到投稿品項")
    _, _, _, max_mb = effective_config(settings, item)
    storage = get_storage()
    stored = await storage.save(
        upload,
        prefix=f"merchandise-submissions/{submission.user_id}",
        max_file_size=max_mb * 1024 * 1024,
        allowed_content_types={"image/jpeg", "image/png", "image/webp", "application/pdf"},
    )

    old_storage_key = target.storage_key if target else None
    if target is None:
        session.add(
            MerchandiseSubmissionFile(
                submission_id=submission.id,
                storage_key=stored.storage_key,
                filename=stored.filename,
                content_type=stored.content_type,
                file_size=stored.file_size,
            )
        )
    else:
        target.storage_key = stored.storage_key
        target.filename = stored.filename
        target.content_type = stored.content_type
        target.file_size = stored.file_size
    await session.flush()
    if old_storage_key:
        await storage.delete(old_storage_key)
    session.expire(submission, ["files"])
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
    if data.voting_survey_id is not None:
        survey = await session.get(Survey, data.voting_survey_id)
        if survey is None:
            raise ValueError("找不到指定的投票問卷")
        if survey.status not in {SurveyStatus.DRAFT, SurveyStatus.OPEN}:
            raise ValueError("投票問卷必須是草稿或開放中")
        submission.voting_survey_id = survey.id
        submission.voting_survey = survey
    submission.status = MerchandiseSubmissionStatus(data.status)
    submission.review_note = data.review_note.strip() if data.review_note else None
    submission.reviewer_id = reviewer_id
    submission.reviewed_at = datetime.now(UTC)
    await session.flush()
    return (await get_submission(session, submission.id)) or submission


async def prepare_voting_survey(
    session: AsyncSession,
    *,
    org_id: uuid.UUID,
    created_by: uuid.UUID,
    title: str,
    description: str | None,
) -> Survey:
    org = await session.get(Org, org_id)
    if org is None:
        raise ValueError("找不到票選問卷所屬組織")
    linked_survey = await session.scalar(
        select(Survey)
        .join(MerchandiseSubmission, MerchandiseSubmission.voting_survey_id == Survey.id)
        .where(
            MerchandiseSubmission.status == MerchandiseSubmissionStatus.REVIEW_COMPLETED,
            MerchandiseSubmission.voting_survey_id.is_not(None),
        )
        .limit(1)
    )
    if linked_survey is not None:
        raise ValueError("目前已有校商投稿票選問卷，請先確認或發布現有問卷")
    result = await session.execute(
        select(MerchandiseSubmission)
        .options(
            selectinload(MerchandiseSubmission.item),
            selectinload(MerchandiseSubmission.files),
        )
        .where(MerchandiseSubmission.status == MerchandiseSubmissionStatus.REVIEW_COMPLETED)
        .order_by(MerchandiseSubmission.item_id, MerchandiseSubmission.submitted_at)
    )
    submissions = list(result.scalars().all())
    if not submissions:
        raise ValueError("目前沒有審核完成、可加入票選的投稿")

    survey = Survey(
        title=title.strip(),
        description=description or "請依序查看每個品項的投稿圖案，選出您喜歡的一個或多個圖案。",
        status=SurveyStatus.DRAFT,
        is_anonymous=False,
        allow_multiple=False,
        org_id=org.id,
        created_by=created_by,
    )
    session.add(survey)
    await session.flush()

    grouped: dict[uuid.UUID, list[MerchandiseSubmission]] = {}
    for submission in submissions:
        grouped.setdefault(submission.item_id, []).append(submission)
    for order_index, item_submissions in enumerate(grouped.values()):
        item = item_submissions[0].item
        options: list[str] = []
        image_sets: list[list[str]] = []
        for index, submission in enumerate(item_submissions, start=1):
            label = f"圖案 {index}｜{submission.account_snapshot.get('display_name') or '匿名投稿'}"
            options.append(label)
            image_sets.append(
                [
                    f"/merchandise-submissions/uploads/{file.storage_key}"
                    for file in submission.files
                ]
            )
            submission.voting_survey = survey
        question_text = item.name
        if item.description:
            question_text += f"\n{item.description.strip()}"
        question_text += "\n請選擇您喜歡的一個或多個圖案。"
        session.add(
            SurveyQuestion(
                survey_id=survey.id,
                order_index=order_index,
                question_text=question_text[:1000],
                question_type=QuestionType.MULTIPLE,
                is_required=True,
                options_json=json.dumps(options, ensure_ascii=False),
                option_image_sets_json=json.dumps(image_sets, ensure_ascii=False),
            )
        )
    await session.flush()
    return (await session.get(Survey, survey.id)) or survey
