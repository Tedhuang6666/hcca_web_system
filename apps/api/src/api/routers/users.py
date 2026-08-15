"""使用者路由 - /users"""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.auth_cookies import (
    delete_auth_cookies,
    refresh_token_from_cookies,
)
from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.models.audit_log import AuditLog
from api.models.user import User
from api.models.user_identity import UserIdentity
from api.models.user_session import UserSession
from api.schemas.auth import UserRead
from api.services import audit as audit_svc
from api.services import user_email_verification as email_verification_svc
from api.services import user_registration as user_registration_svc
from api.services import user_session as user_session_svc
from api.services.permission import get_user_permission_codes
from api.services.user_registration import UserRegistrationError

router = APIRouter(prefix="/users", tags=["使用者"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


class UserSelfUpdate(BaseModel):
    display_name: str | None = Field(None, min_length=1, max_length=100)
    student_id: str | None = Field(None, max_length=20)
    show_email: bool | None = None


def _verified_student_id_from_email(email: str) -> str | None:
    """由本人已驗證的校園 Google 信箱推導學號（與 auth.py 的登入派生邏輯一致）。

    學號是身分信任錨點：roster/RBAC 會以 student_id 將使用者連結到 Person 主檔並
    同步其職務權限（見 services/person.ensure_person_for_user）。因此自助更新時，
    student_id 只能設成「由本人已驗證校園信箱推導出的值」，不可任意自填他人學號，
    否則外部帳號可冒領未註冊學生的學號而綁定其身分與權限。
    """
    normalized = email.strip().lower()
    if normalized.endswith("@hchs.hc.edu.tw") and normalized.startswith("g0"):
        return normalized[2:].split("@", maxsplit=1)[0]
    return None


class UserSummary(BaseModel):
    id: uuid.UUID
    display_name: str
    email: str = ""
    student_id: str | None = None

    model_config = {"from_attributes": True}


class EmailVerificationRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)


class EmailVerificationConfirm(EmailVerificationRequest):
    code: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")


class LinkedEmailsOut(BaseModel):
    emails: list[str]
    primary_email: str | None = None


class PrimaryEmailUpdate(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)


class UserSessionOut(BaseModel):
    id: uuid.UUID
    device_label: str
    ip_address: str | None
    created_at: datetime
    last_seen_at: datetime
    auth_method: str
    rotated_at: datetime
    expires_at: datetime
    absolute_expires_at: datetime
    revoked_at: datetime | None = None
    revoked_reason: str | None = None
    is_revoked: bool = False
    is_current: bool = False

    @classmethod
    def from_session(
        cls, session: UserSession, *, current_id: uuid.UUID | None
    ) -> "UserSessionOut":
        return cls(
            id=session.id,
            device_label=user_session_svc.device_label(session.user_agent),
            ip_address=session.ip_address,
            created_at=session.created_at,
            last_seen_at=session.last_seen_at,
            auth_method=session.auth_method,
            rotated_at=session.rotated_at,
            expires_at=session.expires_at,
            absolute_expires_at=session.absolute_expires_at,
            revoked_at=session.revoked_at,
            revoked_reason=session.revoked_reason,
            is_revoked=session.revoked_at is not None,
            is_current=session.id == current_id,
        )


class SecurityEventOut(BaseModel):
    id: uuid.UUID
    action: str
    summary: str | None
    created_at: datetime


@router.get("", response_model=list[UserSummary], summary="搜尋使用者（供下拉選單使用）")
async def list_users(
    db: DbDep,
    current_user: CurrentUser,
    search: str | None = Query(None, description="關鍵字（顯示名稱、信箱或學號）"),
    ids: list[uuid.UUID] | None = Query(None, description="依使用者 ID 批次取得（供回填已選名單）"),
    limit: int = Query(50, ge=1, le=50),
) -> list[User]:
    """回傳使用者列表，可依關鍵字過濾或依 ID 批次取得，用於審核人、受文者選取等場合"""
    codes = await get_user_permission_codes(db, current_user.id)
    allow_sensitive_search = "admin:all" in codes or current_user.is_superuser
    # 依 ID 批次取得：用於回填「已選使用者」名單
    if ids:
        result = await db.execute(
            select(User).where(User.id.in_(ids[:200]), User.is_active == True)  # noqa: E712
        )
        users = list(result.scalars().all())
        if not allow_sensitive_search:
            for u in users:
                u.email = ""
                u.student_id = None
        return users
    # 去除 NUL：PostgreSQL/UTF8 不接受 0x00，直接進 ILIKE 參數會丟
    # CharacterNotInRepertoireError → 未處理的 500。任何登入者可藉此低成本刷 5xx
    # 觸發模組斷路器造成 DoS，故在入口先清掉。
    cleaned = (search or "").replace("\x00", "").strip()
    if len(cleaned) < 2:
        return []
    escaped = cleaned.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    q = select(User).where(User.is_active == True)  # noqa: E712
    pattern = f"%{escaped}%"
    if allow_sensitive_search:
        q = q.where(
            or_(
                User.display_name.ilike(pattern, escape="\\"),
                User.email.ilike(pattern, escape="\\"),
                User.student_id.ilike(pattern, escape="\\"),
            )
        )
    else:
        q = q.where(User.display_name.ilike(pattern, escape="\\"))
    q = q.order_by(User.display_name).limit(limit)
    result = await db.execute(q)
    users = list(result.scalars().all())
    if allow_sensitive_search:
        return users
    for u in users:
        u.email = ""
        u.student_id = None
    return users


@router.get("/me", response_model=UserRead, summary="取得當前使用者資訊")
async def get_me(current_user: CurrentUser) -> User:
    """回傳已驗證的當前使用者完整資訊"""
    return current_user


@router.patch("/me", response_model=UserRead, summary="更新自己的個人資料")
async def update_me(
    body: UserSelfUpdate,
    db: DbDep,
    current_user: CurrentUser,
) -> User:
    """允許使用者更新自己的顯示名稱與學號"""
    if body.display_name is not None:
        current_user.display_name = body.display_name
    if body.student_id is not None:
        requested = body.student_id.strip() or None
        if requested != current_user.student_id:
            # 只允許設成本人已驗證校園信箱推導出的學號（或清空），杜絕冒領他人學號
            # 造成的身分綁定／權限提升（見 _verified_student_id_from_email）。
            if requested is not None and requested != _verified_student_id_from_email(
                current_user.email
            ):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="學號需與您的校園帳號一致，無法自行指定他人學號",
                )
            current_user.student_id = requested
    if body.show_email is not None:
        current_user.show_email = body.show_email
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        # SECURITY: 以 from None 截斷 exception chain，避免原始 constraint 名稱
        # 透過 debug middleware 或錯誤框架意外洩漏至 HTTP 回應。
        if "student_id" in str(exc.orig):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="此學號已被其他帳號使用，請確認學號是否正確",
            ) from None
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="資料衝突，請確認填入的資料是否唯一",
        ) from None
    await audit_svc.record(
        db,
        entity_type="user",
        entity_id=str(current_user.id),
        action="user.update_self",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "display_name_changed": body.display_name is not None,
            "student_id_changed": body.student_id is not None,
            "show_email_changed": body.show_email is not None,
        },
        summary=f"使用者 {current_user.email} 更新個人資料",
    )
    return current_user


