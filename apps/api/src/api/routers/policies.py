"""政策版本與同意路由（ADR-003）。

公開：
    GET  /policies/public/{kind}                取得目前生效版本（含未登入）
    GET  /policies/public/{kind}/{version}       取得指定歷史版本

已登入：
    GET  /policies/me/pending                   尚未同意的政策清單
    POST /policies/me/consents                  記錄同意
    GET  /policies/me/consents                  自己同意過的歷史

管理員（permission: policy:admin）：
    GET    /policies                            列所有版本
    POST   /policies                            建新版本
    PATCH  /policies/{id}                       編輯（僅未啟用版本）
    POST   /policies/{id}/activate              啟用此版本（自動 deactivate 同 kind 其餘）
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.models.policy import PolicyKind
from api.models.user import User
from api.schemas.policy import (
    PendingConsentItem,
    PolicyConsentCreate,
    PolicyConsentOut,
    PolicyDocumentCreate,
    PolicyDocumentListItem,
    PolicyDocumentOut,
    PolicyDocumentUpdate,
    PrivacyRequestCancel,
    PrivacyRequestCreate,
    PrivacyRequestOut,
    PrivacyRequestUpdate,
)
from api.services import audit as audit_svc
from api.services import policy as policy_svc

router = APIRouter(prefix="/policies", tags=["政策與同意"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


# ── 公開（未登入也可看）─────────────────────────────────────────────


@router.get("/public/{kind}", response_model=PolicyDocumentOut)
async def get_active_policy_public(kind: PolicyKind, db: DbDep) -> PolicyDocumentOut:
    doc = await policy_svc.get_active_policy(db, kind)
    if doc is None:
        raise HTTPException(404, "目前沒有生效版本")
    return PolicyDocumentOut.model_validate(doc)


@router.get("/public/{kind}/versions", response_model=list[PolicyDocumentListItem])
async def list_policy_history_public(kind: PolicyKind, db: DbDep) -> list[PolicyDocumentListItem]:
    docs = await policy_svc.list_policies(db, kind=kind)
    return [PolicyDocumentListItem.model_validate(d) for d in docs]


@router.get("/public/{kind}/{version}", response_model=PolicyDocumentOut)
async def get_policy_version_public(kind: PolicyKind, version: str, db: DbDep) -> PolicyDocumentOut:
    docs = await policy_svc.list_policies(db, kind=kind)
    for d in docs:
        if d.version == version:
            return PolicyDocumentOut.model_validate(d)
    raise HTTPException(404, "找不到指定版本")


# ── 已登入：me ────────────────────────────────────────────────────────


@router.get("/me/pending", response_model=list[PendingConsentItem])
async def my_pending_consents(db: DbDep, user: CurrentUser) -> list[PendingConsentItem]:
    docs = await policy_svc.pending_consents(db, user.id)
    return [
        PendingConsentItem(
            policy_document_id=d.id,
            kind=PolicyKind(d.kind),
            version=d.version,
            title=d.title,
            summary_md=d.summary_md,
            effective_at=d.effective_at,
            requires_explicit_consent=d.requires_explicit_consent,
        )
        for d in docs
    ]


@router.post(
    "/me/consents",
    response_model=PolicyConsentOut,
    status_code=status.HTTP_201_CREATED,
)
async def submit_my_consent(
    body: PolicyConsentCreate,
    request: Request,
    db: DbDep,
    user: CurrentUser,
) -> PolicyConsentOut:
    doc = await policy_svc.get_policy(db, body.policy_document_id)
    if doc is None or not doc.is_active:
        raise HTTPException(400, "政策不存在或非生效版本")
    client_ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent")
    consent = await policy_svc.record_consent(
        db,
        user_id=user.id,
        policy_document_id=doc.id,
        ip_address=client_ip,
        user_agent=ua,
        agreed_at=datetime.now(UTC),
    )
    await audit_svc.record(
        db,
        entity_type="policy_document",
        entity_id=str(doc.id),
        action="policy_consent.accept",
        actor_id=str(user.id),
        actor_email=user.email,
        ip_address=client_ip,
        meta={
            "kind": doc.kind,
            "version": doc.version,
            "request_id": getattr(request.state, "request_id", None),
        },
        summary=f"同意政策：{doc.kind} v{doc.version}",
    )
    await db.commit()
    return _consent_out(consent, doc)


@router.get("/me/consents", response_model=list[PolicyConsentOut])
async def list_my_consents(db: DbDep, user: CurrentUser) -> list[PolicyConsentOut]:
    rows = await policy_svc.list_my_consents(db, user.id)
    out: list[PolicyConsentOut] = []
    for row in rows:
        doc = await policy_svc.get_policy(db, row.policy_document_id)
        out.append(_consent_out(row, doc))
    return out


@router.get("/me/privacy-requests", response_model=list[PrivacyRequestOut])
async def list_my_privacy_requests(db: DbDep, user: CurrentUser) -> list[PrivacyRequestOut]:
    rows = await policy_svc.list_privacy_requests(db, user_id=user.id)
    return [PrivacyRequestOut.model_validate(r) for r in rows]


@router.post(
    "/me/privacy-requests",
    response_model=PrivacyRequestOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_my_privacy_request(
    body: PrivacyRequestCreate,
    request: Request,
    db: DbDep,
    user: CurrentUser,
) -> PrivacyRequestOut:
    row = await policy_svc.create_privacy_request(
        db,
        user_id=user.id,
        request_type=body.request_type,
        subject=body.subject,
        description=body.description,
        submitted_ip_address=request.client.host if request.client else None,
        submitted_user_agent=request.headers.get("user-agent"),
    )
    await audit_svc.record(
        db,
        entity_type="privacy_request",
        entity_id=str(row.id),
        action="privacy_request.create",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={"request_type": body.request_type.value, "subject": body.subject},
        ip_address=request.client.host if request.client else None,
        summary=f"送出個資權利請求：{body.subject}",
    )
    await db.commit()
    return PrivacyRequestOut.model_validate(row)


@router.post("/me/privacy-requests/{request_id}/cancel", response_model=PrivacyRequestOut)
async def cancel_my_privacy_request(
    request_id: uuid.UUID,
    body: PrivacyRequestCancel,
    db: DbDep,
    user: CurrentUser,
) -> PrivacyRequestOut:
    try:
        row = await policy_svc.cancel_privacy_request(
            db,
            request_id=request_id,
            user_id=user.id,
            reason=body.reason,
        )
        await audit_svc.record(
            db,
            entity_type="privacy_request",
            entity_id=str(row.id),
            action="privacy_request.cancel",
            actor_id=str(user.id),
            actor_email=user.email,
            meta={"reason": body.reason},
            summary=f"取消個資權利請求：{row.subject}",
        )
        await db.commit()
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(400, str(exc)) from exc
    return PrivacyRequestOut.model_validate(row)


# ── 管理員 ─────────────────────────────────────────────────────────


@router.get(
    "",
    response_model=list[PolicyDocumentListItem],
    dependencies=[Depends(require_permission("policy:admin"))],
)
async def admin_list_policies(
    db: DbDep, kind: PolicyKind | None = None
) -> list[PolicyDocumentListItem]:
    docs = await policy_svc.list_policies(db, kind=kind)
    return [PolicyDocumentListItem.model_validate(d) for d in docs]


@router.post(
    "",
    response_model=PolicyDocumentOut,
    status_code=status.HTTP_201_CREATED,
)
async def admin_create_policy(
    body: PolicyDocumentCreate,
    db: DbDep,
    user: Annotated[User, Depends(require_permission("policy:admin"))],
) -> PolicyDocumentOut:
    try:
        doc = await policy_svc.create_policy(
            db,
            kind=body.kind,
            version=body.version,
            title=body.title,
            content_md=body.content_md,
            summary_md=body.summary_md,
            effective_at=body.effective_at,
            requires_explicit_consent=body.requires_explicit_consent,
            published_by=user.id,
        )
        await db.commit()
    except Exception as exc:
        await db.rollback()
        raise HTTPException(409, "同 kind / version 已存在") from exc
    return PolicyDocumentOut.model_validate(doc)


@router.patch(
    "/{policy_id}",
    response_model=PolicyDocumentOut,
    dependencies=[Depends(require_permission("policy:admin"))],
)
async def admin_update_policy(
    policy_id: uuid.UUID,
    body: PolicyDocumentUpdate,
    db: DbDep,
) -> PolicyDocumentOut:
    try:
        doc = await policy_svc.update_policy(
            db,
            policy_id,
            title=body.title,
            content_md=body.content_md,
            summary_md=body.summary_md,
            effective_at=body.effective_at,
            requires_explicit_consent=body.requires_explicit_consent,
        )
        await db.commit()
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(400, str(exc)) from exc
    return PolicyDocumentOut.model_validate(doc)


@router.post(
    "/{policy_id}/activate",
    response_model=PolicyDocumentOut,
    dependencies=[Depends(require_permission("policy:admin"))],
)
async def admin_activate_policy(policy_id: uuid.UUID, db: DbDep) -> PolicyDocumentOut:
    try:
        doc = await policy_svc.activate_policy(db, policy_id)
        await db.commit()
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(404, str(exc)) from exc
    return PolicyDocumentOut.model_validate(doc)


@router.get(
    "/privacy-requests",
    response_model=list[PrivacyRequestOut],
    dependencies=[Depends(require_permission("system:privacy"))],
)
async def admin_list_privacy_requests(db: DbDep) -> list[PrivacyRequestOut]:
    rows = await policy_svc.list_privacy_requests(db)
    return [PrivacyRequestOut.model_validate(r) for r in rows]


@router.patch(
    "/privacy-requests/{request_id}",
    response_model=PrivacyRequestOut,
)
async def admin_update_privacy_request(
    request_id: uuid.UUID,
    body: PrivacyRequestUpdate,
    db: DbDep,
    user: Annotated[User, Depends(require_permission("system:privacy"))],
) -> PrivacyRequestOut:
    try:
        row = await policy_svc.update_privacy_request(
            db,
            request_id=request_id,
            status=body.status,
            response_message=body.response_message,
            handled_by=user.id,
            handled_at=datetime.now(UTC),
        )
        await audit_svc.record(
            db,
            entity_type="privacy_request",
            entity_id=str(row.id),
            action="privacy_request.update",
            actor_id=str(user.id),
            actor_email=user.email,
            meta={"status": body.status.value},
            summary=f"更新個資權利請求狀態：{body.status.value}",
        )
        await db.commit()
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(404, str(exc)) from exc
    return PrivacyRequestOut.model_validate(row)


def _consent_out(consent, doc) -> PolicyConsentOut:
    out = PolicyConsentOut.model_validate(consent)
    if doc is None:
        return out
    out.policy_kind = PolicyKind(doc.kind)
    out.policy_version = doc.version
    out.policy_title = doc.title
    return out
