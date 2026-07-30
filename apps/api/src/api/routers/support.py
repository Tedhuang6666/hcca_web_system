"""客服作業平台 API。

所有客服動作都使用細項權限、工單與原因。這個 router 不提供任意欄位 PATCH、SQL
或 shell 入口；高風險修改只建立核准申請，由不同客服主管執行。
"""

from __future__ import annotations

import csv
import hashlib
import io
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_any
from api.models.support import (
    SupportApproval,
    SupportApprovalStatus,
    SupportAssistanceSession,
    SupportAssistanceStatus,
    SupportAuditLog,
    SupportGuideEntry,
    SupportImpersonationSession,
    SupportTicket,
    SupportTicketStatus,
)
from api.models.user import User
from api.schemas.support import (
    SupportApprovalCreateRequest,
    SupportApprovalReviewRequest,
    SupportAssistanceCreateRequest,
    SupportAssistanceJoinRequest,
    SupportAssistanceStateRequest,
    SupportContactUpdateRequest,
    SupportDashboardOut,
    SupportGuideCreateRequest,
    SupportGuideUpdateRequest,
    SupportImpersonationStartOut,
    SupportImpersonationStartRequest,
    SupportProfileUpdateRequest,
    SupportReasonRequest,
    SupportSensitiveOut,
    SupportTicketCreateRequest,
    SupportTicketEventCreateRequest,
    SupportTicketOut,
    SupportTicketUpdateRequest,
    SupportUserDetailOut,
    SupportUserSummaryOut,
)
from api.services import support as support_svc
from api.services.permission import get_user_permission_codes

router = APIRouter(prefix="/support", tags=["客服作業平台"])
DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


def support_guard(*codes: str):
    return require_any(*codes, PermissionCode.ADMIN_ALL)


SupportRead = Annotated[
    User,
    Depends(support_guard(support_svc.SUPPORT_USERS_READ, support_svc.SUPPORT_TICKETS_READ)),
]
TicketCreate = Annotated[
    User,
    Depends(support_guard(support_svc.SUPPORT_TICKETS_CREATE)),
]
TicketManage = Annotated[
    User,
    Depends(support_guard(support_svc.SUPPORT_TICKETS_MANAGE)),
]
ApprovalReview = Annotated[
    User,
    Depends(support_guard(support_svc.SUPPORT_APPROVALS_REVIEW)),
]
AuditRead = Annotated[
    User,
    Depends(support_guard(support_svc.SUPPORT_AUDIT_READ)),
]
GuideManage = Annotated[
    User,
    Depends(support_guard(support_svc.SUPPORT_GUIDES_MANAGE)),
]
AssistanceManage = Annotated[
    User,
    Depends(support_guard(support_svc.SUPPORT_ASSISTANCE_MANAGE)),
]


def _raise_value_error(exc: ValueError) -> HTTPException:
    message = str(exc)
    code = (
        status.HTTP_409_CONFLICT
        if "已" in message or "存在" in message
        else status.HTTP_400_BAD_REQUEST
    )
    return HTTPException(code, message)


async def _get_user(db: AsyncSession, user_id: uuid.UUID) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "使用者不存在")
    return user


async def _get_ticket(db: AsyncSession, ticket_id: uuid.UUID) -> SupportTicket:
    ticket = await support_svc.get_ticket(db, ticket_id)
    if ticket is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "工單不存在")
    return ticket


async def _require_bound_ticket(
    db: AsyncSession, ticket_id: uuid.UUID, target_user_id: uuid.UUID
) -> SupportTicket:
    ticket = await db.get(SupportTicket, ticket_id)
    if ticket is None or not ticket.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "工單不存在或已封存")
    if ticket.user_id != target_user_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "工單未綁定此使用者")
    return ticket


async def _require_action_permission(db: AsyncSession, actor: User, action: str) -> None:
    required = {
        "unlock": support_svc.SUPPORT_USERS_UNLOCK,
        "revoke_sessions": support_svc.SUPPORT_USERS_REVOKE_SESSIONS,
        "reset_mfa": support_svc.SUPPORT_USERS_RESET_MFA,
        "refresh_permissions": support_svc.SUPPORT_USERS_EDIT_PROFILE,
        "rebuild_profile": support_svc.SUPPORT_USERS_EDIT_PROFILE,
        "rebuild_navigation": support_svc.SUPPORT_USERS_EDIT_PROFILE,
        "resend_verification": support_svc.SUPPORT_USERS_EDIT_EMAIL,
    }.get(action)
    if required is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "不支援的修復動作")
    if actor.is_superuser:
        return
    codes = await get_user_permission_codes(db, actor.id)
    if required not in codes:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"需要權限：{required}")


