"""班級系統 Router - 班級 / 學號區間 / 幹部"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.models.school_class import SchoolClass
from api.models.user import User
from api.schemas.school_class import (
    ClassCadreCreate,
    ClassCadreOut,
    ClassManualMemberCreate,
    ClassManualMemberOut,
    ClassMemberOut,
    ClassMembershipCreate,
    ClassMembershipOut,
    ClassRoleAssign,
    ClassRoleOut,
    ClassStudentRangeCreate,
    ClassStudentRangeOut,
    SchoolClassBulkAction,
    SchoolClassBulkActionOut,
    SchoolClassBulkCreate,
    SchoolClassBulkCreateOut,
    SchoolClassCreate,
    SchoolClassListItem,
    SchoolClassOut,
    SchoolClassUpdate,
)
from api.services import school_class as class_svc

router = APIRouter(prefix="/classes", tags=["班級系統"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
ManagerUser = Annotated[User, Depends(require_permission(PermissionCode.CLASS_MANAGE))]


async def _get_class_or_404(class_id: uuid.UUID, session: AsyncSession) -> SchoolClass:
    sc = await class_svc.get_class(session, class_id)
    if sc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此班級")
    return sc


# ── 班級 ──────────────────────────────────────────────────────────────────────


@router.get("", response_model=list[SchoolClassListItem], summary="列出班級")
async def list_classes(
    session: DbDep,
    _: ManagerUser,
    academic_year: int | None = Query(None, description="篩選學年度"),
    is_active: bool | None = Query(None, description="篩選是否為當前學年度班級"),
) -> list[SchoolClass]:
    return await class_svc.list_classes(session, academic_year=academic_year, is_active=is_active)


@router.post(
    "",
    response_model=SchoolClassOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立班級（可附學號區間）",
)
async def create_class(
    payload: SchoolClassCreate, session: DbDep, current_user: ManagerUser
) -> SchoolClass:
    try:
        return await class_svc.create_class(session, data=payload, created_by=current_user.id)
    except IntegrityError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="同一學年度已存在相同班級代碼",
        ) from e


@router.post(
    "/bulk",
    response_model=SchoolClassBulkCreateOut,
    status_code=status.HTTP_201_CREATED,
    summary="批量建立班級與快捷學號區間",
)
async def bulk_create_classes(
    payload: SchoolClassBulkCreate, session: DbDep, current_user: ManagerUser
) -> SchoolClassBulkCreateOut:
    try:
        return await class_svc.bulk_create_classes(
            session, data=payload, created_by=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e


@router.post(
    "/bulk/action",
    response_model=SchoolClassBulkActionOut,
    summary="批量啟用、停用或刪除班級",
)
async def bulk_action_classes(
    payload: SchoolClassBulkAction, session: DbDep, _: ManagerUser
) -> SchoolClassBulkActionOut:
    try:
        return await class_svc.bulk_action_classes(
            session, class_ids=payload.class_ids, action=payload.action
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    except IntegrityError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="部分班級仍被其他資料引用，無法批量刪除",
        ) from e


@router.get("/me", response_model=SchoolClassListItem | None, summary="查詢我目前的班級")
async def get_my_class(session: DbDep, user: CurrentUser) -> SchoolClass | None:
    return await class_svc.resolve_user_class(session, user)


@router.get("/{class_id}", response_model=SchoolClassOut, summary="取得班級詳情")
async def get_class(class_id: uuid.UUID, session: DbDep, _: ManagerUser) -> SchoolClass:
    return await _get_class_or_404(class_id, session)


@router.patch("/{class_id}", response_model=SchoolClassOut, summary="更新班級")
async def update_class(
    class_id: uuid.UUID, payload: SchoolClassUpdate, session: DbDep, _: ManagerUser
) -> SchoolClass:
    sc = await _get_class_or_404(class_id, session)
    try:
        return await class_svc.update_class(session, sc, data=payload)
    except IntegrityError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="同一學年度已存在相同班級代碼",
        ) from e


@router.delete("/{class_id}", status_code=status.HTTP_204_NO_CONTENT, summary="刪除班級")
async def delete_class(class_id: uuid.UUID, session: DbDep, _: ManagerUser) -> None:
    sc = await _get_class_or_404(class_id, session)
    await session.delete(sc)


# ── 班級成員 ──────────────────────────────────────────────────────────────────


@router.get(
    "/{class_id}/members",
    response_model=list[ClassMemberOut],
    summary="列出班級成員（依學號區間推導）",
)
async def list_members(class_id: uuid.UUID, session: DbDep, _: ManagerUser) -> list[ClassMemberOut]:
    sc = await _get_class_or_404(class_id, session)
    return await class_svc.list_class_members(session, sc)


@router.get(
    "/{class_id}/memberships",
    response_model=list[ClassMembershipOut],
    summary="列出年度班級名冊快照",
)
async def list_memberships(class_id: uuid.UUID, session: DbDep, _: ManagerUser) -> list:
    sc = await _get_class_or_404(class_id, session)
    return await class_svc.list_memberships(session, sc)


@router.post(
    "/{class_id}/memberships",
    response_model=ClassMembershipOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增年度名冊成員",
)
async def add_membership(
    class_id: uuid.UUID,
    payload: ClassMembershipCreate,
    session: DbDep,
    _: ManagerUser,
) -> object:
    sc = await _get_class_or_404(class_id, session)
    try:
        return await class_svc.add_membership(session, sc, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.delete(
    "/{class_id}/memberships/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="結束班級名冊歸屬",
)
async def end_membership(
    class_id: uuid.UUID, user_id: uuid.UUID, session: DbDep, _: ManagerUser
) -> None:
    if not await class_svc.end_membership(session, class_id, user_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到有效名冊歸屬")


@router.get(
    "/{class_id}/roles",
    response_model=list[ClassRoleOut],
    summary="列出班級 RBAC 職位綁定",
)
async def list_class_roles(class_id: uuid.UUID, session: DbDep, _: ManagerUser) -> list:
    sc = await _get_class_or_404(class_id, session)
    return await class_svc.list_class_roles(session, sc)


@router.post(
    "/{class_id}/roles/{role_key}/assign",
    status_code=status.HTTP_201_CREATED,
    summary="任命班級職位；班代會同步授予議員職位",
)
async def assign_class_role(
    class_id: uuid.UUID,
    role_key: str,
    payload: ClassRoleAssign,
    session: DbDep,
    _: ManagerUser,
) -> dict:
    sc = await _get_class_or_404(class_id, session)
    try:
        up = await class_svc.assign_class_role(session, sc, role_key=role_key, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    return {"user_position_id": up.id, "position_id": up.position_id}


# ── 學號區間 ──────────────────────────────────────────────────────────────────


@router.post(
    "/{class_id}/ranges",
    response_model=ClassStudentRangeOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增學號區間規則",
)
async def add_range(
    class_id: uuid.UUID,
    payload: ClassStudentRangeCreate,
    session: DbDep,
    _: ManagerUser,
) -> ClassStudentRangeOut:
    sc = await _get_class_or_404(class_id, session)
    rng = await class_svc.add_range(session, sc, data=payload)
    return ClassStudentRangeOut.model_validate(rng)


@router.delete(
    "/{class_id}/ranges/{range_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除學號區間規則",
)
async def delete_range(
    class_id: uuid.UUID, range_id: uuid.UUID, session: DbDep, _: ManagerUser
) -> None:
    if not await class_svc.delete_range(session, range_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此學號區間")


# ── 手動成員 ──────────────────────────────────────────────────────────────────


@router.post(
    "/{class_id}/members",
    response_model=ClassManualMemberOut,
    status_code=status.HTTP_201_CREATED,
    summary="手動加入班級成員",
)
async def add_manual_member(
    class_id: uuid.UUID,
    payload: ClassManualMemberCreate,
    session: DbDep,
    _: ManagerUser,
) -> ClassManualMemberOut:
    sc = await _get_class_or_404(class_id, session)
    try:
        member = await class_svc.add_manual_member(session, sc, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    return ClassManualMemberOut.model_validate(member)


@router.get(
    "/{class_id}/manual-members",
    response_model=list[ClassManualMemberOut],
    summary="列出手動加入的班級成員",
)
async def list_manual_members(
    class_id: uuid.UUID, session: DbDep, _: ManagerUser
) -> list[ClassManualMemberOut]:
    sc = await _get_class_or_404(class_id, session)
    return await class_svc.list_manual_members(session, sc)


@router.delete(
    "/{class_id}/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="移除手動加入的班級成員",
)
async def remove_manual_member(
    class_id: uuid.UUID, user_id: uuid.UUID, session: DbDep, _: ManagerUser
) -> None:
    if not await class_svc.remove_manual_member(session, class_id, user_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此手動成員")


# ── 班級幹部 ──────────────────────────────────────────────────────────────────


@router.post(
    "/{class_id}/cadres",
    response_model=ClassCadreOut,
    status_code=status.HTTP_201_CREATED,
    summary="指定班級幹部",
)
async def add_cadre(
    class_id: uuid.UUID, payload: ClassCadreCreate, session: DbDep, _: ManagerUser
) -> ClassCadreOut:
    sc = await _get_class_or_404(class_id, session)
    try:
        cadre = await class_svc.add_cadre(session, sc, user_id=payload.user_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    return ClassCadreOut.model_validate(cadre)


@router.delete(
    "/{class_id}/cadres/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="移除班級幹部",
)
async def remove_cadre(
    class_id: uuid.UUID, user_id: uuid.UUID, session: DbDep, _: ManagerUser
) -> None:
    if not await class_svc.remove_cadre(session, class_id, user_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此班級幹部")
