"""商品系統教師資料與處室選項管理。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import Response

from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.models.shop_teacher import ShopOffice
from api.models.user import User
from api.schemas.shop_teacher import (
    ShopOfficeCreate,
    ShopOfficeOut,
    ShopOfficeUpdate,
    ShopTeacherProfileOut,
    ShopTeacherProfileUpdate,
)
from api.services.shop import _teacher as teacher_svc

router = APIRouter(prefix="/shop", tags=["商品訂購"])
DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
ManagerUser = Annotated[User, Depends(require_permission("shop:manage"))]


@router.get("/teacher-profile", response_model=ShopTeacherProfileOut | None)
async def read_teacher_profile(
    session: DbDep, current_user: CurrentUser, response: Response
) -> ShopTeacherProfileOut | None:
    response.headers["Cache-Control"] = "private, no-store"
    return await teacher_svc.get_profile(session, current_user)


@router.put("/teacher-profile", response_model=ShopTeacherProfileOut)
async def save_teacher_profile(
    data: ShopTeacherProfileUpdate, session: DbDep, current_user: CurrentUser, response: Response
) -> ShopTeacherProfileOut:
    response.headers["Cache-Control"] = "private, no-store"
    try:
        return await teacher_svc.save_profile(session, current_user, data)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/offices", response_model=list[ShopOfficeOut])
async def read_shop_offices(session: DbDep, current_user: ManagerUser) -> list[ShopOffice]:
    return await teacher_svc.list_offices(session, include_inactive=True)


@router.post("/offices", response_model=ShopOfficeOut, status_code=201)
async def create_shop_office(
    data: ShopOfficeCreate, session: DbDep, current_user: ManagerUser
) -> ShopOffice:
    try:
        async with session.begin_nested():
            return await teacher_svc.create_office(session, data)
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="已有相同名稱的處室") from exc


@router.patch("/offices/{office_id}", response_model=ShopOfficeOut)
async def update_shop_office(
    office_id: uuid.UUID, data: ShopOfficeUpdate, session: DbDep, current_user: ManagerUser
) -> ShopOffice:
    office = await session.scalar(
        select(ShopOffice).where(ShopOffice.id == office_id).with_for_update()
    )
    if office is None:
        raise HTTPException(status_code=404, detail="找不到此處室")
    try:
        async with session.begin_nested():
            return await teacher_svc.update_office(session, office, data)
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="已有相同名稱的處室") from exc