def _ticket_out(ticket: SupportTicket) -> SupportTicketOut:
    return SupportTicketOut(
        id=ticket.id,
        ticket_number=ticket.ticket_number,
        title=ticket.title,
        description=ticket.description,
        user_id=ticket.user_id,
        reported_by_user_id=ticket.reported_by_user_id,
        assigned_to_id=ticket.assigned_to_id,
        channel=ticket.channel,
        priority=str(ticket.priority),
        status=str(ticket.status),
        error_code=ticket.error_code,
        request_id=ticket.request_id,
        related_data=ticket.related_data or {},
        resolution=ticket.resolution,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
        closed_at=ticket.closed_at,
        events=[
            {
                "id": event.id,
                "actor_user_id": event.actor_user_id,
                "event_type": event.event_type,
                "body": event.body,
                "metadata": event.event_metadata or {},
                "created_at": event.created_at,
            }
            for event in sorted(ticket.events, key=lambda row: row.created_at)
        ],
    )


@router.get("/dashboard", response_model=SupportDashboardOut)
async def support_dashboard(db: DbDep, actor: SupportRead) -> SupportDashboardOut:
    open_count = await db.scalar(
        select(func.count())
        .select_from(SupportTicket)
        .where(
            SupportTicket.status.not_in([SupportTicketStatus.RESOLVED, SupportTicketStatus.CLOSED]),
            SupportTicket.is_active.is_(True),
        )
    )
    urgent_count = await db.scalar(
        select(func.count())
        .select_from(SupportTicket)
        .where(
            SupportTicket.priority == "urgent",
            SupportTicket.status.not_in([SupportTicketStatus.RESOLVED, SupportTicketStatus.CLOSED]),
        )
    )
    pending_count = await db.scalar(
        select(func.count())
        .select_from(SupportApproval)
        .where(SupportApproval.status == SupportApprovalStatus.PENDING)
    )
    assistance_count = await db.scalar(
        select(func.count())
        .select_from(SupportAssistanceSession)
        .where(
            SupportAssistanceSession.status.in_(
                [
                    SupportAssistanceStatus.WAITING,
                    SupportAssistanceStatus.ACTIVE,
                ]
            )
        )
    )
    impersonation_count = await db.scalar(
        select(func.count())
        .select_from(SupportImpersonationSession)
        .where(
            SupportImpersonationSession.ended_at.is_(None),
            SupportImpersonationSession.expires_at > datetime.now(UTC),
        )
    )
    actions = list(
        (
            await db.scalars(
                select(SupportAuditLog).order_by(SupportAuditLog.created_at.desc()).limit(12)
            )
        ).all()
    )
    return SupportDashboardOut(
        open_tickets=int(open_count or 0),
        urgent_tickets=int(urgent_count or 0),
        pending_approvals=int(pending_count or 0),
        active_assistance_sessions=int(assistance_count or 0),
        active_impersonation_sessions=int(impersonation_count or 0),
        recent_actions=[
            {
                "id": row.id,
                "action": row.action,
                "risk_level": row.risk_level,
                "target_user_id": row.target_user_id,
                "ticket_id": row.ticket_id,
                "created_at": row.created_at,
            }
            for row in actions
        ],
    )


