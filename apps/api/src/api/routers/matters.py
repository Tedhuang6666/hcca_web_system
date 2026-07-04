"""Matter integration router."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_any
from api.models.governance import EntityRelation, Matter, MatterResource
from api.models.user import User
from api.schemas.governance import (
    EntityRelationCreate,
    EntityRelationOut,
    MatterCreate,
    MatterListItem,
    MatterOut,
    MatterResourceCreate,
    MatterResourceOut,
    MatterResourceUpdate,
    MatterUpdate,
    TimelineEventOut,
)
from api.services import audit as audit_svc
from api.services import matter as matter_svc

router = APIRouter(prefix="/matters", tags=["事項整合工作台"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
MatterManagerDep = Depends(
    require_any(
        PermissionCode.ACTIVITY_MANAGE,
        PermissionCode.MEETING_MANAGE,
        PermissionCode.DOCUMENT_ADMIN,
        PermissionCode.ADMIN_ALL,
    )
)


async def _matter_or_404(db: AsyncSession, matter_id: uuid.UUID) -> Matter:
    matter = await matter_svc.get_matter(db, matter_id)
    if matter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="事項不存在")
    return matter


async def _relation_or_404(
    db: AsyncSession, matter_id: uuid.UUID, relation_id: uuid.UUID
) -> EntityRelation:
    relation = await matter_svc.get_relation(db, relation_id)
    if relation is None or relation.matter_id != matter_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="事項關聯不存在")
    return relation


async def _resource_or_404(
    db: AsyncSession, matter_id: uuid.UUID, resource_id: uuid.UUID
) -> MatterResource:
    resource = await matter_svc.get_resource(db, resource_id)
    if resource is None or resource.matter_id != matter_id or not resource.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="事項資源不存在")
    return resource


@router.get("", response_model=list[MatterListItem], summary="列出事項")
async def list_matters(
    db: DbDep,
    user: CurrentUser,
    status_filter: str | None = Query(None, alias="status"),
    matter_type: str | None = Query(None),
    q: str | None = Query(None),
    limit: int = Query(80, ge=1, le=300),
    offset: int = Query(0, ge=0),
) -> list[MatterListItem]:
    return await matter_svc.list_matters(
        db,
        user=user,
        status=status_filter,
        matter_type=matter_type,
        q=q,
        limit=limit,
        offset=offset,
    )


@router.post(
    "",
    response_model=MatterOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立事項",
    dependencies=[MatterManagerDep],
)
async def create_matter(body: MatterCreate, db: DbDep, user: CurrentUser) -> Matter:
    matter = await matter_svc.create_matter(db, data=body, user=user)
    await audit_svc.record(
        db,
        entity_type="matter",
        entity_id=str(matter.id),
        action="matter.create",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=body.model_dump(mode="json"),
        summary=f"建立事項：{matter.title}",
    )
    return await _matter_or_404(db, matter.id)


@router.get("/{matter_id}", response_model=MatterOut, summary="取得事項詳情")
async def get_matter(matter_id: uuid.UUID, db: DbDep, _: CurrentUser) -> Matter:
    return await _matter_or_404(db, matter_id)


@router.patch(
    "/{matter_id}",
    response_model=MatterOut,
    summary="更新事項",
    dependencies=[MatterManagerDep],
)
async def update_matter(
    matter_id: uuid.UUID,
    body: MatterUpdate,
    db: DbDep,
    user: CurrentUser,
) -> Matter:
    matter = await _matter_or_404(db, matter_id)
    updated = await matter_svc.update_matter(db, matter=matter, data=body, user=user)
    await audit_svc.record(
        db,
        entity_type="matter",
        entity_id=str(updated.id),
        action="matter.update",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=body.model_dump(exclude_unset=True, mode="json"),
        summary=f"更新事項：{updated.title}",
    )
    return await _matter_or_404(db, updated.id)


@router.get(
    "/{matter_id}/timeline",
    response_model=list[TimelineEventOut],
    summary="取得事項時間軸",
)
async def get_matter_timeline(
    matter_id: uuid.UUID, db: DbDep, _: CurrentUser
) -> list[TimelineEventOut]:
    await _matter_or_404(db, matter_id)
    return [
        TimelineEventOut.model_validate(row)
        for row in await matter_svc.list_timeline(db, matter_id)
    ]


@router.post(
    "/{matter_id}/relations",
    response_model=EntityRelationOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增事項關聯",
    dependencies=[MatterManagerDep],
)
async def create_matter_relation(
    matter_id: uuid.UUID,
    body: EntityRelationCreate,
    db: DbDep,
    user: CurrentUser,
) -> EntityRelationOut:
    matter = await _matter_or_404(db, matter_id)
    relation = await matter_svc.create_relation(db, matter=matter, data=body, user=user)
    await audit_svc.record(
        db,
        entity_type="matter_relation",
        entity_id=str(relation.id),
        action="matter.relation_create",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=body.model_dump(mode="json"),
        summary=f"新增事項「{matter.title}」關聯",
    )
    return EntityRelationOut.model_validate(relation)


@router.delete(
    "/{matter_id}/relations/{relation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除事項關聯",
    dependencies=[MatterManagerDep],
)
async def delete_matter_relation(
    matter_id: uuid.UUID,
    relation_id: uuid.UUID,
    db: DbDep,
    user: CurrentUser,
) -> None:
    relation = await _relation_or_404(db, matter_id, relation_id)
    await matter_svc.delete_relation(db, relation=relation, user=user)


@router.post(
    "/{matter_id}/resources",
    response_model=MatterResourceOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增事項外部資源",
    dependencies=[MatterManagerDep],
)
async def create_matter_resource(
    matter_id: uuid.UUID,
    body: MatterResourceCreate,
    db: DbDep,
    user: CurrentUser,
) -> MatterResourceOut:
    matter = await _matter_or_404(db, matter_id)
    resource = await matter_svc.create_resource(db, matter=matter, data=body, user=user)
    await audit_svc.record(
        db,
        entity_type="matter_resource",
        entity_id=str(resource.id),
        action="matter.resource_create",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=body.model_dump(mode="json"),
        summary=f"新增事項「{matter.title}」資源",
    )
    return MatterResourceOut.model_validate(resource)


@router.patch(
    "/{matter_id}/resources/{resource_id}",
    response_model=MatterResourceOut,
    summary="更新事項外部資源",
    dependencies=[MatterManagerDep],
)
async def update_matter_resource(
    matter_id: uuid.UUID,
    resource_id: uuid.UUID,
    body: MatterResourceUpdate,
    db: DbDep,
    user: CurrentUser,
) -> MatterResourceOut:
    resource = await _resource_or_404(db, matter_id, resource_id)
    updated = await matter_svc.update_resource(db, resource=resource, data=body, user=user)
    return MatterResourceOut.model_validate(updated)


@router.delete(
    "/{matter_id}/resources/{resource_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除事項外部資源",
    dependencies=[MatterManagerDep],
)
async def delete_matter_resource(
    matter_id: uuid.UUID,
    resource_id: uuid.UUID,
    db: DbDep,
    user: CurrentUser,
) -> None:
    resource = await _resource_or_404(db, matter_id, resource_id)
    await matter_svc.delete_resource(db, resource=resource, user=user)
