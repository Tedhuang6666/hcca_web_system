"""特約商家申請業務邏輯。"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.partner_business_application import (
    PartnerApplicationField,
    PartnerApplicationFieldType,
    PartnerApplicationSettings,
    PartnerBusinessApplication,
)
from api.schemas.partner_business_application import (
    PartnerApplicationSettingsUpdate,
    PartnerBusinessApplicationCreate,
    PartnerBusinessApplicationReview,
)
from api.services.discord_embeds import EmbedField, Severity
from api.services.discord_notification_routes import emit_routed_notification

DEFAULT_FIELDS: tuple[dict[str, object], ...] = (
    {
        "key": "business_name",
        "label": "商家名稱",
        "field_type": PartnerApplicationFieldType.TEXT.value,
        "required": True,
        "placeholder": "例如：晨光咖啡",
        "sort_order": 10,
    },
    {
        "key": "contact_name",
        "label": "聯絡人",
        "field_type": PartnerApplicationFieldType.TEXT.value,
        "required": True,
        "placeholder": "方便我們稱呼您",
        "sort_order": 20,
    },
    {
        "key": "contact_email",
        "label": "聯絡 Email",
        "field_type": PartnerApplicationFieldType.EMAIL.value,
        "required": True,
        "placeholder": "name@example.com",
        "sort_order": 30,
    },
    {
        "key": "contact_phone",
        "label": "聯絡電話",
        "field_type": PartnerApplicationFieldType.TEL.value,
        "required": False,
        "placeholder": "選填",
        "sort_order": 40,
    },
    {
        "key": "cooperation_summary",
        "label": "合作想法",
        "field_type": PartnerApplicationFieldType.TEXTAREA.value,
        "required": True,
        "placeholder": "請簡單介紹合作內容、學生優惠或希望討論的方向",
        "sort_order": 50,
    },
)


def _settings_query():
    return (
        select(PartnerApplicationSettings)
        .options(selectinload(PartnerApplicationSettings.fields))
        .order_by(PartnerApplicationSettings.created_at)
    )


async def get_settings(db: AsyncSession) -> PartnerApplicationSettings:
    settings = await db.scalar(_settings_query())
    if settings is not None:
        return settings

    settings = PartnerApplicationSettings()
    settings.fields = [PartnerApplicationField(**field) for field in DEFAULT_FIELDS]
    db.add(settings)
    await db.flush()
    await db.refresh(settings, ["fields"])
    return settings


async def update_settings(
    db: AsyncSession, body: PartnerApplicationSettingsUpdate, updated_by: uuid.UUID
) -> PartnerApplicationSettings:
    settings = await get_settings(db)
    values = body.model_dump(exclude_unset=True, exclude={"fields"})
    for key, value in values.items():
        setattr(settings, key, value)
    settings.updated_by = updated_by

    if body.fields is not None:
        fields_by_key = {field.key: field for field in settings.fields}
        submitted_keys = set()
        for config in body.fields:
            submitted_keys.add(config.key)
            field = fields_by_key.get(config.key)
            data = config.model_dump()
            if field is None:
                field = PartnerApplicationField(settings_id=settings.id, **data)
                settings.fields.append(field)
            else:
                for key, value in data.items():
                    setattr(field, key, value)
        for field in settings.fields:
            if field.key not in submitted_keys:
                field.is_active = False

    await db.flush()
    return await get_settings(db)


def _validate_value(field: PartnerApplicationField, value: str) -> str:
    cleaned = value.strip()
    if len(cleaned) > 4000:
        raise ValueError(f"欄位「{field.label}」內容不可超過 4000 字")
    if field.field_type == PartnerApplicationFieldType.EMAIL.value and not re.fullmatch(
        r"[^@\s]+@[^@\s]+\.[^@\s]+", cleaned
    ):
        raise ValueError(f"欄位「{field.label}」請填寫有效 Email")
    if field.field_type == PartnerApplicationFieldType.URL.value and not cleaned.startswith(
        ("https://", "http://")
    ):
        raise ValueError(f"欄位「{field.label}」請填寫完整網址")
    if (
        field.field_type == PartnerApplicationFieldType.SELECT.value
        and cleaned not in field.options
    ):
        raise ValueError(f"欄位「{field.label}」包含未提供的選項")
    return cleaned


async def create_application(
    db: AsyncSession,
    body: PartnerBusinessApplicationCreate,
    submitted_by: uuid.UUID | None,
) -> tuple[PartnerBusinessApplication, int]:
    settings = await get_settings(db)
    if not settings.is_open:
        raise ValueError("目前暫停受理特約商家申請")

    active_fields = [field for field in settings.fields if field.is_active]
    field_by_key = {field.key: field for field in active_fields}
    unknown_keys = set(body.field_values) - set(field_by_key)
    if unknown_keys:
        raise ValueError("申請包含尚未啟用的欄位")

    values: dict[str, str] = {}
    for field in active_fields:
        raw_value = body.field_values.get(field.key, "")
        if not isinstance(raw_value, str):
            raise ValueError(f"欄位「{field.label}」格式不正確")
        cleaned = _validate_value(field, raw_value)
        if field.required and not cleaned:
            raise ValueError(f"請填寫「{field.label}」")
        values[field.key] = cleaned

    application = PartnerBusinessApplication(field_values=values, submitted_by=submitted_by)
    db.add(application)
    await db.flush()

    discord_fields: list[EmbedField] = [
        {"name": field.label, "value": values.get(field.key) or "（未填寫）"}
        for field in active_fields
    ]
    business_name = values.get("business_name") or "未命名商家"
    sent = await emit_routed_notification(
        db,
        event_key="partner_application.submitted",
        module="shop",
        title=f"特約商家申請：{business_name}",
        body="公開頁收到一筆新的特約商家合作申請，請至後台審核。",
        link="/partner-map/admin/applications",
        fields=discord_fields,
        severity=Severity.INFO,
    )
    return application, sent


async def list_applications(
    db: AsyncSession, status: str | None = None
) -> list[PartnerBusinessApplication]:
    stmt = select(PartnerBusinessApplication).order_by(PartnerBusinessApplication.created_at.desc())
    if status:
        stmt = stmt.where(PartnerBusinessApplication.status == status)
    return list((await db.execute(stmt)).scalars().all())


async def review_application(
    db: AsyncSession,
    application: PartnerBusinessApplication,
    body: PartnerBusinessApplicationReview,
    reviewer_id: uuid.UUID,
) -> PartnerBusinessApplication:
    application.status = body.status.value
    application.review_note = body.review_note
    application.business_id = body.business_id
    application.reviewed_by = reviewer_id
    application.reviewed_at = datetime.now(UTC)
    await db.flush()
    return application


async def get_application(
    db: AsyncSession, application_id: uuid.UUID
) -> PartnerBusinessApplication | None:
    return await db.get(PartnerBusinessApplication, application_id)


__all__ = [
    "DEFAULT_FIELDS",
    "create_application",
    "get_application",
    "get_settings",
    "list_applications",
    "review_application",
    "update_settings",
]