@router.get("/users", response_model=list[SupportUserSummaryOut])
async def search_support_users(
    db: DbDep,
    actor: SupportRead,
    keyword: str | None = Query(None, min_length=1, max_length=200),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[SupportUserSummaryOut]:
    users = await support_svc.search_users(db, keyword=keyword, limit=limit, offset=offset)
    return [SupportUserSummaryOut.model_validate(support_svc.user_summary(user)) for user in users]


@router.get("/users/{user_id}", response_model=SupportUserDetailOut)
async def get_support_user(
    user_id: uuid.UUID,
    db: DbDep,
    actor: SupportRead,
    diagnose: bool = Query(False),
) -> SupportUserDetailOut:
    user = await _get_user(db, user_id)
    return SupportUserDetailOut.model_validate(
        await support_svc.user_detail(db, user, include_diagnostics=diagnose)
    )


@router.post("/users/{user_id}/sensitive", response_model=SupportSensitiveOut)
async def reveal_sensitive_user(
    user_id: uuid.UUID,
    body: SupportReasonRequest,
    request: Request,
    db: DbDep,
    actor: Annotated[User, Depends(support_guard(support_svc.SUPPORT_USERS_VIEW_SENSITIVE))],
) -> SupportSensitiveOut:
    user = await _get_user(db, user_id)
    await _require_bound_ticket(db, body.ticket_id, user.id)
    emails = await support_svc.linked_emails(db, user)
    await support_svc.record_support_audit(
        db,
        actor=actor,
        action="user.sensitive.reveal",
        reason=body.reason,
        resource_type="user",
        resource_id=str(user.id),
        target_user_id=user.id,
        ticket_id=body.ticket_id,
        risk_level="medium",
        after_data={"fields": ["email", "linked_emails", "student_id"]},
        request=request,
    )
    return SupportSensitiveOut(
        user_id=user.id,
        email=user.email,
        linked_emails=emails,
        student_id=user.student_id,
        reason=body.reason,
    )


@router.post("/users/{user_id}/diagnose", response_model=list[dict])
async def diagnose_support_user(
    user_id: uuid.UUID,
    body: SupportReasonRequest,
    request: Request,
    db: DbDep,
    actor: SupportRead,
) -> list[dict]:
    user = await _get_user(db, user_id)
    await _require_bound_ticket(db, body.ticket_id, user.id)
    diagnostics = await support_svc.diagnose_user(db, user)
    await support_svc.record_support_audit(
        db,
        actor=actor,
        action="user.diagnose",
        reason=body.reason,
        resource_type="user",
        resource_id=str(user.id),
        target_user_id=user.id,
        ticket_id=body.ticket_id,
        after_data={"diagnostic_count": len(diagnostics)},
        request=request,
    )
    return diagnostics


@router.patch("/users/{user_id}/profile", response_model=SupportUserDetailOut)
async def edit_support_profile(
    user_id: uuid.UUID,
    body: SupportProfileUpdateRequest,
    request: Request,
    db: DbDep,
    actor: Annotated[User, Depends(support_guard(support_svc.SUPPORT_USERS_EDIT_PROFILE))],
) -> SupportUserDetailOut:
    user = await _get_user(db, user_id)
    await _require_bound_ticket(db, body.ticket_id, user.id)
    changes = body.model_dump(exclude_unset=True, exclude={"ticket_id", "reason", "confirm_change"})
    if "student_id" in changes and not body.confirm_change:
        raise HTTPException(status.HTTP_409_CONFLICT, "修改學號需要再次確認")
    try:
        result = await support_svc.update_profile(
            db,
            actor=actor,
            user=user,
            changes=changes,
            ticket_id=body.ticket_id,
            reason=body.reason,
            request=request,
        )
    except ValueError as exc:
        raise _raise_value_error(exc) from exc
    return SupportUserDetailOut.model_validate(result)


@router.patch("/users/{user_id}/contact", response_model=SupportUserDetailOut)
async def edit_support_contact(
    user_id: uuid.UUID,
    body: SupportContactUpdateRequest,
    request: Request,
    db: DbDep,
    actor: Annotated[User, Depends(support_guard(support_svc.SUPPORT_USERS_EDIT_EMAIL))],
) -> SupportUserDetailOut:
    if not body.confirm_change:
        raise HTTPException(status.HTTP_409_CONFLICT, "修改 Email 需要再次確認")
    user = await _get_user(db, user_id)
    await _require_bound_ticket(db, body.ticket_id, user.id)
    try:
        result = await support_svc.update_contact(
            db,
            actor=actor,
            user=user,
            email=body.email,
            ticket_id=body.ticket_id,
            reason=body.reason,
            request=request,
        )
    except ValueError as exc:
        raise _raise_value_error(exc) from exc
    return SupportUserDetailOut.model_validate(result)


@router.post("/users/{user_id}/actions/{action}")
async def run_support_repair(
    user_id: uuid.UUID,
    action: str,
    body: SupportReasonRequest,
    request: Request,
    db: DbDep,
    actor: Annotated[User, Depends(support_guard(support_svc.SUPPORT_USERS_READ))],
) -> dict:
    await _require_action_permission(db, actor, action)
    user = await _get_user(db, user_id)
    await _require_bound_ticket(db, body.ticket_id, user.id)
    try:
        return await support_svc.run_repair(
            db,
            actor=actor,
            user=user,
            action=action,
            ticket_id=body.ticket_id,
            reason=body.reason,
            request=request,
        )
    except ValueError as exc:
        raise _raise_value_error(exc) from exc


@router.post("/tickets", response_model=SupportTicketOut, status_code=status.HTTP_201_CREATED)
async def create_support_ticket(
    body: SupportTicketCreateRequest,
    request: Request,
    db: DbDep,
    actor: TicketCreate,
) -> SupportTicketOut:
    try:
        ticket = await support_svc.create_ticket(
            db,
            actor=actor,
            title=body.title,
            description=body.description,
            user_id=body.user_id,
            channel=body.channel,
            priority=body.priority,
            error_code=body.error_code,
            request_id=body.request_id,
            related_data=body.related_data,
            request=request,
        )
    except ValueError as exc:
        raise _raise_value_error(exc) from exc
    return _ticket_out(ticket)


@router.get("/tickets", response_model=list[SupportTicketOut])
async def list_support_tickets(
    db: DbDep,
    actor: SupportRead,
    ticket_status: str | None = Query(None, alias="status"),
    priority: str | None = None,
    user_id: uuid.UUID | None = None,
    keyword: str | None = Query(None, max_length=200),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[SupportTicketOut]:
    query = select(SupportTicket).order_by(SupportTicket.updated_at.desc())
    if ticket_status:
        query = query.where(SupportTicket.status == ticket_status)
    if priority:
        query = query.where(SupportTicket.priority == priority)
    if user_id:
        query = query.where(SupportTicket.user_id == user_id)
    if keyword:
        needle = f"%{keyword.strip().lower()}%"
        query = query.where(
            func.lower(SupportTicket.ticket_number).like(needle)
            | func.lower(SupportTicket.title).like(needle)
            | func.lower(func.coalesce(SupportTicket.error_code, "")).like(needle)
        )
    rows = list((await db.scalars(query.limit(limit).offset(offset))).all())
    for row in rows:
        await db.refresh(row, ["events"])
    return [_ticket_out(row) for row in rows]


@router.get("/tickets/{ticket_id}", response_model=SupportTicketOut)
async def get_support_ticket(
    ticket_id: uuid.UUID, db: DbDep, actor: SupportRead
) -> SupportTicketOut:
    return _ticket_out(await _get_ticket(db, ticket_id))


@router.patch("/tickets/{ticket_id}", response_model=SupportTicketOut)
async def update_support_ticket(
    ticket_id: uuid.UUID,
    body: SupportTicketUpdateRequest,
    request: Request,
    db: DbDep,
    actor: TicketManage,
) -> SupportTicketOut:
    ticket = await _get_ticket(db, ticket_id)
    before = {
        "status": str(ticket.status),
        "priority": str(ticket.priority),
        "assigned_to_id": ticket.assigned_to_id,
    }
    changes = body.model_dump(exclude_unset=True, exclude={"note"})
    if "status" in changes:
        ticket.status = changes["status"]
        if ticket.status in {SupportTicketStatus.RESOLVED, SupportTicketStatus.CLOSED}:
            ticket.closed_at = datetime.now(UTC)
        else:
            ticket.closed_at = None
    if "priority" in changes:
        ticket.priority = changes["priority"]
    if "assigned_to_id" in changes:
        if (
            changes["assigned_to_id"] is not None
            and await db.get(User, changes["assigned_to_id"]) is None
        ):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "指派的客服不存在")
        ticket.assigned_to_id = changes["assigned_to_id"]
    if "resolution" in changes:
        ticket.resolution = changes["resolution"]
    await db.flush()
    if body.note:
        await support_svc.add_ticket_event(
            db, ticket=ticket, actor=actor, event_type="internal_note", body=body.note
        )
    await support_svc.record_support_audit(
        db,
        actor=actor,
        action="ticket.update",
        reason=body.note or "更新工單狀態",
        resource_type="ticket",
        resource_id=str(ticket.id),
        ticket_id=ticket.id,
        target_user_id=ticket.user_id,
        before_data=before,
        after_data={
            "status": str(ticket.status),
            "priority": str(ticket.priority),
            "assigned_to_id": ticket.assigned_to_id,
        },
        request=request,
    )
    return _ticket_out(ticket)


@router.post("/tickets/{ticket_id}/events", response_model=SupportTicketOut)
async def add_support_ticket_event(
    ticket_id: uuid.UUID,
    body: SupportTicketEventCreateRequest,
    request: Request,
    db: DbDep,
    actor: TicketManage,
) -> SupportTicketOut:
    ticket = await _get_ticket(db, ticket_id)
    await support_svc.add_ticket_event(
        db, ticket=ticket, actor=actor, event_type=body.event_type, body=body.body
    )
    await support_svc.record_support_audit(
        db,
        actor=actor,
        action="ticket.event.create",
        reason=body.body[:500],
        resource_type="ticket",
        resource_id=str(ticket.id),
        ticket_id=ticket.id,
        target_user_id=ticket.user_id,
        request=request,
    )
    return _ticket_out(ticket)


@router.post("/users/{user_id}/approvals", response_model=dict, status_code=status.HTTP_201_CREATED)
async def request_support_approval(
    user_id: uuid.UUID,
    body: SupportApprovalCreateRequest,
    request: Request,
    db: DbDep,
    actor: Annotated[User, Depends(support_guard(support_svc.SUPPORT_USERS_READ))],
) -> dict:
    target = await _get_user(db, user_id)
    if target.id != body.target_user_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "路徑與 payload 的目標使用者不一致")
    await _require_bound_ticket(db, body.ticket_id, target.id)
    try:
        approval = await support_svc.create_approval(
            db,
            actor=actor,
            target_user=target,
            ticket_id=body.ticket_id,
            action=body.action,
            payload=body.payload,
            reason=body.reason,
            request=request,
        )
    except ValueError as exc:
        raise _raise_value_error(exc) from exc
    return {
        "id": approval.id,
        "approval_number": approval.approval_number,
        "status": approval.status,
        "action": approval.action,
        "target_user_id": approval.target_user_id,
        "requested_at": approval.requested_at,
    }


