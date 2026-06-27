"""評議委員會訴訟 Router。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user, get_current_school_member
from api.dependencies.permissions import require_any
from api.models.judicial_petition import JudicialPetition, JudicialPetitionStatus
from api.models.user import User
from api.schemas.judicial_petition import (
    JudicialPetitionCreate,
    JudicialPetitionListItem,
    JudicialPetitionOut,
    JudicialPetitionStatusUpdate,
)
from api.services import audit as audit_svc
from api.services import judicial_petition as judicial_svc
from api.services.permission import get_user_permission_codes

router = APIRouter(prefix="/judicial-petitions", tags=["評議委員會訴訟"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
SchoolMember = Annotated[User, Depends(get_current_school_member)]


async def _petition_or_404(session: AsyncSession, petition_id: uuid.UUID) -> JudicialPetition:
    petition = await judicial_svc.get(session, petition_id)
    if petition is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此評議聲請")
    return petition


@router.post(
    "",
    response_model=JudicialPetitionOut,
    status_code=status.HTTP_201_CREATED,
    summary="向評議委員會提出訴訟或審查聲請",
)
async def create_judicial_petition(
    payload: JudicialPetitionCreate,
    session: DbDep,
    current_user: SchoolMember,
) -> JudicialPetition:
    petition = await judicial_svc.create(session, data=payload, submitter=current_user)
    await audit_svc.record(
        session,
        entity_type="judicial_petition",
        entity_id=str(petition.id),
        action="judicial_petition.create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"docket_number": petition.docket_number, "petition_type": petition.petition_type},
        summary=f"建立評議聲請 {petition.docket_number}",
    )
    return petition


@router.get("/my", response_model=list[JudicialPetitionListItem], summary="列出我送出的評議聲請")
async def list_my_judicial_petitions(
    session: DbDep,
    current_user: CurrentUser,
    status_filter: JudicialPetitionStatus | None = Query(None, alias="status"),
    limit: int = Query(80, ge=1, le=300),
    offset: int = Query(0, ge=0),
) -> list[JudicialPetition]:
    return await judicial_svc.list_items(
        session,
        submitter_id=current_user.id,
        status=status_filter,
        limit=limit,
        offset=offset,
    )


@router.get(
    "",
    response_model=list[JudicialPetitionListItem],
    summary="管理端列出評議聲請",
    dependencies=[
        Depends(
            require_any(
                PermissionCode.JUDICIAL_PETITION_MANAGE,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def list_judicial_petitions(
    session: DbDep,
    _: CurrentUser,
    status_filter: JudicialPetitionStatus | None = Query(None, alias="status"),
    limit: int = Query(80, ge=1, le=300),
    offset: int = Query(0, ge=0),
) -> list[JudicialPetition]:
    return await judicial_svc.list_items(
        session,
        status=status_filter,
        limit=limit,
        offset=offset,
    )


@router.get("/{petition_id}", response_model=JudicialPetitionOut, summary="取得評議聲請詳情")
async def get_judicial_petition(
    petition_id: uuid.UUID, session: DbDep, user: CurrentUser
) -> JudicialPetition:
    petition = await _petition_or_404(session, petition_id)
    if petition.submitter_id == user.id or user.is_superuser:
        return petition
    codes = await get_user_permission_codes(session, user.id)
    if codes & {
        str(PermissionCode.JUDICIAL_PETITION_MANAGE),
        str(PermissionCode.ADMIN_ALL),
    }:
        return petition
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此評議聲請")


@router.patch(
    "/{petition_id}/status",
    response_model=JudicialPetitionOut,
    summary="更新評議聲請狀態",
    dependencies=[
        Depends(
            require_any(
                PermissionCode.JUDICIAL_PETITION_MANAGE,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def update_judicial_petition_status(
    petition_id: uuid.UUID,
    payload: JudicialPetitionStatusUpdate,
    session: DbDep,
    user: CurrentUser,
) -> JudicialPetition:
    petition = await _petition_or_404(session, petition_id)
    petition = await judicial_svc.update_status(session, petition, data=payload, actor=user)
    await audit_svc.record(
        session,
        entity_type="judicial_petition",
        entity_id=str(petition.id),
        action="judicial_petition.status",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=payload.model_dump(mode="json"),
        summary=f"更新評議聲請 {petition.docket_number} 狀態為 {petition.status}",
    )
    return petition
