"""跨模組工作流 Router。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_any
from api.models.user import User
from api.models.workflow import WorkflowInstance
from api.routers._common import or_404
from api.schemas.workflow import (
    WorkflowInstanceOut,
    WorkflowLinkCreate,
    WorkflowLinkOut,
    WorkflowTimelineOut,
    WorkflowTransitionCreate,
)
from api.services import audit as audit_svc
from api.services import workflow as workflow_svc
from api.services.permission import get_user_permission_codes

router = APIRouter(prefix="/workflows", tags=["跨模組工作流"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
WorkflowManagerDep = Depends(
    require_any(
        PermissionCode.COUNCIL_PROPOSAL_MANAGE,
        PermissionCode.JUDICIAL_PETITION_MANAGE,
        PermissionCode.ADMIN_ALL,
    )
)


async def _instance_or_404(db: AsyncSession, instance_id: uuid.UUID) -> WorkflowInstance:
    instance = await workflow_svc.get_instance(db, instance_id)
    return or_404(instance, "工作流不存在")


# 修改工作流必須持有該來源模組的管理權限；議會管理者不能推進司法案件，反之亦然。
_SOURCE_MANAGE_PERMISSION: dict[str, str] = {
    "judicial_petition": PermissionCode.JUDICIAL_PETITION_MANAGE,
    "council_proposal": PermissionCode.COUNCIL_PROPOSAL_MANAGE,
}


async def _require_source_manager(db: AsyncSession, user: User, instance: WorkflowInstance) -> None:
    required = _SOURCE_MANAGE_PERMISSION.get(instance.source_type)
    if required is None or user.is_superuser:
        return
    codes = await get_user_permission_codes(db, user.id)
    if required not in codes and PermissionCode.ADMIN_ALL not in codes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="沒有此工作流來源的管理權限"
        )


@router.get(
    "/instances",
    response_model=list[WorkflowInstanceOut],
    summary="列出跨模組工作流",
    dependencies=[WorkflowManagerDep],
)
async def list_workflow_instances(
    db: DbDep,
    _: CurrentUser,
    workflow_type: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(80, ge=1, le=300),
    offset: int = Query(0, ge=0),
) -> list[WorkflowInstance]:
    return await workflow_svc.list_instances(
        db,
        workflow_type=workflow_type,
        status=status_filter,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/instances/{instance_id}",
    response_model=WorkflowInstanceOut,
    summary="取得工作流詳情",
    dependencies=[WorkflowManagerDep],
)
async def get_workflow_instance(
    instance_id: uuid.UUID, db: DbDep, _: CurrentUser
) -> WorkflowInstance:
    return await _instance_or_404(db, instance_id)


@router.post(
    "/instances/{instance_id}/transition",
    response_model=WorkflowInstanceOut,
    summary="推進工作流狀態",
    dependencies=[WorkflowManagerDep],
)
async def transition_workflow_instance(
    instance_id: uuid.UUID,
    payload: WorkflowTransitionCreate,
    db: DbDep,
    user: CurrentUser,
) -> WorkflowInstance:
    instance = await _instance_or_404(db, instance_id)
    await _require_source_manager(db, user, instance)
    try:
        updated = await workflow_svc.transition_instance(
            db,
            instance,
            status=payload.status,
            actor_id=user.id,
            actor_email=user.email,
            note=payload.note,
            payload=payload.payload,
        )
    except workflow_svc.WorkflowTransitionError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    await audit_svc.record(
        db,
        entity_type="workflow_instance",
        entity_id=str(updated.id),
        action="workflow.transition",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=payload.model_dump(mode="json"),
        summary=f"推進工作流「{updated.title}」至 {updated.status}",
    )
    return updated


@router.get(
    "/instances/{instance_id}/timeline",
    response_model=WorkflowTimelineOut,
    summary="取得工作流時間軸",
    dependencies=[WorkflowManagerDep],
)
async def get_workflow_timeline(instance_id: uuid.UUID, db: DbDep, _: CurrentUser) -> dict:
    instance = await _instance_or_404(db, instance_id)
    events, links = await workflow_svc.timeline(db, instance)
    return {"instance": instance, "events": events, "links": links}


@router.post(
    "/instances/{instance_id}/links",
    response_model=WorkflowLinkOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增工作流關聯資源",
    dependencies=[WorkflowManagerDep],
)
async def create_workflow_link(
    instance_id: uuid.UUID,
    payload: WorkflowLinkCreate,
    db: DbDep,
    user: CurrentUser,
) -> WorkflowLinkOut:
    instance = await _instance_or_404(db, instance_id)
    await _require_source_manager(db, user, instance)
    link = await workflow_svc.add_link(db, instance, data=payload, created_by_id=user.id)
    await audit_svc.record(
        db,
        entity_type="workflow_link",
        entity_id=str(link.id),
        action="workflow.link_create",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=payload.model_dump(mode="json"),
        summary=f"新增工作流「{instance.title}」關聯資源",
    )
    return WorkflowLinkOut.model_validate(link)