@router.get("/approvals", response_model=list[dict])
async def list_support_approvals(
    db: DbDep,
    actor: Annotated[User, Depends(support_guard(support_svc.SUPPORT_USERS_READ))],
    approval_status: str | None = Query(None, alias="status"),
) -> list[dict]:
    query = select(SupportApproval).order_by(SupportApproval.requested_at.desc())
    if approval_status:
        query = query.where(SupportApproval.status == approval_status)
    rows = list((await db.scalars(query.limit(200))).all())
    return [
        {
            "id": row.id,
            "approval_number": row.approval_number,
            "requested_by": row.requested_by,
            "approved_by": row.approved_by,
            "ticket_id": row.ticket_id,
            "target_user_id": row.target_user_id,
            "action": row.action,
            "payload": row.payload,
            "reason": row.reason,
            "risk_level": row.risk_level,
            "status": row.status,
            "requested_at": row.requested_at,
            "reviewed_at": row.reviewed_at,
            "executed_at": row.executed_at,
            "review_note": row.review_note,
            "result": row.result,
        }
        for row in rows
    ]


@router.post("/approvals/{approval_id}/review", response_model=dict)
async def review_support_approval(
    approval_id: uuid.UUID,
    body: SupportApprovalReviewRequest,
    request: Request,
    db: DbDep,
    actor: ApprovalReview,
) -> dict:
    approval = await db.get(SupportApproval, approval_id)
    if approval is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "核准申請不存在")
    if not body.approved:
        if approval.status != SupportApprovalStatus.PENDING:
            raise HTTPException(status.HTTP_409_CONFLICT, "此核准申請已處理")
        approval.status = SupportApprovalStatus.REJECTED
        approval.approved_by = actor.id
        approval.reviewed_at = datetime.now(UTC)
        approval.review_note = body.note
        await db.flush()
        await support_svc.record_support_audit(
            db,
            actor=actor,
            action="approval.reject",
            reason=body.note,
            resource_type="approval",
            resource_id=str(approval.id),
            target_user_id=approval.target_user_id,
            ticket_id=approval.ticket_id,
            risk_level="high",
            request=request,
        )
        return {"approval_number": approval.approval_number, "status": approval.status}
    try:
        return await support_svc.execute_approval(
            db, approval=approval, approver=actor, request=request
        )
    except ValueError as exc:
        raise _raise_value_error(exc) from exc


