"""工作分配與待辦事項 API。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.models.user import User
from api.schemas.work_item import WorkItemCreate, WorkItemOut, WorkItemUpdate
from api.services import audit as audit_svc
from api.services import work_item as work_item_svc

router = APIRouter(prefix="/work-items", tags=["工作分配"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


@router.get("", response_model=list[WorkItemOut], summary="列出工作分配")
async def list_work_items(
    db: DbDep,
    current_user: CurrentUser,
    assigned_to_id: uuid.UUID | None = None,
    include_done: bool = False,
    limit: int = Query(100, ge=1, le=200),
) -> list[WorkItemOut]:
    target_id = assigned_to_id if current_user.is_superuser else assigned_to_id or current_user.id
    rows = await work_item_svc.list_work_items(
        db, user_id=target_id, include_done=include_done, limit=limit
    )
    return [WorkItemOut.model_validate(row) for row in rows]


@router.post("", response_model=WorkItemOut, status_code=201, summary="建立工作分配")
async def create_work_item(
    body: WorkItemCreate, db: DbDep, current_user: CurrentUser
) -> WorkItemOut:
    item = await work_item_svc.create_work_item(db, data=body, created_by_id=current_user.id)
    await audit_svc.record(
        db,
        entity_type="work_item",
        entity_id=str(item.id),
        action="work_item.create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=body.model_dump(mode="json"),
        summary=f"建立工作分配：{item.title}",
    )
    return WorkItemOut.model_validate(item)


@router.patch("/{item_id}", response_model=WorkItemOut, summary="更新工作分配")
async def update_work_item(
    item_id: uuid.UUID, body: WorkItemUpdate, db: DbDep, current_user: CurrentUser
) -> WorkItemOut:
    item = await work_item_svc.get_work_item(db, item_id)
    if item is None or not item.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到工作項目")
    if (
        not current_user.is_superuser
        and item.created_by_id != current_user.id
        and item.assigned_to_id != current_user.id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權更新此工作項目")
    item = await work_item_svc.update_work_item(db, item=item, data=body)
    await audit_svc.record(
        db,
        entity_type="work_item",
        entity_id=str(item.id),
        action="work_item.update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=body.model_dump(mode="json", exclude_unset=True),
        summary=f"更新工作分配：{item.title}",
    )
    return WorkItemOut.model_validate(item)


@router.post("/{item_id}/complete", response_model=WorkItemOut, summary="完成工作分配")
async def complete_work_item(
    item_id: uuid.UUID, db: DbDep, current_user: CurrentUser
) -> WorkItemOut:
    item = await work_item_svc.get_work_item(db, item_id)
    if item is None or not item.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到工作項目")
    if not current_user.is_superuser and item.assigned_to_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權完成此工作項目")
    item = await work_item_svc.complete_work_item(db, item=item)
    await audit_svc.record(
        db,
        entity_type="work_item",
        entity_id=str(item.id),
        action="work_item.complete",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        summary=f"完成工作分配：{item.title}",
    )
    return WorkItemOut.model_validate(item)
