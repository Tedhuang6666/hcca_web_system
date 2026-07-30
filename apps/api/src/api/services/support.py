"""客服作業平台服務層。

這裡集中處理客服可執行的白名單動作。Router 只負責權限、參數與 HTTP 錯誤轉換，
所有變更都會留下客服稽核與既有 hash-chain audit。
"""

from __future__ import annotations

import hashlib
import json
import secrets
import uuid
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.cache import cache_get, cache_invalidate_user_permissions
from api.core.config import settings
from api.core.login_lockout import admin_unlock
from api.core.security import add_to_blacklist, redis_client, revoke_user
from api.email.sender import send_branded_email
from api.models.org import Position, UserPosition
from api.models.school_class import ClassMembership, SchoolClass
from api.models.support import (
    SupportApproval,
    SupportApprovalStatus,
    SupportAssistanceSession,
    SupportAssistanceStatus,
    SupportAuditLog,
    SupportImpersonationMode,
    SupportImpersonationSession,
    SupportTicket,
    SupportTicketEvent,
    SupportTicketPriority,
    SupportTicketStatus,
)
from api.models.user import User
from api.models.user_identity import UserIdentity
from api.services import audit as audit_svc
from api.services import mfa as mfa_svc
from api.services.notification_pref import normalize_preferences
from api.services.permission import get_user_permission_codes

SUPPORT_USERS_READ = "support.users.read"
SUPPORT_USERS_VIEW_SENSITIVE = "support.users.view_sensitive"
SUPPORT_USERS_EDIT_PROFILE = "support.users.edit_profile"
SUPPORT_USERS_EDIT_EMAIL = "support.users.edit_email"
SUPPORT_USERS_UNLOCK = "support.users.unlock"
SUPPORT_USERS_REVOKE_SESSIONS = "support.users.revoke_sessions"
SUPPORT_USERS_RESET_MFA = "support.users.reset_mfa"
SUPPORT_USERS_IMPERSONATE = "support.users.impersonate"
SUPPORT_USERS_IMPERSONATE_INTERACTIVE = "support.users.impersonate_interactive"
SUPPORT_TICKETS_READ = "support.tickets.read"
SUPPORT_TICKETS_CREATE = "support.tickets.create"
SUPPORT_TICKETS_MANAGE = "support.tickets.manage"
SUPPORT_APPROVALS_REVIEW = "support.approvals.review"
SUPPORT_AUDIT_READ = "support.audit.read"
SUPPORT_AUDIT_EXPORT = "support.audit.export"
SUPPORT_GUIDES_MANAGE = "support.guides.manage"
SUPPORT_ASSISTANCE_MANAGE = "support.assistance.manage"

SUPPORT_REPAIR_ACTIONS: frozenset[str] = frozenset(
    {
        "unlock",
        "revoke_sessions",
        "reset_mfa",
        "refresh_permissions",
        "rebuild_profile",
        "rebuild_navigation",
        "resend_verification",
    }
)

PROFILE_FIELDS = frozenset({"display_name", "student_id", "show_email"})


def mask_email(email: str) -> str:
    local, separator, domain = email.partition("@")
    if not separator:
        return mask_identifier(email)
    visible = local[:2] if len(local) > 2 else local[:1]
    return f"{visible}{'*' * max(2, len(local) - len(visible))}@{domain}"


def mask_identifier(value: str | None, *, visible_end: int = 2) -> str | None:
    if value is None:
        return None
    if len(value) <= visible_end:
        return "*" * len(value)
    return "*" * (len(value) - visible_end) + value[-visible_end:]


def mask_name(name: str) -> str:
    if len(name) <= 1:
        return "○"
    return name[0] + "○" * (len(name) - 1)


def mask_ip(ip_address: str | None) -> str | None:
    if not ip_address:
        return None
    parts = ip_address.split(".")
    if len(parts) == 4:
        return f"{parts[0]}.***.***.{parts[-1]}"
    return mask_identifier(ip_address, visible_end=4)


async def _ticket_number() -> str:
    today = datetime.now(UTC).strftime("%Y%m%d")
    try:
        sequence = int(await redis_client.incr(f"support:ticket:{today}"))
        await redis_client.expire(f"support:ticket:{today}", 172800)
        return f"SUP-{today}-{sequence:04d}"
    except Exception:
        return f"SUP-{today}-{secrets.token_hex(2).upper()}"