@router.post("/impersonation/start", response_model=SupportImpersonationStartOut)
async def start_support_impersonation(
    body: SupportImpersonationStartRequest,
    request: Request,
    db: DbDep,
    actor: Annotated[User, Depends(support_guard(support_svc.SUPPORT_USERS_IMPERSONATE))],
) -> SupportImpersonationStartOut:
    if not actor.is_superuser:
        codes = await get_user_permission_codes(db, actor.id)
        if PermissionCode.ADMIN_IMPERSONATE not in codes:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "代理登入仍需要 admin:impersonate 安全權限"
            )
        if (
            body.mode == "interactive"
            and support_svc.SUPPORT_USERS_IMPERSONATE_INTERACTIVE not in codes
        ):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "可操作模擬需要 support.users.impersonate_interactive 權限",
            )
    target = await _get_user(db, body.target_user_id)
    await _require_bound_ticket(db, body.ticket_id, target.id)
    try:
        session, token, expires_at = await support_svc.start_impersonation(
            db,
            actor=actor,
            target=target,
            ticket_id=body.ticket_id,
            reason=body.reason,
            mode=body.mode,
            minutes=body.minutes,
            request=request,
        )
    except ValueError as exc:
        raise _raise_value_error(exc) from exc
    return SupportImpersonationStartOut(
        token=token,
        session_id=session.id,
        expires_at=expires_at,
        target_user_id=target.id,
        target_email=target.email,
        target_display_name=target.display_name,
        actor_email=actor.email,
        actor_display_name=actor.display_name,
        read_only=body.mode == "read_only",
    )


