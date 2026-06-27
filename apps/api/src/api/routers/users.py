"""使用者路由 - /users"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.models.user import User
from api.schemas.auth import UserRead
from api.services import user_email_verification as email_verification_svc
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
    return current_user


@router.get("/me/emails", response_model=LinkedEmailsOut, summary="列出自己的登入 Email")
async def list_my_emails(db: DbDep, current_user: CurrentUser) -> LinkedEmailsOut:
    return LinkedEmailsOut(emails=await email_verification_svc.list_user_emails(db, current_user))


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
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return LinkedEmailsOut(emails=await email_verification_svc.list_user_emails(db, current_user))
