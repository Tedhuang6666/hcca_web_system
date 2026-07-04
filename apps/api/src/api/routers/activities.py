"""活動系統路由 - /activities"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.models.activity import Activity
from api.models.activity_discord import ActivityMember, ActivityRole
from api.models.user import User
from api.schemas.activity import (
    ActivityConvenerCreate,
    ActivityConvenerOut,
    ActivityConvenerUpdate,
    ActivityCreate,
    ActivityOut,
    ActivityUpdate,
)
from api.schemas.activity_discord import (
    ActivityMemberCreate,
    ActivityMemberOut,
    ActivityRoleCreate,
    ActivityRoleOut,
    ActivityRoleUpdate,
    DiscordActivityWorkspaceOut,
    DiscordActivityWorkspaceUpsert,
)
from api.schemas.activity_link import (
    ActivityClosingReportOut,
    ActivityLinkCreate,
    ActivityLinkOut,
    ActivityLinkSuggestion,
    ActivitySpawnCreate,
    ActivitySpawnOut,
    ActivityWorkspaceOut,
)
from api.services import activity as activity_svc
from api.services import activity_discord as activity_discord_svc
from api.services import activity_workspace as workspace_svc
from api.services import audit as audit_svc

router = APIRouter(prefix="/activities", tags=["活動系統"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


async def _activity_or_404(db: AsyncSession, activity_id: uuid.UUID) -> Activity:
    activity = await activity_svc.get_activity(db, activity_id)
    if activity is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="活動不存在")
    return activity


async def _require_activity_resource_manager(
    db: AsyncSession, user: User, activity_id: uuid.UUID
) -> None:
    if await activity_svc.can_manage_activity_resource(db, user, activity_id):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權管理此活動資源")


@router.get("", response_model=list[ActivityOut], summary="列出活動")
async def list_activities(
    db: DbDep,
    _: CurrentUser,
    org_id: uuid.UUID | None = Query(None),
    active_only: bool = Query(False),
) -> list[Activity]:
    return await activity_svc.list_activities(db, org_id=org_id, active_only=active_only)


@router.get("/mine", response_model=list[ActivityOut], summary="列出我擔任總召的活動")
async def list_my_activities(
    db: DbDep,
    user: CurrentUser,
    active_only: bool = Query(True),
) -> list[Activity]:
    return await activity_svc.list_user_convener_activities(db, user.id, active_only=active_only)


@router.post(
    "",
    response_model=ActivityOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立活動（需 activity:manage）",
    dependencies=[Depends(require_permission(PermissionCode.ACTIVITY_MANAGE))],
)
async def create_activity(payload: ActivityCreate, db: DbDep, user: CurrentUser) -> Activity:
    try:
        activity = await activity_svc.create_activity(db, payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await audit_svc.record(
        db,
        entity_type="activity",
        entity_id=str(activity.id),
        action="activity.create",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=payload.model_dump(mode="json"),
        summary=f"建立活動「{activity.name}」",
    )
    # 治理匯流：活動建立經 audit_svc.record()（action="activity.create"）統一橋接。
    return activity


@router.get("/{activity_id}", response_model=ActivityOut, summary="取得活動")
async def get_activity(activity_id: uuid.UUID, db: DbDep, _: CurrentUser) -> Activity:
    return await _activity_or_404(db, activity_id)


@router.get(
    "/{activity_id}/workspace",
    response_model=ActivityWorkspaceOut,
    summary="取得活動工作區聚合資料",
)
async def get_activity_workspace(
    activity_id: uuid.UUID, db: DbDep, _: CurrentUser
) -> ActivityWorkspaceOut:
    activity = await _activity_or_404(db, activity_id)
    return ActivityWorkspaceOut(**await workspace_svc.workspace(db, activity))


@router.post(
    "/{activity_id}/spawn",
    response_model=ActivitySpawnOut,
    status_code=status.HTTP_201_CREATED,
    summary="從活動工作區建立跨模組項目",
)
async def spawn_activity_item(
    activity_id: uuid.UUID,
    payload: ActivitySpawnCreate,
    db: DbDep,
    user: CurrentUser,
) -> ActivitySpawnOut:
    activity = await _activity_or_404(db, activity_id)
    await _require_activity_resource_manager(db, user, activity.id)
    try:
        result = await workspace_svc.spawn(db, activity, payload, actor=user)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    await audit_svc.record(
        db,
        entity_type="activity",
        entity_id=str(activity.id),
        action="activity.spawn",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=payload.model_dump(mode="json"),
        summary=f"從活動「{activity.name}」建立「{payload.title}」",
    )
    return ActivitySpawnOut(**result)


@router.get(
    "/{activity_id}/links",
    response_model=list[ActivityLinkOut],
    summary="列出活動跨模組關聯",
)
async def list_activity_links(
    activity_id: uuid.UUID, db: DbDep, _: CurrentUser
) -> list[ActivityLinkOut]:
    await _activity_or_404(db, activity_id)
    return [
        ActivityLinkOut.model_validate(link)
        for link in await workspace_svc.list_links(db, activity_id)
    ]


@router.post(
    "/{activity_id}/links",
    response_model=ActivityLinkOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立活動跨模組關聯",
)
async def create_activity_link(
    activity_id: uuid.UUID,
    payload: ActivityLinkCreate,
    db: DbDep,
    user: CurrentUser,
) -> ActivityLinkOut:
    activity = await _activity_or_404(db, activity_id)
    await _require_activity_resource_manager(db, user, activity.id)
    link = await workspace_svc.create_link(db, activity.id, payload, actor_id=user.id)
    await audit_svc.record(
        db,
        entity_type="activity_link",
        entity_id=str(link.id),
        action="activity.link_create",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=payload.model_dump(mode="json"),
        summary=f"建立活動「{activity.name}」關聯",
    )
    return ActivityLinkOut.model_validate(link)


@router.delete(
    "/{activity_id}/links/{link_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除活動跨模組關聯",
)
async def delete_activity_link(
    activity_id: uuid.UUID, link_id: uuid.UUID, db: DbDep, user: CurrentUser
) -> None:
    activity = await _activity_or_404(db, activity_id)
    await _require_activity_resource_manager(db, user, activity.id)
    link = await workspace_svc.get_link(db, link_id)
    if link is None or link.activity_id != activity_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="活動關聯不存在")
    await audit_svc.record(
        db,
        entity_type="activity_link",
        entity_id=str(link.id),
        action="activity.link_delete",
        actor_id=str(user.id),
        actor_email=user.email,
        summary="刪除活動關聯",
    )
    await workspace_svc.delete_link(db, link)


@router.get(
    "/{activity_id}/link-suggestions",
    response_model=list[ActivityLinkSuggestion],
    summary="取得活動跨模組關聯推薦",
)
async def activity_link_suggestions(
    activity_id: uuid.UUID,
    db: DbDep,
    _: CurrentUser,
    limit: int = Query(20, ge=1, le=100),
) -> list[ActivityLinkSuggestion]:
    activity = await _activity_or_404(db, activity_id)
    return await workspace_svc.suggestions_for_activity(db, activity, limit=limit)


@router.post(
    "/{activity_id}/link-suggestions/{suggestion_id}/accept",
    response_model=ActivityLinkOut,
    summary="接受活動關聯推薦",
)
async def accept_activity_link_suggestion(
    activity_id: uuid.UUID,
    suggestion_id: str,
    db: DbDep,
    user: CurrentUser,
) -> ActivityLinkOut:
    activity = await _activity_or_404(db, activity_id)
    await _require_activity_resource_manager(db, user, activity.id)
    try:
        link = await workspace_svc.accept_suggestion(db, activity, suggestion_id, actor_id=user.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await audit_svc.record(
        db,
        entity_type="activity_link",
        entity_id=str(link.id),
        action="activity.link_suggestion_accept",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"接受活動「{activity.name}」關聯推薦",
    )
    return ActivityLinkOut.model_validate(link)


@router.get(
    "/{activity_id}/closing-report",
    response_model=ActivityClosingReportOut,
    summary="取得活動結案報告",
)
async def activity_closing_report(
    activity_id: uuid.UUID, db: DbDep, _: CurrentUser
) -> ActivityClosingReportOut:
    await _activity_or_404(db, activity_id)
    return ActivityClosingReportOut(**await workspace_svc.closing_report(db, activity_id))


@router.patch(
    "/{activity_id}",
    response_model=ActivityOut,
    summary="更新活動（需 activity:manage）",
    dependencies=[Depends(require_permission(PermissionCode.ACTIVITY_MANAGE))],
)
async def update_activity(
    activity_id: uuid.UUID,
    payload: ActivityUpdate,
    db: DbDep,
    user: CurrentUser,
) -> Activity:
    activity = await _activity_or_404(db, activity_id)
    try:
        updated = await activity_svc.update_activity(db, activity, payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await audit_svc.record(
        db,
        entity_type="activity",
        entity_id=str(updated.id),
        action="activity.update",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=payload.model_dump(mode="json", exclude_unset=True),
        summary=f"更新活動「{updated.name}」",
    )
    return updated


@router.post(
    "/{activity_id}/archive",
    response_model=ActivityOut,
    summary="封存活動（需 activity:manage）",
    dependencies=[Depends(require_permission(PermissionCode.ACTIVITY_MANAGE))],
)
async def archive_activity(activity_id: uuid.UUID, db: DbDep, user: CurrentUser) -> Activity:
    activity = await _activity_or_404(db, activity_id)
    archived = await activity_svc.archive_activity(db, activity)
    discord_workspace = await activity_discord_svc.get_workspace(db, activity.id)
    if discord_workspace is not None and discord_workspace.is_active:
        await activity_discord_svc.enqueue_workspace_sync(db, discord_workspace, archive=True)
    await audit_svc.record(
        db,
        entity_type="activity",
        entity_id=str(archived.id),
        action="activity.archive",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"封存活動「{archived.name}」",
    )
    return archived


@router.get(
    "/{activity_id}/discord-workspace",
    response_model=DiscordActivityWorkspaceOut | None,
    summary="取得活動 Discord 工作區",
)
async def get_discord_workspace(
    activity_id: uuid.UUID, db: DbDep, _: CurrentUser
) -> DiscordActivityWorkspaceOut | None:
    await _activity_or_404(db, activity_id)
    return await activity_discord_svc.get_workspace(db, activity_id)


@router.put(
    "/{activity_id}/discord-workspace",
    response_model=DiscordActivityWorkspaceOut,
    summary="建立或更新活動 Discord 工作區",
)
async def upsert_discord_workspace(
    activity_id: uuid.UUID,
    payload: DiscordActivityWorkspaceUpsert,
    db: DbDep,
    user: CurrentUser,
) -> DiscordActivityWorkspaceOut:
    activity = await _activity_or_404(db, activity_id)
    await _require_activity_resource_manager(db, user, activity.id)
    workspace = await activity_discord_svc.upsert_workspace(db, activity, payload)
    await activity_discord_svc.enqueue_workspace_sync(db, workspace)
    await audit_svc.record(
        db,
        entity_type="discord_activity_workspace",
        entity_id=str(workspace.id),
        action="activity.discord_workspace.upsert",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=payload.model_dump(),
        summary=f"設定活動「{activity.name}」Discord 工作區",
    )
    return DiscordActivityWorkspaceOut.model_validate(workspace)


@router.post(
    "/{activity_id}/discord-workspace/sync",
    response_model=DiscordActivityWorkspaceOut,
    summary="同步活動 Discord 工作區",
)
async def sync_discord_workspace(
    activity_id: uuid.UUID, db: DbDep, user: CurrentUser
) -> DiscordActivityWorkspaceOut:
    activity = await _activity_or_404(db, activity_id)
    await _require_activity_resource_manager(db, user, activity.id)
    workspace = await activity_discord_svc.get_workspace(db, activity.id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="活動 Discord 工作區尚未設定")
    await activity_discord_svc.enqueue_workspace_sync(db, workspace)
    return DiscordActivityWorkspaceOut.model_validate(workspace)


@router.get(
    "/{activity_id}/roles",
    response_model=list[ActivityRoleOut],
    summary="列出活動職務",
)
async def list_activity_roles(
    activity_id: uuid.UUID, db: DbDep, _: CurrentUser
) -> list[ActivityRole]:
    await _activity_or_404(db, activity_id)
    return await activity_discord_svc.list_roles(db, activity_id)


@router.post(
    "/{activity_id}/roles",
    response_model=ActivityRoleOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立活動職務",
)
async def create_activity_role(
    activity_id: uuid.UUID,
    payload: ActivityRoleCreate,
    db: DbDep,
    user: CurrentUser,
) -> ActivityRole:
    activity = await _activity_or_404(db, activity_id)
    await _require_activity_resource_manager(db, user, activity.id)
    try:
        role = await activity_discord_svc.create_role(db, activity, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    await audit_svc.record(
        db,
        entity_type="activity_role",
        entity_id=str(role.id),
        action="activity.role.create",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=payload.model_dump(),
        summary=f"建立活動「{activity.name}」職務「{role.name}」",
    )
    return role


@router.patch(
    "/{activity_id}/roles/{role_id}",
    response_model=ActivityRoleOut,
    summary="更新活動職務",
)
async def update_activity_role(
    activity_id: uuid.UUID,
    role_id: uuid.UUID,
    payload: ActivityRoleUpdate,
    db: DbDep,
    user: CurrentUser,
) -> ActivityRole:
    activity = await _activity_or_404(db, activity_id)
    await _require_activity_resource_manager(db, user, activity.id)
    role = await db.get(ActivityRole, role_id)
    if role is None or role.activity_id != activity.id:
        raise HTTPException(status_code=404, detail="活動職務不存在")
    return await activity_discord_svc.update_role(db, role, payload)


@router.get(
    "/{activity_id}/members",
    response_model=list[ActivityMemberOut],
    summary="列出活動職務成員",
)
async def list_activity_members(
    activity_id: uuid.UUID, db: DbDep, _: CurrentUser
) -> list[ActivityMemberOut]:
    await _activity_or_404(db, activity_id)
    return [
        ActivityMemberOut.model_validate(member)
        for member in await activity_discord_svc.list_members(db, activity_id)
    ]


@router.post(
    "/{activity_id}/members",
    response_model=ActivityMemberOut,
    status_code=status.HTTP_201_CREATED,
    summary="任命活動職務成員",
)
async def appoint_activity_member(
    activity_id: uuid.UUID,
    payload: ActivityMemberCreate,
    db: DbDep,
    user: CurrentUser,
) -> ActivityMemberOut:
    activity = await _activity_or_404(db, activity_id)
    await _require_activity_resource_manager(db, user, activity.id)
    try:
        member = await activity_discord_svc.appoint_member(db, activity, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    await audit_svc.record(
        db,
        entity_type="activity_member",
        entity_id=str(member.id),
        action="activity.member.appoint",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=payload.model_dump(mode="json"),
        summary=f"任命活動「{activity.name}」職務成員",
    )
    return ActivityMemberOut.model_validate(member)


@router.delete(
    "/{activity_id}/members/{member_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="卸任活動職務成員",
)
async def remove_activity_member(
    activity_id: uuid.UUID,
    member_id: uuid.UUID,
    db: DbDep,
    user: CurrentUser,
) -> None:
    activity = await _activity_or_404(db, activity_id)
    await _require_activity_resource_manager(db, user, activity.id)
    member = await db.get(ActivityMember, member_id)
    if member is None or member.activity_id != activity.id:
        raise HTTPException(status_code=404, detail="活動職務任命不存在")
    await activity_discord_svc.remove_member(db, member)


@router.get(
    "/{activity_id}/conveners",
    response_model=list[ActivityConvenerOut],
    summary="列出活動總召",
)
async def list_conveners(
    activity_id: uuid.UUID, db: DbDep, _: CurrentUser
) -> list[ActivityConvenerOut]:
    await _activity_or_404(db, activity_id)
    return [
        ActivityConvenerOut.model_validate(convener)
        for convener in await activity_svc.list_conveners(db, activity_id)
    ]


@router.post(
    "/{activity_id}/conveners",
    response_model=ActivityConvenerOut,
    status_code=status.HTTP_201_CREATED,
    summary="任命活動總召（需 activity:appoint）",
    dependencies=[Depends(require_permission(PermissionCode.ACTIVITY_APPOINT))],
)
async def appoint_convener(
    activity_id: uuid.UUID,
    payload: ActivityConvenerCreate,
    db: DbDep,
    user: CurrentUser,
) -> ActivityConvenerOut:
    activity = await _activity_or_404(db, activity_id)
    try:
        convener = await activity_svc.appoint_convener(db, activity, payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await audit_svc.record(
        db,
        entity_type="activity_convener",
        entity_id=str(convener.id),
        action="activity.convener_appoint",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=payload.model_dump(mode="json"),
        summary=f"任命活動「{activity.name}」總召",
    )
    await activity_discord_svc.enqueue_workspace_sync_if_enabled(db, activity.id)
    from api.services.discord_bot import enqueue_role_sync

    await enqueue_role_sync(db, convener.user_id)
    return ActivityConvenerOut.model_validate(convener)


@router.patch(
    "/conveners/{convener_id}",
    response_model=ActivityConvenerOut,
    summary="更新活動總召任期（需 activity:appoint）",
    dependencies=[Depends(require_permission(PermissionCode.ACTIVITY_APPOINT))],
)
async def update_convener(
    convener_id: uuid.UUID,
    payload: ActivityConvenerUpdate,
    db: DbDep,
    user: CurrentUser,
) -> ActivityConvenerOut:
    convener = await activity_svc.get_convener(db, convener_id)
    if convener is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="總召任命不存在")
    try:
        updated = await activity_svc.update_convener(db, convener, payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await audit_svc.record(
        db,
        entity_type="activity_convener",
        entity_id=str(updated.id),
        action="activity.convener_update",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=payload.model_dump(mode="json", exclude_unset=True),
        summary="更新活動總召任期",
    )
    await activity_discord_svc.enqueue_workspace_sync_if_enabled(db, updated.activity_id)
    from api.services.discord_bot import enqueue_role_sync

    await enqueue_role_sync(db, updated.user_id)
    return ActivityConvenerOut.model_validate(updated)


@router.delete(
    "/conveners/{convener_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="卸任活動總召（需 activity:appoint）",
    dependencies=[Depends(require_permission(PermissionCode.ACTIVITY_APPOINT))],
)
async def remove_convener(convener_id: uuid.UUID, db: DbDep, user: CurrentUser) -> None:
    convener = await activity_svc.get_convener(db, convener_id)
    if convener is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="總召任命不存在")
    await audit_svc.record(
        db,
        entity_type="activity_convener",
        entity_id=str(convener.id),
        action="activity.convener_remove",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={"activity_id": str(convener.activity_id), "user_id": str(convener.user_id)},
        summary="卸任活動總召",
    )
    activity_id = convener.activity_id
    convener_user_id = convener.user_id
    await activity_svc.remove_convener(db, convener)
    await activity_discord_svc.enqueue_workspace_sync_if_enabled(db, activity_id)
    from api.services.discord_bot import enqueue_role_sync

    await enqueue_role_sync(db, convener_user_id)