@router.get("/me/emails", response_model=LinkedEmailsOut, summary="列出自己的登入 Email")
async def list_my_emails(db: DbDep, current_user: CurrentUser) -> LinkedEmailsOut:
    return LinkedEmailsOut(
        emails=await email_verification_svc.list_user_emails(db, current_user),
        primary_email=current_user.email,
    )


@router.post("/me/emails/primary", response_model=LinkedEmailsOut, summary="設定主要登入 Email")
async def set_primary_email(
    body: PrimaryEmailUpdate,
    db: DbDep,
    current_user: CurrentUser,
) -> LinkedEmailsOut:
    normalized = body.email.strip().lower()
    emails = await email_verification_svc.list_user_emails(db, current_user)
    if normalized not in emails:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="請先完成此 Email 的驗證與連結"
        )
    if normalized != current_user.email:
        previous_email = current_user.email
        current_user.email = normalized
        await audit_svc.record(
            db,
            entity_type="user",
            entity_id=str(current_user.id),
            action="user.email.primary_changed",
            actor_id=str(current_user.id),
            actor_email=normalized,
            meta={"previous_email": previous_email, "primary_email": normalized},
            summary="使用者更新主要登入 Email",
        )
        await db.commit()
    return LinkedEmailsOut(
        emails=await email_verification_svc.list_user_emails(db, current_user),
        primary_email=current_user.email,
    )