async def _approval_number() -> str:
    today = datetime.now(UTC).strftime("%Y%m%d")
    try:
        sequence = int(await redis_client.incr(f"support:approval:{today}"))
        await redis_client.expire(f"support:approval:{today}", 172800)
        return f"APR-{today}-{sequence:04d}"
    except Exception:
        return f"APR-{today}-{secrets.token_hex(2).upper()}"


def _request_context(request: Any | None) -> tuple[str | None, str | None, str | None]:
    if request is None:
        return None, None, None
    client_ip = request.client.host if request.client else None
    return request.headers.get("x-request-id"), client_ip, request.headers.get("user-agent")


async def record_support_audit(
    db: AsyncSession,
    *,
    actor: User,
    action: str,
    reason: str,
    resource_type: str,
    target_user_id: uuid.UUID | None = None,
    ticket_id: uuid.UUID | None = None,
    resource_id: str | None = None,
    risk_level: str = "low",
    before_data: dict | None = None,
    after_data: dict | None = None,
    request: Any | None = None,
) -> SupportAuditLog:
    request_id, ip_address, user_agent = _request_context(request)
    row = SupportAuditLog(
        actor_user_id=actor.id,
        target_user_id=target_user_id,
        ticket_id=ticket_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        risk_level=risk_level,
        reason=reason,
        before_data=before_data,
        after_data=after_data,
        request_id=request_id,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(row)
    await db.flush()
    await audit_svc.record(
        db,
        entity_type=f"support_{resource_type}",
        entity_id=resource_id or str(target_user_id or actor.id),
        action=action,
        actor_id=str(actor.id),
        actor_email=actor.email,
        ip_address=ip_address,
        meta={
            "ticket_id": str(ticket_id) if ticket_id else None,
            "risk_level": risk_level,
            "reason": reason,
            "before": before_data,
            "after": after_data,
            "request_id": request_id,
            "user_agent": user_agent,
        },
        summary=f"客服操作：{action}",
    )
    return row


async def get_ticket(db: AsyncSession, ticket_id: uuid.UUID) -> SupportTicket | None:
    return await db.scalar(
        select(SupportTicket)
        .options(selectinload(SupportTicket.events))
        .where(SupportTicket.id == ticket_id)
    )


async def add_ticket_event(
    db: AsyncSession,
    *,
    ticket: SupportTicket,
    actor: User,
    event_type: str,
    body: str,
    metadata: dict | None = None,
) -> SupportTicketEvent:
    event = SupportTicketEvent(
        ticket_id=ticket.id,
        actor_user_id=actor.id,
        event_type=event_type,
        body=body,
        event_metadata=metadata or {},
    )
    db.add(event)
    await db.flush()
    return event


async def create_ticket(
    db: AsyncSession,
    *,
    actor: User,
    title: str,
    description: str,
    user_id: uuid.UUID | None,
    channel: str,
    priority: str,
    error_code: str | None,
    request_id: str | None,
    related_data: dict,
    request: Any | None = None,
) -> SupportTicket:
    if user_id is not None and await db.get(User, user_id) is None:
        raise ValueError("使用者不存在")
    ticket = SupportTicket(
        ticket_number=await _ticket_number(),
        title=title.strip(),
        description=description.strip(),
        user_id=user_id,
        reported_by_user_id=actor.id,
        channel=channel,
        priority=SupportTicketPriority(priority),
        status=SupportTicketStatus.NEW,
        error_code=error_code,
        request_id=request_id,
        related_data=related_data,
    )
    db.add(ticket)
    await db.flush()
    await add_ticket_event(
        db,
        ticket=ticket,
        actor=actor,
        event_type="system",
        body="建立工單",
    )
    await record_support_audit(
        db,
        actor=actor,
        action="ticket.create",
        reason="建立客服工單",
        resource_type="ticket",
        resource_id=str(ticket.id),
        ticket_id=ticket.id,
        target_user_id=user_id,
        after_data={"ticket_number": ticket.ticket_number, "title": ticket.title},
        request=request,
    )
    return ticket


async def search_users(
    db: AsyncSession,
    *,
    keyword: str | None,
    limit: int,
    offset: int,
) -> list[User]:
    query = select(User).order_by(User.created_at.desc())
    needle = (keyword or "").strip().lower()
    if needle:
        conditions = [
            func.lower(User.display_name).contains(needle),
            func.lower(User.email).contains(needle),
            func.lower(func.coalesce(User.student_id, "")).contains(needle),
        ]
        with suppress(ValueError):
            conditions.append(User.id == uuid.UUID(needle))
        ticket_user_ids = select(SupportTicket.user_id).where(
            or_(
                func.lower(func.coalesce(SupportTicket.ticket_number, "")).contains(needle),
                func.lower(func.coalesce(SupportTicket.error_code, "")).contains(needle),
                func.lower(func.coalesce(SupportTicket.request_id, "")).contains(needle),
            )
        )
        conditions.append(User.id.in_(ticket_user_ids))
        identity_user_ids = select(UserIdentity.user_id).where(
            or_(
                func.lower(func.coalesce(UserIdentity.email, "")).contains(needle),
                func.lower(func.coalesce(UserIdentity.external_id, "")).contains(needle),
            )
        )
        conditions.append(User.id.in_(identity_user_ids))
        class_user_ids = (
            select(ClassMembership.user_id)
            .join(SchoolClass, SchoolClass.id == ClassMembership.class_id)
            .where(
                or_(
                    func.lower(SchoolClass.class_code).contains(needle),
                    func.lower(func.coalesce(SchoolClass.label, "")).contains(needle),
                )
            )
        )
        conditions.append(User.id.in_(class_user_ids))
        query = query.where(or_(*conditions))
    result = await db.execute(query.limit(limit).offset(offset))
    return list(result.scalars().all())


async def linked_emails(db: AsyncSession, user: User) -> list[str]:
    rows = await db.scalars(
        select(UserIdentity.email)
        .where(UserIdentity.user_id == user.id, UserIdentity.email.is_not(None))
        .distinct()
    )
    return sorted({user.email, *(email for email in rows.all() if email)})


async def user_roles(db: AsyncSession, user_id: uuid.UUID) -> list[UserPosition]:
    result = await db.execute(
        select(UserPosition)
        .options(
            selectinload(UserPosition.position).selectinload(Position.permissions),
            selectinload(UserPosition.position).selectinload(Position.org),
        )
        .where(UserPosition.user_id == user_id)
        .order_by(UserPosition.start_date)
    )
    return list(result.scalars().all())


def user_summary(user: User) -> dict:
    return {
        "id": user.id,
        "display_name": user.display_name,
        "masked_name": mask_name(user.display_name),
        "email": mask_email(user.email),
        "masked_email": mask_email(user.email),
        "student_id": mask_identifier(user.student_id, visible_end=2),
        "masked_student_id": mask_identifier(user.student_id, visible_end=2),
        "is_active": user.is_active,
        "is_verified": user.is_verified,
        "mfa_enabled": user.mfa_enabled,
        "is_superuser": user.is_superuser,
        "created_at": user.created_at,
    }


async def diagnose_user(db: AsyncSession, user: User) -> list[dict[str, str | None]]:
    results: list[dict[str, str | None]] = []
    cached = await cache_get(f"perm:{user.id}")
    calculated = await get_user_permission_codes(db, user.id, on_date=datetime.now(UTC).date())
    if cached is None:
        results.append(
            {
                "code": "PERMISSION_CACHE_MISSING",
                "severity": "warning",
                "message": "權限快取不存在，下一次請求會重新建立",
                "repair_action": "refresh_permissions",
            }
        )
    elif set(cached) != set(calculated):
        results.append(
            {
                "code": "PERMISSION_CACHE_MISMATCH",
                "severity": "warning",
                "message": "權限快取與目前有效職位不一致",
                "repair_action": "refresh_permissions",
            }
        )
    else:
        results.append(
            {
                "code": "PERMISSION_CACHE_OK",
                "severity": "info",
                "message": "權限快取與目前有效職位一致",
                "repair_action": None,
            }
        )
    if not user.is_active:
        results.append(
            {
                "code": "ACCOUNT_INACTIVE",
                "severity": "error",
                "message": "帳號目前已停用",
                "repair_action": None,
            }
        )
    if not user.is_verified:
        results.append(
            {
                "code": "EMAIL_NOT_VERIFIED",
                "severity": "warning",
                "message": "主要 Email 尚未驗證",
                "repair_action": "resend_verification",
            }
        )
    if user.mfa_enabled and not user.mfa_secret:
        results.append(
            {
                "code": "MFA_SECRET_MISSING",
                "severity": "error",
                "message": "MFA 已標記啟用但密鑰不存在",
                "repair_action": "reset_mfa",
            }
        )
    if not user.notification_preferences:
        results.append(
            {
                "code": "NOTIFICATION_PROFILE_MISSING",
                "severity": "warning",
                "message": "通知設定尚未建立",
                "repair_action": "rebuild_profile",
            }
        )
    return results


async def user_detail(db: AsyncSession, user: User, *, include_diagnostics: bool = False) -> dict:
    emails = await linked_emails(db, user)
    roles = await user_roles(db, user.id)
    effective = await get_user_permission_codes(db, user.id)
    tickets = list(
        (
            await db.scalars(
                select(SupportTicket)
                .where(SupportTicket.user_id == user.id)
                .order_by(SupportTicket.updated_at.desc())
                .limit(20)
            )
        ).all()
    )
    role_out = [
        {
            "id": row.position.id,
            "name": row.position.name,
            "org_id": row.position.org_id,
            "org_name": row.position.org.name if row.position.org else "",
            "start_date": row.start_date.isoformat(),
            "end_date": row.end_date.isoformat() if row.end_date else None,
            "permission_codes": sorted(p.code for p in row.position.permissions),
        }
        for row in roles
        if row.position is not None
    ]
    return {
        "user": user_summary(user),
        "linked_emails": [mask_email(email) for email in emails],
        "masked_linked_emails": [mask_email(email) for email in emails],
        "account": {
            "status": "active" if user.is_active else "inactive",
            "email_verified": user.is_verified,
            "mfa_enabled": user.mfa_enabled,
            "session_status": "unknown_until_checked",
        },
        "roles": role_out,
        "effective_permissions": sorted(effective),
        "settings": {
            "show_email": user.show_email,
            "ui_theme": user.ui_theme,
            "ui_locale": user.ui_locale,
            "notification_preferences": user.notification_preferences or {},
        },
        "tickets": [
            {
                "id": ticket.id,
                "ticket_number": ticket.ticket_number,
                "title": ticket.title,
                "status": str(ticket.status),
                "priority": str(ticket.priority),
                "updated_at": ticket.updated_at,
            }
            for ticket in tickets
        ],
        "diagnostics": await diagnose_user(db, user) if include_diagnostics else [],
    }


async def update_profile(
    db: AsyncSession,
    *,
    actor: User,
    user: User,
    changes: dict[str, Any],
    ticket_id: uuid.UUID,
    reason: str,
    request: Any | None = None,
) -> dict:
    safe_changes = {key: value for key, value in changes.items() if key in PROFILE_FIELDS}
    if not safe_changes:
        raise ValueError("沒有可修改的欄位")
    before = {key: getattr(user, key) for key in safe_changes}
    for key, value in safe_changes.items():
        setattr(user, key, value)
    await db.flush()
    after = {key: getattr(user, key) for key in safe_changes}
    await record_support_audit(
        db,
        actor=actor,
        action="user.profile.update",
        reason=reason,
        resource_type="user",
        resource_id=str(user.id),
        target_user_id=user.id,
        ticket_id=ticket_id,
        risk_level="medium" if "student_id" in safe_changes else "low",
        before_data=before,
        after_data=after,
        request=request,
    )
    return await user_detail(db, user)


async def update_contact(
    db: AsyncSession,
    *,
    actor: User,
    user: User,
    email: str,
    ticket_id: uuid.UUID,
    reason: str,
    request: Any | None = None,
) -> dict:
    normalized = email.strip().lower()
    if "@" not in normalized:
        raise ValueError("Email 格式不正確")
    existing = await db.scalar(select(User).where(User.email == normalized, User.id != user.id))
    if existing is not None:
        raise ValueError("此 Email 已被其他帳號使用")
    before = {"email": user.email}
    user.email = normalized
    user.is_verified = False
    await db.flush()
    await record_support_audit(
        db,
        actor=actor,
        action="user.email.update",
        reason=reason,
        resource_type="user",
        resource_id=str(user.id),
        target_user_id=user.id,
        ticket_id=ticket_id,
        risk_level="medium",
        before_data=before,
        after_data={"email": normalized, "is_verified": False},
        request=request,
    )
    return await user_detail(db, user)


async def unlock_user(
    db: AsyncSession,
    *,
    actor: User,
    user: User,
    ticket_id: uuid.UUID,
    reason: str,
    request: Any | None = None,
) -> dict:
    await admin_unlock(str(user.id))
    await admin_unlock(user.email)
    await admin_unlock(f"mfa:{user.id}")
    await admin_unlock(f"mfa_login:{user.id}")
    await record_support_audit(
        db,
        actor=actor,
        action="user.unlock",
        reason=reason,
        resource_type="user",
        resource_id=str(user.id),
        target_user_id=user.id,
        ticket_id=ticket_id,
        request=request,
    )
    return {"user_id": str(user.id), "message": "帳號鎖定已解除"}


async def revoke_sessions(
    db: AsyncSession,
    *,
    actor: User,
    user: User,
    ticket_id: uuid.UUID,
    reason: str,
    request: Any | None = None,
) -> dict:
    revoked_count = await revoke_user(str(user.id))
    await record_support_audit(
        db,
        actor=actor,
        action="user.sessions.revoke",
        reason=reason,
        resource_type="user",
        resource_id=str(user.id),
        target_user_id=user.id,
        ticket_id=ticket_id,
        after_data={"revoked_count": revoked_count},
        request=request,
    )
    return {"user_id": str(user.id), "revoked_count": revoked_count}


async def reset_mfa(
    db: AsyncSession,
    *,
    actor: User,
    user: User,
    ticket_id: uuid.UUID,
    reason: str,
    request: Any | None = None,
) -> dict:
    before = {"mfa_enabled": user.mfa_enabled}
    await mfa_svc.clear_mfa(db, user)
    await record_support_audit(
        db,
        actor=actor,
        action="user.mfa.reset",
        reason=reason,
        resource_type="user",
        resource_id=str(user.id),
        target_user_id=user.id,
        ticket_id=ticket_id,
        risk_level="medium",
        before_data=before,
        after_data={"mfa_enabled": False},
        request=request,
    )
    return {"user_id": str(user.id), "message": "MFA 已重設，使用者可重新註冊"}


async def refresh_permissions(
    db: AsyncSession,
    *,
    actor: User,
    user: User,
    ticket_id: uuid.UUID,
    reason: str,
    request: Any | None = None,
) -> dict:
    before = await cache_get(f"perm:{user.id}")
    await cache_invalidate_user_permissions(str(user.id))
    after = sorted(await get_user_permission_codes(db, user.id))
    await record_support_audit(
        db,
        actor=actor,
        action="user.permissions.refresh",
        reason=reason,
        resource_type="user",
        resource_id=str(user.id),
        target_user_id=user.id,
        ticket_id=ticket_id,
        before_data={"cached": before},
        after_data={"calculated": after},
        request=request,
    )
    return {"user_id": str(user.id), "changed": before is None or set(before) != set(after)}


async def rebuild_profile(
    db: AsyncSession,
    *,
    actor: User,
    user: User,
    ticket_id: uuid.UUID,
    reason: str,
    request: Any | None = None,
) -> dict:
    before = user.notification_preferences or {}
    user.notification_preferences = normalize_preferences(before)
    await db.flush()
    await record_support_audit(
        db,
        actor=actor,
        action="user.profile.rebuild",
        reason=reason,
        resource_type="user",
        resource_id=str(user.id),
        target_user_id=user.id,
        ticket_id=ticket_id,
        before_data={"notification_preferences": before},
        after_data={"notification_preferences": user.notification_preferences},
        request=request,
    )
    return {"user_id": str(user.id), "message": "個人設定已重建"}


async def send_verification(
    db: AsyncSession,
    *,
    actor: User,
    user: User,
    ticket_id: uuid.UUID,
    reason: str,
    request: Any | None = None,
) -> dict:
    token = secrets.token_urlsafe(32)
    digest = hashlib.sha256(token.encode()).hexdigest()
    payload = {"user_id": str(user.id), "actor_id": str(actor.id), "ticket_id": str(ticket_id)}
    await redis_client.setex(
        f"support:email-verification:{digest}",
        86400,
        json.dumps(payload, separators=(",", ":")),
    )
    link = f"{settings.EMAIL_LINK_BASE_URL.rstrip('/')}/support/verify-email?token={token}"
    send_branded_email(
        [user.email],
        "HCCA Email 驗證",
        "generic",
        {
            "heading": "驗證您的 HCCA 登入 Email",
            "preview_text": "客服已重新寄送 Email 驗證連結",
            "body_html": f'<p>請點擊以下連結完成驗證：</p><p><a href="{link}">{link}</a></p>',
            "show_system_footer": True,
        },
    )
    await record_support_audit(
        db,
        actor=actor,
        action="user.email.resend_verification",
        reason=reason,
        resource_type="user",
        resource_id=str(user.id),
        target_user_id=user.id,
        ticket_id=ticket_id,
        after_data={"email": mask_email(user.email)},
        request=request,
    )
    return {"user_id": str(user.id), "message": "驗證信已重新寄送"}


async def verify_email_token(db: AsyncSession, token: str) -> User | None:
    digest = hashlib.sha256(token.encode()).hexdigest()
    key = f"support:email-verification:{digest}"
    raw = await redis_client.get(key)
    if not raw:
        return None
    try:
        data = json.loads(raw)
        user_id = uuid.UUID(data["user_id"])
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        return None
    user = await db.get(User, user_id)
    if user is None:
        return None
    user.is_verified = True
    await db.flush()
    await redis_client.delete(key)
    return user


async def run_repair(
    db: AsyncSession,
    *,
    actor: User,
    user: User,
    action: str,
    ticket_id: uuid.UUID,
    reason: str,
    request: Any | None = None,
) -> dict:
    if action not in SUPPORT_REPAIR_ACTIONS:
        raise ValueError("不支援的修復動作")
    if action == "unlock":
        return await unlock_user(
            db, actor=actor, user=user, ticket_id=ticket_id, reason=reason, request=request
        )
    if action == "revoke_sessions":
        return await revoke_sessions(
            db, actor=actor, user=user, ticket_id=ticket_id, reason=reason, request=request
        )
    if action == "reset_mfa":
        return await reset_mfa(
            db, actor=actor, user=user, ticket_id=ticket_id, reason=reason, request=request
        )
    if action == "refresh_permissions":
        return await refresh_permissions(
            db, actor=actor, user=user, ticket_id=ticket_id, reason=reason, request=request
        )
    if action == "rebuild_profile":
        return await rebuild_profile(
            db, actor=actor, user=user, ticket_id=ticket_id, reason=reason, request=request
        )
    if action == "resend_verification":
        return await send_verification(
            db, actor=actor, user=user, ticket_id=ticket_id, reason=reason, request=request
        )
    await cache_invalidate_user_permissions(str(user.id))
    await record_support_audit(
        db,
        actor=actor,
        action="user.navigation.rebuild",
        reason=reason,
        resource_type="user",
        resource_id=str(user.id),
        target_user_id=user.id,
        ticket_id=ticket_id,
        request=request,
    )
    return {"user_id": str(user.id), "message": "導覽與權限快取已重建"}


async def create_approval(
    db: AsyncSession,
    *,
    actor: User,
    target_user: User,
    ticket_id: uuid.UUID,
    action: str,
    payload: dict,
    reason: str,
    request: Any | None = None,
) -> SupportApproval:
    if action == "user.role.grant":
        position_id = payload.get("position_id")
        if not position_id:
            raise ValueError("角色核准申請必須包含 position_id")
        try:
            position = await db.get(Position, uuid.UUID(str(position_id)))
        except ValueError as exc:
            raise ValueError("position_id 格式不正確") from exc
        if position is None:
            raise ValueError("職位不存在")
    elif action == "user.profile.restore":
        if not payload or set(payload) - PROFILE_FIELDS:
            raise ValueError("還原申請只能包含白名單個人欄位")
    approval = SupportApproval(
        approval_number=await _approval_number(),
        requested_by=actor.id,
        ticket_id=ticket_id,
        target_user_id=target_user.id,
        action=action,
        payload=payload,
        reason=reason,
        risk_level="high",
        status=SupportApprovalStatus.PENDING,
    )
    db.add(approval)
    await db.flush()
    await record_support_audit(
        db,
        actor=actor,
        action="approval.request",
        reason=reason,
        resource_type="approval",
        resource_id=str(approval.id),
        target_user_id=target_user.id,
        ticket_id=ticket_id,
        risk_level="high",
        after_data={
            "approval_number": approval.approval_number,
            "action": action,
            "payload": payload,
        },
        request=request,
    )
    return approval


async def execute_approval(
    db: AsyncSession,
    *,
    approval: SupportApproval,
    approver: User,
    request: Any | None = None,
) -> dict:
    if approval.requested_by == approver.id:
        raise ValueError("申請人不可核准自己的高風險操作")
    if approval.status != SupportApprovalStatus.PENDING:
        raise ValueError("此核准申請已處理")
    target = await db.get(User, approval.target_user_id) if approval.target_user_id else None
    if target is None:
        raise ValueError("目標使用者不存在")
    before: dict = {}
    after: dict = {}
    if approval.action == "user.role.grant":
        position_id = uuid.UUID(str(approval.payload["position_id"]))
        position = await db.get(Position, position_id)
        if position is None:
            raise ValueError("職位不存在")
        assignment = UserPosition(
            user_id=target.id,
            position_id=position.id,
            start_date=datetime.fromisoformat(approval.payload["start_date"]).date(),
            end_date=(
                datetime.fromisoformat(approval.payload["end_date"]).date()
                if approval.payload.get("end_date")
                else None
            ),
        )
        db.add(assignment)
        await db.flush()
        after = {"position_id": str(position.id), "position_name": position.name}
        await cache_invalidate_user_permissions(str(target.id))
    elif approval.action == "user.profile.restore":
        before = {key: getattr(target, key) for key in approval.payload}
        for key, value in approval.payload.items():
            setattr(target, key, value)
        await db.flush()
        after = dict(approval.payload)
    else:
        raise ValueError("不支援的核准動作")
    approval.approved_by = approver.id
    approval.reviewed_at = datetime.now(UTC)
    approval.executed_at = datetime.now(UTC)
    approval.status = SupportApprovalStatus.EXECUTED
    approval.result = after
    await db.flush()
    await record_support_audit(
        db,
        actor=approver,
        action="approval.execute",
        reason=approval.reason,
        resource_type="approval",
        resource_id=str(approval.id),
        target_user_id=target.id,
        ticket_id=approval.ticket_id,
        risk_level="high",
        before_data=before,
        after_data=after,
        request=request,
    )
    return {"approval_number": approval.approval_number, "status": approval.status, "result": after}


def create_support_impersonation_token(
    actor: User, target: User, *, minutes: int, read_only: bool
) -> tuple[str, datetime]:
    if actor.id == target.id:
        raise ValueError("不能模擬自己")
    if target.is_superuser and not actor.is_superuser:
        raise ValueError("一般客服不能模擬系統管理員")
    now = datetime.now(UTC)
    expires_at = now + timedelta(minutes=minutes)
    payload = {
        "sub": str(target.id),
        "type": "impersonation",
        "imp": str(actor.id),
        "imp_email": actor.email,
        "imp_name": actor.display_name,
        "target_email": target.email,
        "target_name": target.display_name,
        "support_read_only": read_only,
        "support_interactive": not read_only,
        "jti": uuid.uuid4().hex,
        "iat": now,
        "exp": expires_at,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM), expires_at


async def start_impersonation(
    db: AsyncSession,
    *,
    actor: User,
    target: User,
    ticket_id: uuid.UUID,
    reason: str,
    mode: str,
    minutes: int,
    request: Any | None = None,
) -> tuple[SupportImpersonationSession, str, datetime]:
    token, expires_at = create_support_impersonation_token(
        actor, target, minutes=minutes, read_only=mode == SupportImpersonationMode.READ_ONLY
    )
    session = SupportImpersonationSession(
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        real_user_id=actor.id,
        impersonated_user_id=target.id,
        ticket_id=ticket_id,
        mode=mode,
        reason=reason,
        expires_at=expires_at,
    )
    db.add(session)
    await db.flush()
    await record_support_audit(
        db,
        actor=actor,
        action="impersonation.start",
        reason=reason,
        resource_type="impersonation",
        resource_id=str(session.id),
        target_user_id=target.id,
        ticket_id=ticket_id,
        risk_level="medium" if mode == SupportImpersonationMode.READ_ONLY else "high",
        after_data={"mode": mode, "expires_at": expires_at.isoformat()},
        request=request,
    )
    return session, token, expires_at


async def end_impersonation(
    db: AsyncSession,
    *,
    actor: User,
    session: SupportImpersonationSession,
    token: str,
    reason: str,
    request: Any | None = None,
) -> None:
    await add_to_blacklist(token)
    session.ended_at = datetime.now(UTC)
    await db.flush()
    await record_support_audit(
        db,
        actor=actor,
        action="impersonation.end",
        reason=reason,
        resource_type="impersonation",
        resource_id=str(session.id),
        target_user_id=session.impersonated_user_id,
        ticket_id=session.ticket_id,
        risk_level="low",
        request=request,
    )


async def create_assistance(
    db: AsyncSession,
    *,
    actor: User,
    user: User,
    ticket_id: uuid.UUID,
    reason: str,
    expires_minutes: int,
    current_route: str | None,
    request: Any | None = None,
) -> SupportAssistanceSession:
    code = ""
    for _ in range(5):
        candidate = f"{secrets.randbelow(1_000_000):06d}"
        if (
            await db.scalar(
                select(SupportAssistanceSession.id).where(
                    SupportAssistanceSession.assistance_code == candidate
                )
            )
            is None
        ):
            code = candidate
            break
    if not code:
        raise ValueError("目前無法產生唯一協助碼，請稍後再試")
    session = SupportAssistanceSession(
        assistance_code=code,
        user_id=user.id,
        support_user_id=actor.id,
        ticket_id=ticket_id,
        status=SupportAssistanceStatus.WAITING,
        current_route=current_route,
        expires_at=datetime.now(UTC) + timedelta(minutes=expires_minutes),
    )
    db.add(session)
    await db.flush()
    await record_support_audit(
        db,
        actor=actor,
        action="assistance.create",
        reason=reason,
        resource_type="assistance",
        resource_id=str(session.id),
        target_user_id=user.id,
        ticket_id=ticket_id,
        risk_level="medium",
        after_data={"expires_at": session.expires_at.isoformat()},
        request=request,
    )
    return session


async def get_assistance(
    db: AsyncSession, session_id: uuid.UUID
) -> SupportAssistanceSession | None:
    return await db.get(SupportAssistanceSession, session_id)


async def expire_assistance_if_needed(session: SupportAssistanceSession) -> bool:
    if session.status in {SupportAssistanceStatus.CLOSED, SupportAssistanceStatus.EXPIRED}:
        return False
    if session.expires_at <= datetime.now(UTC):
        session.status = SupportAssistanceStatus.EXPIRED
        return True
    return False


__all__ = [
    "PROFILE_FIELDS",
    "SUPPORT_APPROVALS_REVIEW",
    "SUPPORT_ASSISTANCE_MANAGE",
    "SUPPORT_AUDIT_EXPORT",
    "SUPPORT_AUDIT_READ",
    "SUPPORT_GUIDES_MANAGE",
    "SUPPORT_REPAIR_ACTIONS",
    "SUPPORT_TICKETS_CREATE",
    "SUPPORT_TICKETS_MANAGE",
    "SUPPORT_TICKETS_READ",
    "SUPPORT_USERS_EDIT_EMAIL",
    "SUPPORT_USERS_EDIT_PROFILE",
    "SUPPORT_USERS_IMPERSONATE",
    "SUPPORT_USERS_IMPERSONATE_INTERACTIVE",
    "SUPPORT_USERS_READ",
    "SUPPORT_USERS_RESET_MFA",
    "SUPPORT_USERS_REVOKE_SESSIONS",
    "SUPPORT_USERS_UNLOCK",
    "SUPPORT_USERS_VIEW_SENSITIVE",
    "add_ticket_event",
    "create_assistance",
    "create_approval",
    "create_ticket",
    "diagnose_user",
    "end_impersonation",
    "execute_approval",
    "expire_assistance_if_needed",
    "get_assistance",
    "get_ticket",
    "linked_emails",
    "mask_email",
    "mask_identifier",
    "mask_ip",
    "mask_name",
    "record_support_audit",
    "refresh_permissions",
    "reset_mfa",
    "rebuild_profile",
    "revoke_sessions",
    "run_repair",
    "search_users",
    "send_verification",
    "start_impersonation",
    "unlock_user",
    "update_contact",
    "update_profile",
    "user_detail",
    "user_summary",
    "user_roles",
    "verify_email_token",
]
