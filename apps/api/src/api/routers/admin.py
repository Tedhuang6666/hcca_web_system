"""
管理員路由 - /admin
===================
提供使用者、身份組（職位）、權限管理功能。

所有端點均需 admin:all 或 is_superuser 才可存取。
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.config import settings
from api.core.database import get_db
from api.core.permission_codes import (
    ALL_PERMISSION_CODES,
    PermissionCode,
    validate_permission_codes,
)
from api.dependencies.permissions import require_permission
from api.models.org import Org, Permission, Position, PositionCategory, UserPosition
from api.models.person import PersonAffiliationKind, PersonAffiliationSource
from api.models.user import User
from api.models.user_identity import UserIdentity
from api.services import audit as audit_svc
from api.services import person as person_svc
from api.services import user_registration as user_registration_svc
from api.services.discord_bot import enqueue_role_sync
from api.services.permission import get_user_permission_codes
from api.services.user_registration import UserRegistrationError

router = APIRouter(prefix="/admin", tags=["管理員"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
AdminUser = Annotated[User, Depends(require_permission(PermissionCode.ADMIN_ALL))]

# ── Schemas ──────────────────────────────────────────────────────────────────


class PositionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    org_id: uuid.UUID
    org_name: str = ""
    org_is_active: bool = True
    description: str | None = None
    category: PositionCategory = PositionCategory.COUNCIL
    weight: int = 0
    parent_id: uuid.UUID | None = None
    permission_codes: list[str] = []
    # UserPosition.id（用於移除此使用者的此職位任期；僅在 UserDetail 中有值）
    user_position_id: uuid.UUID | None = None


class UserDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    email: str
    linked_emails: list[str] = Field(default_factory=list)
    display_name: str
    student_id: str | None
    avatar_url: str | None
    is_active: bool
    allow_external_login: bool
    is_superuser: bool
    # Owner 為環境變數 OWNER_EMAILS 驅動的最高權限角色，由路由層注入
    is_owner: bool = False
    created_at: str
    positions: list[PositionSummary] = []
    effective_permissions: list[str] = []


class UserPreRegister(BaseModel):
    """透過學號預先建立帳號（email = g0{student_id}@hchs.hc.edu.tw）"""

    student_id: str | None = Field(None, min_length=1, max_length=20, description="學號")
    email: str | None = Field(None, min_length=5, max_length=255, description="自訂登入信箱")
    linked_emails: list[str] = Field(
        default_factory=list,
        max_length=10,
        description="可登入同一帳戶的其他 Email",
    )
    allow_external_login: bool = Field(
        False,
        description="允許校外信箱繞過 LOGIN_ALLOWED_EMAIL_DOMAINS 登入",
    )
    display_name: str = Field(..., min_length=1, max_length=100, description="姓名")
    position_ids: list[uuid.UUID] = Field(
        default_factory=list, description="同時指派的職位 ID 清單"
    )
    custom_permission_org_id: uuid.UUID | None = Field(None, description="自訂權限所屬組織")
    custom_permission_codes: list[str] = Field(default_factory=list, description="自訂權限碼清單")
    start_date: date = Field(default_factory=date.today, description="任期開始日")
    end_date: date | None = Field(None, description="任期結束日（None = 無期限）")


class UserBatchPreRegister(BaseModel):
    users: list[UserPreRegister] = Field(..., min_length=1, max_length=200)


class UserBatchPreRegisterItem(BaseModel):
    index: int
    success: bool
    display_name: str
    email: str | None = None
    student_id: str | None = None
    user_id: uuid.UUID | None = None
    error: str | None = None


class UserBatchPreRegisterResult(BaseModel):
    total: int
    created: int
    failed: int
    results: list[UserBatchPreRegisterItem]


class LinkUserEmailsRequest(BaseModel):
    emails: list[str] = Field(..., min_length=1, max_length=10)


class AssignPositionsRequest(BaseModel):
    """指派/替換使用者的所有職位"""

    assignments: list[dict] = Field(
        ...,
        description="[{position_id, start_date, end_date?}, ...]",
        examples=[[{"position_id": "uuid", "start_date": "2026-01-01"}]],
    )


class AddSinglePosition(BaseModel):
    position_id: uuid.UUID
    start_date: date = Field(default_factory=date.today)
    end_date: date | None = None


class UpdateUserPositionRequest(BaseModel):
    start_date: date | None = None
    end_date: date | None = None


class UpdateUserRequest(BaseModel):
    display_name: str | None = Field(None, max_length=100)
    is_active: bool | None = None
    allow_external_login: bool | None = None
    is_superuser: bool | None = None


class PositionCreate(BaseModel):
    org_id: uuid.UUID
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = Field(None, max_length=500)
    category: PositionCategory = Field(
        PositionCategory.COUNCIL,
        description="職位分類：council=班聯會/自治組織，class=班級幹部，system=系統/外部協作",
    )
    weight: int = Field(0, ge=0)
    parent_id: uuid.UUID | None = None
    permission_codes: list[str] = Field(default_factory=list, description="同時設定的權限碼")


class PositionUpdate(BaseModel):
    name: str | None = Field(None, max_length=100)
    description: str | None = None
    category: PositionCategory | None = None
    weight: int | None = Field(None, ge=0)
    parent_id: uuid.UUID | None = None


class PermissionCatalogItem(BaseModel):
    group: str
    code: str
    label: str
    desc: str


# ── 輔助 ─────────────────────────────────────────────────────────────────────


async def _enrich_user(db: AsyncSession, user: User) -> UserDetail:
    """組裝 UserDetail（含職位 + 有效權限碼）"""
    result = await db.execute(
        select(UserPosition)
        .options(
            selectinload(UserPosition.position).selectinload(Position.permissions),
            selectinload(UserPosition.position).selectinload(Position.org),
        )
        .where(UserPosition.user_id == user.id)
        .order_by(UserPosition.start_date)
    )
    user_positions = result.scalars().all()

    positions = []
    for up in user_positions:
        pos = up.position
        positions.append(
            PositionSummary(
                id=pos.id,
                name=pos.name,
                org_id=pos.org_id,
                org_name=pos.org.name if pos.org else "",
                org_is_active=pos.org.is_active if pos.org else True,
                description=pos.description,
                category=pos.category,
                weight=pos.weight,
                parent_id=pos.parent_id,
                permission_codes=[p.code for p in pos.permissions],
                user_position_id=up.id,  # 用於前端刪除此職位任期
            )
        )

    effective = await get_user_permission_codes(db, user.id)
    identity_emails = (
        await db.scalars(
            select(UserIdentity.email)
            .where(UserIdentity.user_id == user.id, UserIdentity.email.is_not(None))
            .distinct()
        )
    ).all()
    return UserDetail(
        id=user.id,
        email=user.email,
        linked_emails=sorted({user.email, *(email for email in identity_emails if email)}),
        display_name=user.display_name,
        student_id=user.student_id,
        avatar_url=user.avatar_url,
        is_active=user.is_active,
        allow_external_login=user.allow_external_login,
        is_superuser=user.is_superuser,
        is_owner=user.email.lower() in settings.OWNER_EMAILS,
        created_at=user.created_at.isoformat(),
        positions=positions,
        effective_permissions=sorted(effective),
    )


# ── 使用者管理 ────────────────────────────────────────────────────────────────


@router.get(
    "/users",
    response_model=list[UserDetail],
    summary="列出所有使用者（含職位與有效權限）",
)
async def list_users(
    db: DbDep,
    _: AdminUser,
    keyword: str | None = Query(None, description="搜尋姓名/Email/學號"),
    active_only: bool = Query(False, description="僅顯示啟用中帳號"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[UserDetail]:
    q = select(User).order_by(User.created_at.desc()).limit(limit).offset(offset)
    if active_only:
        q = q.where(User.is_active == True)  # noqa: E712
    if keyword:
        from api.core.search import like_contains

        pattern = like_contains(keyword)
        from sqlalchemy import or_

        q = q.where(
            or_(
                User.display_name.ilike(pattern),
                User.email.ilike(pattern),
                User.student_id.ilike(pattern),
            )
        )
    result = await db.execute(q)
    users = result.scalars().all()
    return [await _enrich_user(db, u) for u in users]


@router.post(
    "/users/pre-register",
    response_model=UserDetail,
    status_code=status.HTTP_201_CREATED,
    summary="透過學號預先建立帳號（登入後自動匹配）",
)
async def pre_register_user(
    body: UserPreRegister,
    db: DbDep,
    admin_user: AdminUser,
) -> UserDetail:
    """
    管理員透過學號預先建立帳號並指派職位。
    Email 格式：g0{student_id}@hchs.hc.edu.tw。
    學生首次以 Google 帳號登入時，系統依 email 自動匹配並連結帳號。
    """
    try:
        user = await user_registration_svc.pre_register_user(
            db,
            **body.model_dump(),
            actor=admin_user,
        )
    except UserRegistrationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return await _enrich_user(db, user)


@router.post(
    "/users/pre-register/batch",
    response_model=UserBatchPreRegisterResult,
    status_code=status.HTTP_201_CREATED,
    summary="批次預先建立帳號",
)
async def batch_pre_register_users(
    body: UserBatchPreRegister,
    db: DbDep,
    admin_user: AdminUser,
) -> UserBatchPreRegisterResult:
    results: list[UserBatchPreRegisterItem] = []
    for index, item in enumerate(body.users):
        try:
            async with db.begin_nested():
                user = await user_registration_svc.pre_register_user(
                    db,
                    **item.model_dump(),
                    actor=admin_user,
                )
            results.append(
                UserBatchPreRegisterItem(
                    index=index,
                    success=True,
                    display_name=user.display_name,
                    email=user.email,
                    student_id=user.student_id,
                    user_id=user.id,
                )
            )
        except UserRegistrationError as exc:
            results.append(
                UserBatchPreRegisterItem(
                    index=index,
                    success=False,
                    display_name=item.display_name,
                    email=item.email,
                    student_id=item.student_id,
                    error=exc.detail,
                )
            )

    created = sum(result.success for result in results)
    return UserBatchPreRegisterResult(
        total=len(results),
        created=created,
        failed=len(results) - created,
        results=results,
    )


@router.get(
    "/users/{user_id}",
    response_model=UserDetail,
    summary="取得使用者詳細資料",
)
async def get_user(user_id: uuid.UUID, db: DbDep, _: AdminUser) -> UserDetail:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="使用者不存在")
    return await _enrich_user(db, user)


@router.post(
    "/users/{user_id}/emails",
    response_model=UserDetail,
    summary="連結其他登入 Email 到既有帳號",
)
async def link_user_emails(
    user_id: uuid.UUID,
    body: LinkUserEmailsRequest,
    db: DbDep,
    admin_user: AdminUser,
) -> UserDetail:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="使用者不存在")
    try:
        await user_registration_svc.link_user_emails(
            db,
            user=user,
            emails=body.emails,
            actor=admin_user,
        )
    except UserRegistrationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return await _enrich_user(db, user)


@router.patch(
    "/users/{user_id}",
    response_model=UserDetail,
    summary="更新使用者資料（啟用/停用、改名、設定超管）",
)
async def update_user(
    user_id: uuid.UUID,
    body: UpdateUserRequest,
    db: DbDep,
    admin_user: AdminUser,
) -> UserDetail:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="使用者不存在")
    before = {
        "display_name": user.display_name,
        "is_active": user.is_active,
        "allow_external_login": user.allow_external_login,
        "is_superuser": user.is_superuser,
    }
    is_owner = user.email.lower() in settings.OWNER_EMAILS
    # 職責分離：is_superuser 是比 admin:all 更高的層級（繞過全部 RBAC 與 owner 以外的保護），
    # 故唯有操作者本身為 superuser 時，才允許變更他人的 is_superuser，或修改既有 superuser 帳號。
    # 否則持 admin:all 的非 superuser 可對自己送 is_superuser=true 自我提權，
    # 或停用／降權合法 superuser 造成接管。
    if not admin_user.is_superuser:
        if body.is_superuser is not None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="僅超級管理員可變更超級管理員身分",
            )
        if user.is_superuser:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="僅超級管理員可修改其他超級管理員帳號",
            )
    if is_owner and body.is_active is False:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Owner 帳號不可停用",
        )
    if is_owner and body.is_superuser is False:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Owner 帳號不可移除超級管理員身分",
        )
    if body.display_name is not None:
        user.display_name = body.display_name
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.allow_external_login is not None:
        user.allow_external_login = body.allow_external_login
    if body.is_superuser is not None:
        user.is_superuser = body.is_superuser
    await db.flush()
    after = {
        "display_name": user.display_name,
        "is_active": user.is_active,
        "allow_external_login": user.allow_external_login,
        "is_superuser": user.is_superuser,
    }
    await audit_svc.record(
        db,
        entity_type="user",
        entity_id=str(user.id),
        action="user.update",
        actor_id=str(admin_user.id),
        actor_email=admin_user.email,
        meta={"before": before, "after": after},
        summary=f"更新使用者「{user.display_name}」資料",
    )
    return await _enrich_user(db, user)


@router.post(
    "/users/{user_id}/positions",
    response_model=UserDetail,
    status_code=status.HTTP_201_CREATED,
    summary="新增一個職位給使用者",
)
async def add_user_position(
    user_id: uuid.UUID,
    body: AddSinglePosition,
    db: DbDep,
    admin_user: AdminUser,
) -> UserDetail:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="使用者不存在")

    pos_check = await db.execute(
        select(Position).options(selectinload(Position.org)).where(Position.id == body.position_id)
    )
    position = pos_check.scalar_one_or_none()
    if not position:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="職位不存在")
    if position.org and not position.org.is_active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="此職位所屬組織已停用，無法新增任期",
        )

    user_position = UserPosition(
        user_id=user_id,
        position_id=body.position_id,
        start_date=body.start_date,
        end_date=body.end_date,
    )
    db.add(user_position)
    await db.flush()
    await person_svc.record_affiliation_for_user_position(
        db,
        user=user,
        kind=PersonAffiliationKind.ORG_POSITION,
        position_id=body.position_id,
        start_date=user_position.start_date,
        end_date=user_position.end_date,
        synced_user_position_id=user_position.id,
        source=PersonAffiliationSource.RBAC_SYNC,
    )
    await audit_svc.record(
        db,
        entity_type="user_position",
        entity_id=str(user_position.id),
        action="position.assign",
        actor_id=str(admin_user.id),
        actor_email=admin_user.email,
        meta={
            "user_id": str(user_id),
            "org_id": str(position.org_id),
            "position_id": str(position.id),
            "position_name": position.name,
            "start_date": body.start_date.isoformat(),
            "end_date": body.end_date.isoformat() if body.end_date else None,
        },
        summary=f"指派「{position.name}」給「{user.display_name}」",
    )
    await enqueue_role_sync(db, user_id)
    return await _enrich_user(db, user)


@router.delete(
    "/users/{user_id}/positions/{up_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="移除使用者的某個職位任期",
)
async def remove_user_position(
    user_id: uuid.UUID,
    up_id: uuid.UUID,
    db: DbDep,
    admin_user: AdminUser,
) -> None:
    result = await db.execute(
        select(UserPosition)
        .options(selectinload(UserPosition.position))
        .where(
            UserPosition.id == up_id,
            UserPosition.user_id == user_id,
        )
    )
    up = result.scalar_one_or_none()
    if not up:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此職位任期記錄")
    await audit_svc.record(
        db,
        entity_type="user_position",
        entity_id=str(up.id),
        action="position.unassign",
        actor_id=str(admin_user.id),
        actor_email=admin_user.email,
        meta={
            "user_id": str(up.user_id),
            "org_id": str(up.position.org_id) if up.position else None,
            "position_id": str(up.position_id),
            "position_name": up.position.name if up.position else None,
            "start_date": up.start_date.isoformat(),
            "end_date": up.end_date.isoformat() if up.end_date else None,
        },
        summary="移除使用者職位任期",
    )
    await db.delete(up)
    await db.flush()
    await enqueue_role_sync(db, user_id)


@router.patch(
    "/users/{user_id}/positions/{up_id}",
    response_model=UserDetail,
    summary="更新使用者的某個職位任期日期",
)
async def update_user_position(
    user_id: uuid.UUID,
    up_id: uuid.UUID,
    body: UpdateUserPositionRequest,
    db: DbDep,
    admin_user: AdminUser,
) -> UserDetail:
    result = await db.execute(
        select(UserPosition)
        .options(selectinload(UserPosition.position), selectinload(UserPosition.user))
        .where(
            UserPosition.id == up_id,
            UserPosition.user_id == user_id,
        )
    )
    up = result.scalar_one_or_none()
    if not up:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此職位任期記錄")
    if "start_date" not in body.model_fields_set and "end_date" not in body.model_fields_set:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="至少需提供 start_date 或 end_date",
        )
    start_date = body.start_date or up.start_date
    end_date = body.end_date if "end_date" in body.model_fields_set else up.end_date
    if end_date is not None and end_date < start_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="任期結束日不可早於開始日",
        )

    before = {
        "start_date": up.start_date.isoformat(),
        "end_date": up.end_date.isoformat() if up.end_date else None,
    }
    up.start_date = start_date
    up.end_date = end_date
    await db.flush()
    await audit_svc.record(
        db,
        entity_type="user_position",
        entity_id=str(up.id),
        action="position.assignment_update",
        actor_id=str(admin_user.id),
        actor_email=admin_user.email,
        meta={
            "user_id": str(up.user_id),
            "position_id": str(up.position_id),
            "position_name": up.position.name if up.position else None,
            "before": before,
            "after": {
                "start_date": up.start_date.isoformat(),
                "end_date": up.end_date.isoformat() if up.end_date else None,
            },
        },
        summary="更新使用者職位任期",
    )
    await enqueue_role_sync(db, up.user_id)
    if up.user is None:
        user_result = await db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one()
    else:
        user = up.user
    return await _enrich_user(db, user)


# ── 職位（身份組）管理 ────────────────────────────────────────────────────────


@router.get(
    "/positions",
    summary="列出所有職位（含所屬組織與權限碼）",
)
async def list_all_positions(
    db: DbDep,
    _: AdminUser,
) -> list[PositionSummary]:
    result = await db.execute(
        select(Position)
        .options(
            selectinload(Position.permissions),
            selectinload(Position.org),
        )
        .order_by(Position.name)
    )
    positions = result.scalars().all()
    return [
        PositionSummary(
            id=p.id,
            name=p.name,
            org_id=p.org_id,
            org_name=p.org.name if p.org else "",
            org_is_active=p.org.is_active if p.org else True,
            description=p.description,
            category=p.category,
            weight=p.weight,
            parent_id=p.parent_id,
            permission_codes=[perm.code for perm in p.permissions],
        )
        for p in positions
    ]


@router.post(
    "/positions",
    status_code=status.HTTP_201_CREATED,
    summary="建立新職位（身份組）並設定權限碼",
)
async def create_position_with_perms(
    body: PositionCreate,
    db: DbDep,
    admin_user: AdminUser,
) -> PositionSummary:
    invalid_codes = validate_permission_codes(body.permission_codes)
    if invalid_codes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"存在未知權限碼：{', '.join(invalid_codes)}",
        )
    # 確認 org 存在
    org_check = await db.execute(select(Org).where(Org.id == body.org_id))
    org = org_check.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="組織不存在")
    if not org.is_active:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="組織已停用，無法建立職位")
    if body.parent_id is not None:
        parent_result = await db.execute(select(Position).where(Position.id == body.parent_id))
        parent = parent_result.scalar_one_or_none()
        if parent is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="上級職位不存在")
        if parent.org_id != body.org_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="上級職位必須位於同一組織"
            )

    position = Position(
        org_id=body.org_id,
        name=body.name,
        description=body.description,
        category=body.category,
        weight=body.weight,
        parent_id=body.parent_id,
    )
    db.add(position)
    await db.flush()

    for code in body.permission_codes:
        db.add(Permission(position_id=position.id, code=code))
    await db.flush()
    await audit_svc.record(
        db,
        entity_type="position",
        entity_id=str(position.id),
        action="position.create",
        actor_id=str(admin_user.id),
        actor_email=admin_user.email,
        meta={
            "org_id": str(position.org_id),
            "org_name": org.name,
            "permission_codes": sorted(set(body.permission_codes)),
            "category": body.category,
        },
        summary=f"建立職位「{position.name}」並設定權限",
    )

    return PositionSummary(
        id=position.id,
        name=position.name,
        org_id=position.org_id,
        org_name=org.name,
        org_is_active=org.is_active,
        description=position.description,
        category=position.category,
        weight=position.weight,
        parent_id=position.parent_id,
        permission_codes=list(body.permission_codes),
    )


@router.patch(
    "/positions/{position_id}",
    summary="更新職位基本資料（名稱 / 備註 / 上級職位）",
)
async def update_position(
    position_id: uuid.UUID,
    body: PositionUpdate,
    db: DbDep,
    admin_user: AdminUser,
) -> PositionSummary:
    pos_result = await db.execute(
        select(Position)
        .options(selectinload(Position.permissions), selectinload(Position.org))
        .where(Position.id == position_id)
    )
    position = pos_result.scalar_one_or_none()
    if not position:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="職位不存在")

    if body.parent_id == position.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="職位不可將自己設為上級")
    if body.parent_id is not None:
        parent_result = await db.execute(select(Position).where(Position.id == body.parent_id))
        parent = parent_result.scalar_one_or_none()
        if parent is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="上級職位不存在")
        if parent.org_id != position.org_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="上級職位必須位於同一組織"
            )

    before = {
        "name": position.name,
        "description": position.description,
        "category": position.category,
        "weight": position.weight,
        "parent_id": str(position.parent_id) if position.parent_id else None,
    }
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(position, field, value)
    await db.flush()
    await audit_svc.record(
        db,
        entity_type="position",
        entity_id=str(position.id),
        action="position.update",
        actor_id=str(admin_user.id),
        actor_email=admin_user.email,
        meta={
            "org_id": str(position.org_id),
            "before": before,
            "after": {
                "name": position.name,
                "description": position.description,
                "category": position.category,
                "weight": position.weight,
                "parent_id": str(position.parent_id) if position.parent_id else None,
            },
        },
        summary=f"更新職位「{position.name}」",
    )

    return PositionSummary(
        id=position.id,
        name=position.name,
        org_id=position.org_id,
        org_name=position.org.name if position.org else "",
        org_is_active=position.org.is_active if position.org else True,
        description=position.description,
        category=position.category,
        weight=position.weight,
        parent_id=position.parent_id,
        permission_codes=[perm.code for perm in position.permissions],
    )


@router.put(
    "/positions/{position_id}/permissions",
    summary="整批更新職位的權限碼（先清空，再設定）",
)
async def replace_position_permissions(
    position_id: uuid.UUID,
    permission_codes: list[str],
    db: DbDep,
    admin_user: AdminUser,
) -> PositionSummary:
    invalid_codes = validate_permission_codes(permission_codes)
    if invalid_codes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"存在未知權限碼：{', '.join(invalid_codes)}",
        )
    pos_result = await db.execute(
        select(Position)
        .options(selectinload(Position.permissions), selectinload(Position.org))
        .where(Position.id == position_id)
    )
    position = pos_result.scalar_one_or_none()
    if not position:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="職位不存在")
    before_codes = sorted(perm.code for perm in position.permissions)
    after_codes = sorted(set(permission_codes))

    # 清除舊有
    for p in position.permissions:
        await db.delete(p)
    await db.flush()

    # 建立新的
    for code in after_codes:
        db.add(Permission(position_id=position_id, code=code))
    await db.flush()
    await audit_svc.record(
        db,
        entity_type="position",
        entity_id=str(position.id),
        action="permission.replace",
        actor_id=str(admin_user.id),
        actor_email=admin_user.email,
        meta={
            "org_id": str(position.org_id),
            "before": before_codes,
            "after": after_codes,
            "added": sorted(set(after_codes) - set(before_codes)),
            "removed": sorted(set(before_codes) - set(after_codes)),
        },
        summary=f"整批更新職位「{position.name}」權限",
    )

    return PositionSummary(
        id=position.id,
        name=position.name,
        org_id=position.org_id,
        org_name=position.org.name if position.org else "",
        org_is_active=position.org.is_active if position.org else True,
        description=position.description,
        category=position.category,
        weight=position.weight,
        parent_id=position.parent_id,
        permission_codes=after_codes,
    )


@router.delete(
    "/positions/{position_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除職位（會同時移除所有持有者的該職位任期）",
)
async def delete_position(
    position_id: uuid.UUID,
    db: DbDep,
    admin_user: AdminUser,
) -> None:
    result = await db.execute(
        select(Position)
        .options(selectinload(Position.permissions), selectinload(Position.org))
        .where(Position.id == position_id)
    )
    position = result.scalar_one_or_none()
    if not position:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="職位不存在")
    await audit_svc.record(
        db,
        entity_type="position",
        entity_id=str(position.id),
        action="position.delete",
        actor_id=str(admin_user.id),
        actor_email=admin_user.email,
        meta={
            "name": position.name,
            "org_id": str(position.org_id),
            "org_name": position.org.name if position.org else None,
            "permission_codes": sorted(perm.code for perm in position.permissions),
        },
        summary=f"刪除職位「{position.name}」",
    )
    await db.delete(position)


# ── 系統資訊 ──────────────────────────────────────────────────────────────────


@router.get(
    "/permission-codes",
    summary="列出系統所有定義的權限碼（用於 UI 下拉選單）",
)
async def list_permission_codes(_: AdminUser) -> list[dict]:
    return ALL_PERMISSION_CODES


@router.get(
    "/permission-codes/query",
    response_model=list[PermissionCatalogItem],
    summary="查詢權限碼（支援群組/關鍵字/排序）",
)
async def query_permission_codes(
    _: AdminUser,
    group: str | None = Query(None, description="群組精確篩選"),
    keyword: str | None = Query(None, description="模糊搜尋 code/label/desc"),
    sort_by: Literal["group", "code", "label"] = Query("group"),
    order: Literal["asc", "desc"] = Query("asc"),
) -> list[PermissionCatalogItem]:
    items = ALL_PERMISSION_CODES
    if group:
        items = [item for item in items if item["group"] == group]
    if keyword:
        needle = keyword.strip().lower()
        items = [
            item
            for item in items
            if (
                needle in item["group"].lower()
                or needle in item["code"].lower()
                or needle in item["label"].lower()
                or needle in item["desc"].lower()
            )
        ]
    reverse = order == "desc"
    return sorted(items, key=lambda item: item[sort_by], reverse=reverse)


@router.get(
    "/orgs-with-positions",
    summary="列出所有組織及其職位（用於 UI 樹狀選單）",
)
async def list_orgs_with_positions(db: DbDep, _: AdminUser) -> list[dict]:
    result = await db.execute(
        select(Org)
        .where(Org.is_active.is_(True))
        .options(selectinload(Org.positions).selectinload(Position.permissions))
        .order_by(Org.name)
    )
    orgs = result.scalars().all()
    return [
        {
            "id": str(o.id),
            "name": o.name,
            "positions": [
                {
                    "id": str(p.id),
                    "name": p.name,
                    "description": p.description,
                    "category": p.category,
                    "weight": p.weight,
                    "parent_id": str(p.parent_id) if p.parent_id else None,
                    "permission_codes": [perm.code for perm in p.permissions],
                }
                for p in o.positions
            ],
        }
        for o in orgs
    ]
