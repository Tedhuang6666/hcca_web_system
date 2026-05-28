"""Defense rule service — database source of truth plus Redis projection."""

from __future__ import annotations

import ipaddress
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core import defense as defense_cache
from api.models.defense import DefenseRule, DefenseRuleType
from api.models.user import User
from api.services import audit as audit_svc


def _now() -> datetime:
    return datetime.now(UTC)


def _serialize_rule(rule: DefenseRule) -> dict[str, Any]:
    return {
        "id": str(rule.id),
        "rule_type": rule.rule_type,
        "target": rule.target,
        "is_active": rule.is_active,
        "reason": rule.reason,
        "config": rule.config or {},
        "expires_at": rule.expires_at.timestamp() if rule.expires_at else None,
        "created_by": str(rule.created_by) if rule.created_by else None,
        "updated_by": str(rule.updated_by) if rule.updated_by else None,
        "created_at": rule.created_at.isoformat(),
        "updated_at": rule.updated_at.isoformat(),
    }


def _validate_target(rule_type: str, target: str) -> None:
    try:
        parsed = DefenseRuleType(rule_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="未知的防禦規則類型") from exc

    if parsed in {DefenseRuleType.IP_BLOCK, DefenseRuleType.IP_ALLOW}:
        try:
            ipaddress.ip_address(target)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="target 必須是有效 IP") from exc
    elif parsed == DefenseRuleType.CIDR_BLOCK:
        try:
            ipaddress.ip_network(target, strict=False)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="target 必須是有效 CIDR") from exc
    elif parsed in {
        DefenseRuleType.RATE_LIMIT_OVERRIDE,
        DefenseRuleType.ENDPOINT_LOCKDOWN,
        DefenseRuleType.BOT_CHALLENGE_PLACEHOLDER,
    } and not target.startswith("/"):
        raise HTTPException(status_code=422, detail="target 必須是路徑前綴，例如 /auth/")


async def sync_active_rules(session: AsyncSession) -> list[dict[str, Any]]:
    """Publish active, unexpired DB rules to Redis for middleware."""
    now = _now()
    result = await session.execute(
        select(DefenseRule)
        .where(
            DefenseRule.is_active.is_(True),
            (DefenseRule.expires_at.is_(None)) | (DefenseRule.expires_at > now),
        )
        .order_by(DefenseRule.created_at.desc())
    )
    rules = [_serialize_rule(rule) for rule in result.scalars().all()]
    await defense_cache.publish_rules(rules)
    return rules


async def cleanup_expired_rules(session: AsyncSession, actor: User | None = None) -> int:
    now = _now()
    result = await session.execute(
        select(DefenseRule).where(
            DefenseRule.is_active.is_(True),
            DefenseRule.expires_at.is_not(None),
            DefenseRule.expires_at <= now,
        )
    )
    rows = list(result.scalars().all())
    for rule in rows:
        rule.is_active = False
        rule.updated_by = actor.id if actor else rule.updated_by
    if rows:
        await session.flush()
        await sync_active_rules(session)
    return len(rows)


async def list_rules(
    session: AsyncSession, *, active_only: bool = False, limit: int = 100, offset: int = 0
) -> list[DefenseRule]:
    await cleanup_expired_rules(session)
    q = select(DefenseRule).order_by(DefenseRule.created_at.desc())
    if active_only:
        now = _now()
        q = q.where(
            DefenseRule.is_active.is_(True),
            (DefenseRule.expires_at.is_(None)) | (DefenseRule.expires_at > now),
        )
    result = await session.execute(q.limit(limit).offset(offset))
    return list(result.scalars().all())


async def create_rule(
    session: AsyncSession,
    *,
    actor: User,
    rule_type: str,
    target: str,
    reason: str = "",
    config: dict[str, Any] | None = None,
    expires_at: datetime | None = None,
) -> DefenseRule:
    target = target.strip()
    _validate_target(rule_type, target)
    rule = DefenseRule(
        rule_type=rule_type,
        target=target,
        reason=reason.strip(),
        config=config or {},
        expires_at=expires_at,
        created_by=actor.id,
        updated_by=actor.id,
    )
    session.add(rule)
    await session.flush()
    await audit_svc.record(
        session,
        entity_type="defense_rule",
        entity_id=str(rule.id),
        action="create",
        actor_id=str(actor.id),
        actor_email=actor.email,
        meta=_serialize_rule(rule),
        summary=f"建立防禦規則 {rule.rule_type} {rule.target}",
    )
    await sync_active_rules(session)
    return rule


async def update_rule(
    session: AsyncSession,
    *,
    actor: User,
    rule_id: uuid.UUID,
    updates: dict[str, Any],
) -> DefenseRule:
    rule = await session.get(DefenseRule, rule_id)
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="防禦規則不存在")

    new_type = updates.get("rule_type", rule.rule_type)
    new_target = updates.get("target", rule.target)
    _validate_target(str(new_type), str(new_target).strip())

    for field in ("rule_type", "target", "is_active", "reason", "config", "expires_at"):
        if field in updates:
            value = updates[field]
            if field in {"target", "reason"} and isinstance(value, str):
                value = value.strip()
            setattr(rule, field, value)
    rule.updated_by = actor.id
    await session.flush()
    await audit_svc.record(
        session,
        entity_type="defense_rule",
        entity_id=str(rule.id),
        action="update",
        actor_id=str(actor.id),
        actor_email=actor.email,
        meta=_serialize_rule(rule),
        summary=f"更新防禦規則 {rule.rule_type} {rule.target}",
    )
    await sync_active_rules(session)
    return rule


async def deactivate_rule(session: AsyncSession, *, actor: User, rule_id: uuid.UUID) -> DefenseRule:
    rule = await session.get(DefenseRule, rule_id)
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="防禦規則不存在")
    rule.is_active = False
    rule.updated_by = actor.id
    await session.flush()
    await audit_svc.record(
        session,
        entity_type="defense_rule",
        entity_id=str(rule.id),
        action="deactivate",
        actor_id=str(actor.id),
        actor_email=actor.email,
        meta=_serialize_rule(rule),
        summary=f"停用防禦規則 {rule.rule_type} {rule.target}",
    )
    await sync_active_rules(session)
    return rule


async def set_rate_limit_config(
    session: AsyncSession, *, actor: User, config: dict[str, Any]
) -> dict[str, Any]:
    stored = await defense_cache.set_rate_limit_config(config)
    await audit_svc.record(
        session,
        entity_type="defense_rule",
        entity_id="rate_limit",
        action="set_rate_limit",
        actor_id=str(actor.id),
        actor_email=actor.email,
        meta=stored,
        summary="更新全站限流策略",
    )
    return stored


async def summary(session: AsyncSession) -> dict[str, Any]:
    active_rules = await sync_active_rules(session)
    by_type: dict[str, int] = {}
    for rule in active_rules:
        rule_type = str(rule.get("rule_type"))
        by_type[rule_type] = by_type.get(rule_type, 0) + 1

    total_result = await session.execute(select(func.count()).select_from(DefenseRule))
    return {
        "active_rule_count": len(active_rules),
        "total_rule_count": int(total_result.scalar_one() or 0),
        "active_by_type": by_type,
        "active_rules": active_rules,
        "rate_limit": await defense_cache.get_rate_limit_config(),
        "recent_status_counts": await defense_cache.recent_status_counts(),
    }


def rule_to_dict(rule: DefenseRule) -> dict[str, Any]:
    return _serialize_rule(rule)