@router.delete("/me/emails", response_model=LinkedEmailsOut, summary="解除次要登入 Email")
async def unlink_email(
    db: DbDep,
    current_user: CurrentUser,
    email: str = Query(..., min_length=5, max_length=255),
) -> LinkedEmailsOut:
    normalized = email.strip().lower()
    if normalized == current_user.email:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="主要 Email 不可直接解除，請先設定其他主要 Email",
        )
    identity_rows = list(
        (
            await db.scalars(
                select(UserIdentity).where(
                    UserIdentity.user_id == current_user.id,
                    UserIdentity.email == normalized,
                )
            )
        ).all()
    )
    if not identity_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="此 Email 尚未連結")
    for identity in identity_rows:
        await db.delete(identity)
    await audit_svc.record(
        db,
        entity_type="user",
        entity_id=str(current_user.id),
        action="user.email.unlinked",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"email": normalized},
        summary="使用者解除次要登入 Email",
    )
    await db.commit()
    return LinkedEmailsOut(
        emails=await email_verification_svc.list_user_emails(db, current_user),
        primary_email=current_user.email,
    )


@router.get("/me/sessions", response_model=list[UserSessionOut], summary="列出我的登入工作階段")
async def list_my_sessions(
    request: Request, db: DbDep, current_user: CurrentUser
) -> list[UserSessionOut]:
    current = await user_session_svc.ensure_current(
        db,
        user_id=current_user.id,
        refresh_token=refresh_token_from_cookies(request.cookies),
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    await db.commit()
    sessions = await user_session_svc.list_recent(db, current_user.id)
    return [
        UserSessionOut.from_session(session, current_id=current.id if current else None)
        for session in sessions
    ]


@router.post("/me/sessions/revoke-others", response_model=dict[str, int], summary="登出其他裝置")
async def revoke_other_sessions(
    request: Request, db: DbDep, current_user: CurrentUser
) -> dict[str, int]:
    current = await user_session_svc.ensure_current(
        db,
        user_id=current_user.id,
        refresh_token=refresh_token_from_cookies(request.cookies),
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    count = await user_session_svc.revoke_others(
        db, current_user.id, current.id if current else None
    )
    await db.commit()
    return {"revoked_count": count}


@router.post("/me/sessions/revoke-all", response_model=dict[str, int], summary="登出全部裝置")
async def revoke_all_sessions(
    request: Request,
    response: Response,
    db: DbDep,
    current_user: CurrentUser,
) -> dict[str, int]:
    await user_session_svc.ensure_current(
        db,
        user_id=current_user.id,
        refresh_token=refresh_token_from_cookies(request.cookies),
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    count = await user_session_svc.revoke_all(db, current_user.id)
    await db.commit()
    delete_auth_cookies(response)
    return {"revoked_count": count}


@router.get(
    "/me/security-events", response_model=list[SecurityEventOut], summary="列出最近安全活動"
)
async def list_security_events(db: DbDep, current_user: CurrentUser) -> list[SecurityEventOut]:
    rows = await db.scalars(
        select(AuditLog)
        .where(AuditLog.actor_id == str(current_user.id), AuditLog.action.like("user.%"))
        .order_by(AuditLog.created_at.desc())
        .limit(20)
    )
    return [
        SecurityEventOut(
            id=row.id, action=row.action, summary=row.summary, created_at=row.created_at
        )
        for row in rows
    ]


@router.post(
    "/me/emails/verification",
    status_code=status.HTTP_202_ACCEPTED,
    summary="寄送 Email 連結驗證碼",
)
async def request_email_verification(
    body: EmailVerificationRequest,
    db: DbDep,
    current_user: CurrentUser,
) -> dict[str, str]:
    try:
        await email_verification_svc.request_verification(db, current_user, body.email)
    except UserRegistrationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return {"message": "驗證碼已寄出"}


@router.post(
    "/me/emails/verify",
    response_model=LinkedEmailsOut,
    summary="驗證並連結 Email",
)
async def verify_email(
    body: EmailVerificationConfirm,
    db: DbDep,
    current_user: CurrentUser,
) -> LinkedEmailsOut:
    try:
        await email_verification_svc.verify_and_link(
            db,
            user=current_user,
            email=body.email,
            code=body.code,
        )
    except UserRegistrationError as exc:
        if exc.payload and exc.payload.get("conflicts"):
            account_label = current_user.display_name
            await db.rollback()
            try:
                await user_registration_svc.notify_merge_conflict_admins(
                    db,
                    account_label=account_label,
                    conflicts=exc.payload["conflicts"],
                )
                await db.commit()
            except Exception:
                await db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return LinkedEmailsOut(
        emails=await email_verification_svc.list_user_emails(db, current_user),
        primary_email=current_user.email,
    )


# ── 自助隱私操作（個資法當事人權利） ────────────────────────────────────────


class SelfExportRequestOut(BaseModel):
    message: str
    filename: str
    size_bytes: int
    file_count: int
    download_url: str


class SelfAnonymizeRequestOut(BaseModel):
    message: str


@router.post(
    "/me/privacy/export",
    response_model=SelfExportRequestOut,
    status_code=status.HTTP_202_ACCEPTED,
    summary="自助匯出我的個資（ZIP）",
    description=(
        "依個資法第 10 條，產生包含你所有個人資料的 ZIP 封存檔，"
        "回傳下載連結。下載 URL 有效期 10 分鐘，請盡快下載。"
    ),
)
async def self_export_data(db: DbDep, current_user: CurrentUser) -> SelfExportRequestOut:
    from api.services import privacy as privacy_svc

    result = await privacy_svc.export_user_data(
        db,
        user_id=current_user.id,
        requested_by_email=current_user.email,
    )
    await db.commit()
    return SelfExportRequestOut(
        message="個資匯出已完成，請在 10 分鐘內下載。",
        filename=result.file_path,
        size_bytes=result.size_bytes,
        file_count=result.file_count,
        download_url=f"/users/me/privacy/export/download?filename={result.file_path}",
    )


@router.get(
    "/me/privacy/export/download",
    summary="下載自助匯出的個資檔案",
    response_model=None,
)
async def self_download_export(
    filename: str,
    current_user: CurrentUser,
) -> object:
    from fastapi.responses import Response

    from api.services import privacy as privacy_svc

    # 安全性：只允許下載自己的 export（以 user_id 前綴驗證）
    expected_prefix = f"export_{current_user.id}_"
    if not filename.startswith(expected_prefix) or ".." in filename or "/" in filename:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權下載此檔案")
    try:
        data = privacy_svc.read_export_bytes(filename)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="檔案不存在或已過期"
        ) from exc
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post(
    "/me/privacy/request-deletion",
    response_model=SelfAnonymizeRequestOut,
    status_code=status.HTTP_202_ACCEPTED,
    summary="申請刪除我的帳號（假名化）",
    description=(
        "依個資法第 11 條，將你的帳號假名化：顯示名稱、Email 替換為不可逆雜湊值，"
        "帳號停用。公文／法規等公共利益資料中的簽核紀錄依法保留不刪除。"
        "此操作不可逆，請確認後再送出。"
    ),
)
async def self_request_deletion(db: DbDep, current_user: CurrentUser) -> SelfAnonymizeRequestOut:
    from api.services import privacy as privacy_svc

    await privacy_svc.anonymize_user(
        db,
        user_id=current_user.id,
        requested_by_email=current_user.email,
    )
    await db.commit()
    return SelfAnonymizeRequestOut(
        message=(
            "帳號已假名化並停用。公共利益相關的稽核紀錄依個資法規定保留，"
            "其他個人資料已不可逆去識別化。"
        )
    )