@router.post("/impersonation/{session_id}/end", status_code=status.HTTP_204_NO_CONTENT)
async def end_support_impersonation(
    session_id: uuid.UUID,
    body: SupportReasonRequest,
    request: Request,
    db: DbDep,
    actor: Annotated[User, Depends(support_guard(support_svc.SUPPORT_USERS_IMPERSONATE))],
    token: str = Query(..., min_length=20),
) -> None:
    session = await db.get(SupportImpersonationSession, session_id)
    if session is None or session.real_user_id != actor.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "模擬工作階段不存在")
    if session.ticket_id != body.ticket_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "結束原因的工單與模擬工作階段不一致")
    if session.ended_at is not None:
        return
    digest = hashlib.sha256(token.encode()).hexdigest()
    if digest != session.token_hash:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "模擬 token 不符合工作階段")
    await support_svc.end_impersonation(
        db, actor=actor, session=session, token=token, reason=body.reason, request=request
    )


@router.post("/assistance", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_support_assistance(
    body: SupportAssistanceCreateRequest,
    request: Request,
    db: DbDep,
    actor: AssistanceManage,
) -> dict:
    user = await _get_user(db, body.user_id)
    await _require_bound_ticket(db, body.ticket_id, user.id)
    session = await support_svc.create_assistance(
        db,
        actor=actor,
        user=user,
        ticket_id=body.ticket_id,
        reason=body.reason,
        expires_minutes=body.expires_minutes,
        current_route=body.current_route,
        request=request,
    )
    return {
        "id": session.id,
        "assistance_code": session.assistance_code,
        "status": session.status,
        "expires_at": session.expires_at,
        "target_user_id": user.id,
    }


@router.post("/assistance/join", response_model=dict)
async def join_support_assistance(
    body: SupportAssistanceJoinRequest,
    request: Request,
    db: DbDep,
    actor: CurrentUser,
) -> dict:
    session = await db.scalar(
        select(SupportAssistanceSession).where(
            SupportAssistanceSession.assistance_code == body.code
        )
    )
    if session is None or session.user_id != actor.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "協助碼不存在或不屬於此帳號")
    if await support_svc.expire_assistance_if_needed(session):
        await db.flush()
    if session.status not in {SupportAssistanceStatus.WAITING, SupportAssistanceStatus.ACTIVE}:
        raise HTTPException(status.HTTP_409_CONFLICT, "協助碼已失效")
    session.status = SupportAssistanceStatus.ACTIVE
    session.joined_at = datetime.now(UTC)
    await db.flush()
    await support_svc.record_support_audit(
        db,
        actor=actor,
        action="assistance.join",
        reason="使用者輸入協助碼並同意客服協助",
        resource_type="assistance",
        resource_id=str(session.id),
        target_user_id=actor.id,
        ticket_id=session.ticket_id,
        request=request,
    )
    return {"id": session.id, "status": session.status, "expires_at": session.expires_at}


