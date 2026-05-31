"""政策版本與同意紀錄業務邏輯。Phase B1 / ADR-003。

不檢查權限（router 層注入 require_permission）。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import desc, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.policy import (
    PolicyConsent,
    PolicyDocument,
    PolicyKind,
    PrivacyRequest,
    PrivacyRequestStatus,
    PrivacyRequestType,
)


async def list_policies(
    db: AsyncSession,
    *,
    kind: PolicyKind | None = None,
    only_active: bool = False,
) -> list[PolicyDocument]:
    stmt = select(PolicyDocument).order_by(PolicyDocument.kind, desc(PolicyDocument.effective_at))
    if kind is not None:
        stmt = stmt.where(PolicyDocument.kind == kind.value)
    if only_active:
        stmt = stmt.where(PolicyDocument.is_active.is_(True))
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_active_policy(db: AsyncSession, kind: PolicyKind) -> PolicyDocument | None:
    stmt = (
        select(PolicyDocument)
        .where(PolicyDocument.kind == kind.value)
        .where(PolicyDocument.is_active.is_(True))
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def get_policy(db: AsyncSession, policy_id: uuid.UUID) -> PolicyDocument | None:
    return await db.get(PolicyDocument, policy_id)


async def create_policy(
    db: AsyncSession,
    *,
    kind: PolicyKind,
    version: str,
    title: str,
    content_md: str,
    summary_md: str | None,
    effective_at: datetime,
    requires_explicit_consent: bool,
    published_by: uuid.UUID | None,
    activate_immediately: bool = False,
) -> PolicyDocument:
    """建立新政策版本。若 activate_immediately=True 同 kind 其餘將被 deactivate。"""
    doc = PolicyDocument(
        kind=kind.value,
        version=version,
        title=title,
        content_md=content_md,
        summary_md=summary_md,
        effective_at=effective_at,
        requires_explicit_consent=requires_explicit_consent,
        is_active=False,
        published_by=published_by,
    )
    db.add(doc)
    await db.flush()

    if activate_immediately:
        await activate_policy(db, doc.id)
        await db.refresh(doc)

    return doc


async def activate_policy(db: AsyncSession, policy_id: uuid.UUID) -> PolicyDocument:
    """啟用指定版本，同 kind 其餘自動 deactivate。"""
    doc = await db.get(PolicyDocument, policy_id)
    if doc is None:
        raise ValueError("policy not found")

    # 先 deactivate 同 kind 所有
    await db.execute(
        update(PolicyDocument).where(PolicyDocument.kind == doc.kind).values(is_active=False)
    )
    # 再啟用本筆
    doc.is_active = True
    await db.flush()
    return doc


async def update_policy(
    db: AsyncSession,
    policy_id: uuid.UUID,
    *,
    title: str | None = None,
    content_md: str | None = None,
    summary_md: str | None = None,
    effective_at: datetime | None = None,
    requires_explicit_consent: bool | None = None,
) -> PolicyDocument:
    """只允許在 is_active=False 時編輯內容；已啟用版本應發新版本。"""
    doc = await db.get(PolicyDocument, policy_id)
    if doc is None:
        raise ValueError("policy not found")
    if doc.is_active:
        raise ValueError("已啟用的政策不可直接編輯；請發布新版本")
    if title is not None:
        doc.title = title
    if content_md is not None:
        doc.content_md = content_md
    if summary_md is not None:
        doc.summary_md = summary_md
    if effective_at is not None:
        doc.effective_at = effective_at
    if requires_explicit_consent is not None:
        doc.requires_explicit_consent = requires_explicit_consent
    await db.flush()
    return doc


# ── Consent ──────────────────────────────────────────────────────────


async def record_consent(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    policy_document_id: uuid.UUID,
    ip_address: str | None,
    user_agent: str | None,
    agreed_at: datetime,
) -> PolicyConsent:
    """記錄使用者同意。重複同意同一版本會 raise（DB unique）。"""
    existing_stmt = select(PolicyConsent).where(
        PolicyConsent.user_id == user_id,
        PolicyConsent.policy_document_id == policy_document_id,
    )
    existing = (await db.execute(existing_stmt)).scalar_one_or_none()
    if existing is not None:
        return existing

    consent = PolicyConsent(
        user_id=user_id,
        policy_document_id=policy_document_id,
        agreed_at=agreed_at,
        ip_address=ip_address,
        user_agent=(user_agent or "")[:500] or None,
    )
    db.add(consent)
    await db.flush()
    return consent


async def list_my_consents(db: AsyncSession, user_id: uuid.UUID) -> list[PolicyConsent]:
    stmt = (
        select(PolicyConsent)
        .where(PolicyConsent.user_id == user_id)
        .order_by(desc(PolicyConsent.agreed_at))
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def pending_consents(db: AsyncSession, user_id: uuid.UUID) -> list[PolicyDocument]:
    """回傳使用者尚未同意的目前生效政策。

    僅含 `requires_explicit_consent=True` 的政策；其他僅 footer 顯示。
    """
    active_stmt = (
        select(PolicyDocument)
        .where(PolicyDocument.is_active.is_(True))
        .where(PolicyDocument.requires_explicit_consent.is_(True))
    )
    active = list((await db.execute(active_stmt)).scalars().all())
    if not active:
        return []

    active_ids = [p.id for p in active]
    consented_stmt = select(PolicyConsent.policy_document_id).where(
        PolicyConsent.user_id == user_id,
        PolicyConsent.policy_document_id.in_(active_ids),
    )
    consented_ids = {row[0] for row in (await db.execute(consented_stmt)).all()}
    return [p for p in active if p.id not in consented_ids]


# ── Privacy requests ────────────────────────────────────────────────────


async def create_privacy_request(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    request_type: PrivacyRequestType,
    subject: str,
    description: str,
    submitted_ip_address: str | None,
    submitted_user_agent: str | None,
) -> PrivacyRequest:
    row = PrivacyRequest(
        user_id=user_id,
        request_type=request_type.value,
        status=PrivacyRequestStatus.SUBMITTED.value,
        subject=subject,
        description=description,
        submitted_ip_address=submitted_ip_address,
        submitted_user_agent=(submitted_user_agent or "")[:500] or None,
    )
    db.add(row)
    await db.flush()
    return row


async def cancel_privacy_request(
    db: AsyncSession,
    *,
    request_id: uuid.UUID,
    user_id: uuid.UUID,
    reason: str | None,
) -> PrivacyRequest:
    row = await db.get(PrivacyRequest, request_id)
    if row is None or row.user_id != user_id:
        raise ValueError("privacy request not found")
    if row.status in {
        PrivacyRequestStatus.COMPLETED.value,
        PrivacyRequestStatus.REJECTED.value,
        PrivacyRequestStatus.CANCELLED.value,
    }:
        raise ValueError("此請求目前狀態不可取消")
    row.status = PrivacyRequestStatus.CANCELLED.value
    row.response_message = reason or "使用者自行取消請求"
    await db.flush()
    return row


async def list_privacy_requests(
    db: AsyncSession,
    *,
    user_id: uuid.UUID | None = None,
    status: PrivacyRequestStatus | None = None,
) -> list[PrivacyRequest]:
    stmt = select(PrivacyRequest).order_by(desc(PrivacyRequest.created_at))
    if user_id is not None:
        stmt = stmt.where(PrivacyRequest.user_id == user_id)
    if status is not None:
        stmt = stmt.where(PrivacyRequest.status == status.value)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def update_privacy_request(
    db: AsyncSession,
    *,
    request_id: uuid.UUID,
    status: PrivacyRequestStatus,
    response_message: str | None,
    handled_by: uuid.UUID,
    handled_at: datetime,
) -> PrivacyRequest:
    row = await db.get(PrivacyRequest, request_id)
    if row is None:
        raise ValueError("privacy request not found")
    row.status = status.value
    row.response_message = response_message
    row.handled_by = handled_by
    row.handled_at = handled_at
    await db.flush()
    return row


__all__ = [
    "activate_policy",
    "create_policy",
    "get_active_policy",
    "get_policy",
    "list_my_consents",
    "list_policies",
    "pending_consents",
    "record_consent",
    "create_privacy_request",
    "cancel_privacy_request",
    "list_privacy_requests",
    "update_privacy_request",
    "update_policy",
]
