"""陳情負責人通知規則與收件人解析。"""

from __future__ import annotations

import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.org import Org
from api.models.petition import PetitionCase, PetitionType
from api.models.petition_notification import PetitionNotificationRule, PetitionNotificationSettings
from api.models.user import User
from api.schemas.petition_notification import (
    PetitionNotificationRuleCreate,
    PetitionNotificationRuleUpdate,
    PetitionNotificationSettingsUpdate,
)


def _normalise_ids(values: list[uuid.UUID]) -> list[uuid.UUID]:
    return list(dict.fromkeys(values))


async def _active_user_ids(session: AsyncSession, values: list[uuid.UUID]) -> list[uuid.UUID]:
    values = _normalise_ids(values)
    if not values:
        return []
    result = await session.scalars(
        select(User.id).where(User.id.in_(values), User.is_active.is_(True))
    )
    valid = set(result.all())
    return [user_id for user_id in values if user_id in valid]


async def _validate_scope(
    session: AsyncSession, *, petition_type_id: uuid.UUID | None, org_id: uuid.UUID | None
) -> None:
    if petition_type_id is None and org_id is None:
        raise ValueError("通知規則必須指定一個陳情類型或負責機關")
    if petition_type_id is not None and org_id is not None:
        raise ValueError("通知規則不可同時指定陳情類型與負責機關")
    model = PetitionType if petition_type_id is not None else Org
    target_id = petition_type_id or org_id
    if await session.get(model, target_id) is None:
        raise LookupError("找不到通知規則指定的陳情類型或負責機關")


async def get_settings(session: AsyncSession) -> PetitionNotificationSettings:
    settings = await session.scalar(select(PetitionNotificationSettings).limit(1))
    if settings is None:
        settings = PetitionNotificationSettings()
        session.add(settings)
        await session.flush()
    return settings


async def update_settings(
    session: AsyncSession,
    settings: PetitionNotificationSettings,
    data: PetitionNotificationSettingsUpdate,
    *,
    updated_by_id: uuid.UUID,
) -> PetitionNotificationSettings:
    settings.enabled = data.enabled
    settings.recipient_user_ids = [
        str(user_id) for user_id in await _active_user_ids(session, data.recipient_user_ids)
    ]
    settings.updated_by_id = updated_by_id
    await session.flush()
    return settings


async def list_rules(session: AsyncSession) -> list[PetitionNotificationRule]:
    result = await session.scalars(
        select(PetitionNotificationRule)
        .where(PetitionNotificationRule.is_active.is_(True))
        .order_by(PetitionNotificationRule.org_id, PetitionNotificationRule.petition_type_id)
    )
    return list(result.all())


async def create_rule(
    session: AsyncSession,
    data: PetitionNotificationRuleCreate,
    *,
    updated_by_id: uuid.UUID,
) -> PetitionNotificationRule:
    await _validate_scope(session, petition_type_id=data.petition_type_id, org_id=data.org_id)
    rule = PetitionNotificationRule(
        petition_type_id=data.petition_type_id,
        org_id=data.org_id,
        enabled=data.enabled,
        recipient_user_ids=[
            str(user_id) for user_id in await _active_user_ids(session, data.recipient_user_ids)
        ],
        updated_by_id=updated_by_id,
    )
    session.add(rule)
    await session.flush()
    return rule


async def update_rule(
    session: AsyncSession,
    rule: PetitionNotificationRule,
    data: PetitionNotificationRuleUpdate,
    *,
    updated_by_id: uuid.UUID,
) -> PetitionNotificationRule:
    values = data.model_dump(exclude_unset=True)
    if "recipient_user_ids" in values and values["recipient_user_ids"] is not None:
        rule.recipient_user_ids = [
            str(user_id)
            for user_id in await _active_user_ids(session, data.recipient_user_ids or [])
        ]
    for field in ("enabled", "is_active"):
        if field in values:
            setattr(rule, field, values[field])
    rule.updated_by_id = updated_by_id
    await session.flush()
    return rule


async def delete_rule(session: AsyncSession, rule: PetitionNotificationRule) -> None:
    await session.delete(rule)
    await session.flush()


async def resolve_recipient_ids(session: AsyncSession, case_obj: PetitionCase) -> list[uuid.UUID]:
    """依序套用「承辦人 > 類型 > 負責機關 > 全域」規則，回傳有效收件人。"""
    if case_obj.assigned_to_id:
        return await _active_user_ids(session, [case_obj.assigned_to_id])

    settings = await get_settings(session)
    rule_result = await session.scalars(
        select(PetitionNotificationRule).where(
            PetitionNotificationRule.is_active.is_(True),
            or_(
                PetitionNotificationRule.petition_type_id == case_obj.type_id,
                PetitionNotificationRule.org_id == case_obj.current_org_id,
            ),
        )
    )
    rules = list(rule_result.all())
    type_rule = next((rule for rule in rules if rule.petition_type_id == case_obj.type_id), None)
    rule = type_rule or next(
        (rule for rule in rules if rule.org_id == case_obj.current_org_id), None
    )
    if rule is not None:
        if not rule.enabled:
            return []
        recipient_ids = await _active_user_ids(
            session, [uuid.UUID(str(user_id)) for user_id in rule.recipient_user_ids]
        )
    else:
        if not settings.enabled:
            return []
        recipient_ids = await _active_user_ids(
            session, [uuid.UUID(str(user_id)) for user_id in settings.recipient_user_ids]
        )
    return recipient_ids