@router.get("/assistance/{session_id}", response_model=dict)
async def get_support_assistance(session_id: uuid.UUID, db: DbDep, actor: AssistanceManage) -> dict:
    session = await support_svc.get_assistance(db, session_id)
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "協助工作階段不存在")
    if await support_svc.expire_assistance_if_needed(session):
        await db.flush()
    return {
        "id": session.id,
        "status": session.status,
        "user_id": session.user_id,
        "ticket_id": session.ticket_id,
        "current_route": session.current_route,
        "client_state": session.client_state,
        "expires_at": session.expires_at,
    }


@router.patch("/assistance/{session_id}/state", response_model=dict)
async def update_support_assistance_state(
    session_id: uuid.UUID,
    body: SupportAssistanceStateRequest,
    db: DbDep,
    actor: CurrentUser,
) -> dict:
    session = await support_svc.get_assistance(db, session_id)
    if session is None or actor.id not in {session.user_id, session.support_user_id}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "協助工作階段不存在")
    if await support_svc.expire_assistance_if_needed(session):
        await db.flush()
    if session.status != SupportAssistanceStatus.ACTIVE:
        raise HTTPException(status.HTTP_409_CONFLICT, "協助工作階段尚未啟用")
    session.current_route = body.current_route
    session.client_state = body.client_state
    await db.flush()
    return {"id": session.id, "status": session.status, "current_route": session.current_route}


@router.post("/assistance/{session_id}/close", status_code=status.HTTP_204_NO_CONTENT)
async def close_support_assistance(
    session_id: uuid.UUID,
    body: SupportReasonRequest,
    request: Request,
    db: DbDep,
    actor: AssistanceManage,
) -> None:
    session = await support_svc.get_assistance(db, session_id)
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "協助工作階段不存在")
    if session.ticket_id != body.ticket_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "結束原因的工單與協助工作階段不一致")
    session.status = SupportAssistanceStatus.CLOSED
    session.closed_at = datetime.now(UTC)
    await db.flush()
    await support_svc.record_support_audit(
        db,
        actor=actor,
        action="assistance.close",
        reason=body.reason,
        resource_type="assistance",
        resource_id=str(session.id),
        target_user_id=session.user_id,
        ticket_id=session.ticket_id,
        request=request,
    )


@router.get("/guides", response_model=list[dict])
async def list_support_guides(db: DbDep, actor: SupportRead) -> list[dict]:
    rows = list(
        (
            await db.scalars(
                select(SupportGuideEntry)
                .where(SupportGuideEntry.is_active.is_(True))
                .order_by(SupportGuideEntry.category, SupportGuideEntry.title)
            )
        ).all()
    )
    return [
        {
            "id": row.id,
            "slug": row.slug,
            "title": row.title,
            "summary": row.summary,
            "body": row.body,
            "category": row.category,
            "required_permissions": row.required_permissions,
            "route": row.route,
            "is_active": row.is_active,
        }
        for row in rows
    ]


