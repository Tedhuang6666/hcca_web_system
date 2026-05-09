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
from api.services.permission import get_user_permission_codes

router = APIRouter(prefix="/users", tags=["使用者"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


class UserSelfUpdate(BaseModel):
    display_name: str | None = Field(None, min_length=1, max_length=100)
    student_id: str | None = Field(None, max_length=20)
    phone: str | None = Field(None, max_length=30)
    show_phone: bool | None = None
    show_email: bool | None = None


class UserSummary(BaseModel):
    id: uuid.UUID
    display_name: str
    email: str = ""

    model_config = {"from_attributes": True}


@router.get("", response_model=list[UserSummary], summary="搜尋使用者（供下拉選單使用）")
async def list_users(
    db: DbDep,
    current_user: CurrentUser,
    search: str | None = Query(None, description="關鍵字（顯示名稱、信箱或學號）"),
    limit: int = Query(50, ge=1, le=50),
) -> list[User]:
    """回傳使用者列表，可依關鍵字過濾（支援姓名/信箱/學號），用於審核人、受文者選取等場合"""
    if not search or len(search.strip()) < 2:
        return []
    codes = await get_user_permission_codes(db, current_user.id)
    allow_sensitive_search = "admin:all" in codes or current_user.is_superuser
    q = select(User).where(User.is_active == True)  # noqa: E712
    pattern = f"%{search.strip()}%"
    if allow_sensitive_search:
        q = q.where(
            or_(
                User.display_name.ilike(pattern),
                User.email.ilike(pattern),
                User.student_id.ilike(pattern),
            )
        )
    else:
        q = q.where(User.display_name.ilike(pattern))
    q = q.order_by(User.display_name).limit(limit)
    result = await db.execute(q)
    users = list(result.scalars().all())
    if allow_sensitive_search:
        return users
    for u in users:
        u.email = ""
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
        current_user.student_id = body.student_id or None
    if body.phone is not None:
        current_user.phone = body.phone or None
    if body.show_phone is not None:
        current_user.show_phone = body.show_phone
    if body.show_email is not None:
        current_user.show_email = body.show_email
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        detail = str(exc.orig)
        if "student_id" in detail:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="此學號已被其他帳號使用，請確認學號是否正確",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="資料衝突，請確認填入的資料是否唯一",
        ) from exc
    return current_user