@router.post("/guides", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_support_guide(
    body: SupportGuideCreateRequest,
    request: Request,
    db: DbDep,
    actor: GuideManage,
) -> dict:
    if await db.scalar(select(SupportGuideEntry).where(SupportGuideEntry.slug == body.slug)):
        raise HTTPException(status.HTTP_409_CONFLICT, "此知識庫 slug 已存在")
    row = SupportGuideEntry(**body.model_dump(), created_by_id=actor.id, updated_by_id=actor.id)
    db.add(row)
    await db.flush()
    await support_svc.record_support_audit(
        db,
        actor=actor,
        action="guide.create",
        reason="建立客服操作引導",
        resource_type="guide",
        resource_id=str(row.id),
        after_data={"slug": row.slug, "title": row.title},
        request=request,
    )
    return {"id": row.id, **body.model_dump(), "is_active": row.is_active}


@router.patch("/guides/{guide_id}", response_model=dict)
async def update_support_guide(
    guide_id: uuid.UUID,
    body: SupportGuideUpdateRequest,
    request: Request,
    db: DbDep,
    actor: GuideManage,
) -> dict:
    row = await db.get(SupportGuideEntry, guide_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "知識庫項目不存在")
    changes = body.model_dump(exclude_unset=True)
    before = {key: getattr(row, key) for key in changes}
    for key, value in changes.items():
        setattr(row, key, value)
    row.updated_by_id = actor.id
    await db.flush()
    await support_svc.record_support_audit(
        db,
        actor=actor,
        action="guide.update",
        reason="更新客服操作引導",
        resource_type="guide",
        resource_id=str(row.id),
        before_data=before,
        after_data=changes,
        request=request,
    )
    return {
        "id": row.id,
        "slug": row.slug,
        **{
            key: getattr(row, key)
            for key in [
                "title",
                "summary",
                "body",
                "category",
                "required_permissions",
                "route",
                "is_active",
            ]
        },
    }


@router.get("/audit", response_model=list[dict])
async def list_support_audit(
    db: DbDep,
    actor: AuditRead,
    actor_user_id: uuid.UUID | None = None,
    target_user_id: uuid.UUID | None = None,
    ticket_id: uuid.UUID | None = None,
    action: str | None = None,
    risk_level: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[dict]:
    query = select(SupportAuditLog).order_by(SupportAuditLog.created_at.desc())
    if actor_user_id:
        query = query.where(SupportAuditLog.actor_user_id == actor_user_id)
    if target_user_id:
        query = query.where(SupportAuditLog.target_user_id == target_user_id)
    if ticket_id:
        query = query.where(SupportAuditLog.ticket_id == ticket_id)
    if action:
        query = query.where(SupportAuditLog.action == action)
    if risk_level:
        query = query.where(SupportAuditLog.risk_level == risk_level)
    rows = list((await db.scalars(query.limit(limit).offset(offset))).all())
    return [
        {
            "id": row.id,
            "actor_user_id": row.actor_user_id,
            "target_user_id": row.target_user_id,
            "ticket_id": row.ticket_id,
            "action": row.action,
            "resource_type": row.resource_type,
            "resource_id": row.resource_id,
            "risk_level": row.risk_level,
            "reason": row.reason,
            "before_data": row.before_data,
            "after_data": row.after_data,
            "request_id": row.request_id,
            "ip_address": support_svc.mask_ip(row.ip_address),
            "user_agent": row.user_agent,
            "created_at": row.created_at,
        }
        for row in rows
    ]


@router.get("/audit/export.csv", response_class=Response)
async def export_support_audit(
    db: DbDep,
    actor: Annotated[User, Depends(support_guard(support_svc.SUPPORT_AUDIT_EXPORT))],
    limit: int = Query(5000, ge=1, le=10000),
) -> Response:
    rows = list(
        (
            await db.scalars(
                select(SupportAuditLog).order_by(SupportAuditLog.created_at.desc()).limit(limit)
            )
        ).all()
    )
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "created_at",
            "action",
            "risk_level",
            "actor_user_id",
            "target_user_id",
            "ticket_id",
            "reason",
            "request_id",
            "ip_address",
        ]
    )
    for row in rows:
        writer.writerow(
            [
                row.created_at.isoformat(),
                row.action,
                row.risk_level,
                row.actor_user_id,
                row.target_user_id or "",
                row.ticket_id or "",
                row.reason,
                row.request_id or "",
                support_svc.mask_ip(row.ip_address) or "",
            ]
        )
    return Response(
        content="\ufeff" + output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="support_audit.csv"'},
    )


@router.get("/verify-email")
async def verify_support_email(token: str, db: DbDep) -> dict:
    user = await support_svc.verify_email_token(db, token)
    if user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "驗證連結已失效")
    return {"message": "Email 已完成驗證", "user_id": user.id}
