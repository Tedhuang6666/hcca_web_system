"""陳情系統 Router - 送件 / 查詢 / 機關工作台 / 類型管理 / 統計"""

from __future__ import annotations

import os
import uuid
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user, get_optional_user
from api.dependencies.permissions import require_any
from api.models.notification import Notification
from api.models.org import Position, UserPosition
from api.models.petition import (
    PetitionAttachment,
    PetitionAttachmentVisibility,
    PetitionCase,
    PetitionEventVisibility,
    PetitionStatus,
    PetitionType,
)
from api.models.user import User
from api.schemas.petition import (
    PetitionAssignUpdate,
    PetitionAttachmentOut,
    PetitionCaseListItem,
    PetitionCaseOut,
    PetitionCreate,
    PetitionCreatedOut,
    PetitionInternalNoteCreate,
    PetitionLookupOut,
    PetitionReplyCreate,
    PetitionStatsOut,
    PetitionStatusUpdate,
    PetitionSubmitterOut,
    PetitionSupplementCreate,
    PetitionTransferUpdate,
    PetitionTypeCreate,
    PetitionTypeOut,
    PetitionTypeUpdate,
)
from api.services import audit as audit_svc
from api.services import petition as petition_svc
from api.services.discord_bot import enqueue_petition_private_channel
from api.services.permission import get_user_org_ids_with_permission, get_user_permission_codes
from api.services.storage import get_storage

router = APIRouter(prefix="/petitions", tags=["陳情系統"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]


def _has_all_scope(codes: frozenset[str], user: User) -> bool:
    return user.is_superuser or bool(
        codes
        & {
            str(PermissionCode.ADMIN_ALL),
            str(PermissionCode.PETITION_ADMIN),
            str(PermissionCode.PETITION_VIEW_ALL),
            str(PermissionCode.PETITION_ANALYTICS_ALL),
        }
    )


async def _case_or_404(session: AsyncSession, case_id: uuid.UUID) -> PetitionCase:
    case_obj = await petition_svc.get_case(session, case_id)
    if case_obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此陳情案件")
    return case_obj


async def _manageable_org_ids(session: AsyncSession, user: User, *permissions: str) -> list[uuid.UUID] | None:
    codes = await get_user_permission_codes(session, user.id)
    if _has_all_scope(codes, user):
        return None
    org_ids: set[uuid.UUID] = set()
    for permission in permissions:
        org_ids.update(await get_user_org_ids_with_permission(session, user.id, permission))
    return list(org_ids)


async def _assert_case_access(
    session: AsyncSession, case_obj: PetitionCase, user: User
) -> tuple[bool, bool]:
    """回傳 (include_internal, can_view_submitter)。"""
    codes = await get_user_permission_codes(session, user.id)
    if case_obj.submitter_id == user.id:
        return False, True
    if user.is_superuser or str(PermissionCode.ADMIN_ALL) in codes or str(PermissionCode.PETITION_ADMIN) in codes:
        return True, case_obj.is_named
    if str(PermissionCode.PETITION_VIEW_ALL) in codes:
        return True, case_obj.is_named
    org_ids = set()
    for permission in (
        PermissionCode.PETITION_VIEW_ORG,
        PermissionCode.PETITION_ASSIGN,
        PermissionCode.PETITION_HANDLE,
        PermissionCode.PETITION_TRANSFER,
        PermissionCode.PETITION_ANALYTICS_ORG,
    ):
        org_ids.update(await get_user_org_ids_with_permission(session, user.id, str(permission)))
    if case_obj.current_org_id in org_ids:
        return True, case_obj.is_named
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權查看此陳情案件")


async def _notify(
    session: AsyncSession,
    *,
    user_id: uuid.UUID | None,
    type: str,
    title: str,
    body: str | None,
    link: str,
    related_id: uuid.UUID,
) -> None:
    if user_id is None:
        return
    session.add(
        Notification(
            user_id=user_id,
            type=type,
            title=title,
            body=body,
            link=link,
            related_id=related_id,
        )
    )


def _decorate_list_item(case_obj: PetitionCase) -> PetitionCaseListItem:
    return PetitionCaseListItem(
        id=case_obj.id,
        case_number=case_obj.case_number,
        type_id=case_obj.type_id,
        status=case_obj.status,
        is_named=case_obj.is_named,
        title=case_obj.title,
        current_org_id=case_obj.current_org_id,
        assigned_to_id=case_obj.assigned_to_id,
        submitted_at=case_obj.submitted_at,
        updated_at=case_obj.updated_at,
        status_label=petition_svc.STATUS_LABELS[case_obj.status],
        status_public_message=petition_svc.STATUS_MESSAGES[case_obj.status],
        next_action=petition_svc.NEXT_ACTIONS[case_obj.status],
        type_name=case_obj.type.name if case_obj.type else "",
        current_org_name=case_obj.current_org.name if case_obj.current_org else "",
        assigned_to_name=case_obj.assigned_to.display_name if case_obj.assigned_to else None,
        discord_guild_id=case_obj.discord_guild_id,
        discord_channel_id=case_obj.discord_channel_id,
        discord_channel_created_at=case_obj.discord_channel_created_at,
    )


async def _decorate_case(
    case_obj: PetitionCase,
    *,
    include_internal: bool,
    can_view_submitter: bool,
) -> PetitionCaseOut:
    storage = get_storage()
    events = [
        e
        for e in case_obj.events
        if include_internal or e.visibility == PetitionEventVisibility.PUBLIC
    ]
    attachments = []
    for att in case_obj.attachments:
        if not include_internal and att.visibility == PetitionAttachmentVisibility.INTERNAL:
            continue
        out = PetitionAttachmentOut.model_validate(att)
        out.url = await storage.get_url(att.storage_key)
        attachments.append(out)

    submitter = None
    if can_view_submitter:
        submitter = PetitionSubmitterOut(
            id=case_obj.submitter_id,
            display_name=case_obj.submitter.display_name if case_obj.submitter else None,
            email=case_obj.submitter.email if case_obj.submitter else None,
            student_id=case_obj.submitter.student_id if case_obj.submitter else None,
            contact_name=case_obj.contact_name,
            contact_email=case_obj.contact_email,
        )

    return PetitionCaseOut(
        **_decorate_list_item(case_obj).model_dump(),
        content=case_obj.content,
        public_reply=case_obj.public_reply,
        latest_internal_note=case_obj.latest_internal_note if include_internal else None,
        supplement_request=case_obj.supplement_request,
        rejection_reason=case_obj.rejection_reason,
        submitter_id=case_obj.submitter_id if can_view_submitter else None,
        contact_name=case_obj.contact_name if can_view_submitter else None,
        contact_email=case_obj.contact_email if can_view_submitter else None,
        assigned_at=case_obj.assigned_at,
        first_response_at=case_obj.first_response_at,
        resolved_at=case_obj.resolved_at,
        closed_at=case_obj.closed_at,
        can_supplement=case_obj.status == PetitionStatus.NEEDS_INFO,
        can_view_submitter=can_view_submitter,
        submitter=submitter,
        events=events,
        attachments=attachments,
    )


# ── 前台送件與查詢 ────────────────────────────────────────────────────────────


@router.get("/types", response_model=list[PetitionTypeOut], summary="取得啟用中的陳情類型")
async def list_public_types(session: DbDep) -> list[PetitionType]:
    return await petition_svc.list_types(session, active_only=True)


@router.post(
    "",
    response_model=PetitionCreatedOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立陳情案件（登入或訪客）",
)
async def create_petition(
    payload: PetitionCreate,
    session: DbDep,
    current_user: OptionalUser,
) -> PetitionCreatedOut:
    try:
        case_obj, code = await petition_svc.create_case(session, data=payload, submitter=current_user)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="petition_case",
        entity_id=str(case_obj.id),
        action="petition.create",
        actor_id=str(current_user.id) if current_user else None,
        actor_email=current_user.email if current_user else None,
        meta={"case_number": case_obj.case_number, "type_id": str(case_obj.type_id)},
        summary=f"建立陳情案件 {case_obj.case_number}",
    )
    await enqueue_petition_private_channel(session, case_obj)
    return PetitionCreatedOut(
        id=case_obj.id,
        case_number=case_obj.case_number,
        verification_code=code,
        status=case_obj.status,
        title=case_obj.title,
        status_label=petition_svc.STATUS_LABELS[case_obj.status],
        status_public_message=petition_svc.STATUS_MESSAGES[case_obj.status],
        next_action=petition_svc.NEXT_ACTIONS[case_obj.status],
        created_at=case_obj.created_at,
    )


@router.get("/lookup", response_model=PetitionLookupOut, summary="以案號與驗證碼查詢案件")
async def lookup_case(
    session: DbDep,
    case_number: str = Query(..., min_length=7, max_length=7, pattern=r"^\d{7}$"),
    verification_code: str = Query(..., min_length=5, max_length=5, pattern=r"^\d{5}$"),
) -> PetitionLookupOut:
    case_obj = await petition_svc.get_case_by_number(session, case_number)
    if case_obj is None or not petition_svc.verify_code(case_obj, verification_code):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="案號或驗證碼錯誤")
    return PetitionLookupOut.model_validate(
        await _decorate_case(case_obj, include_internal=False, can_view_submitter=True)
    )


@router.get("/my", response_model=list[PetitionCaseListItem], summary="列出我送出的陳情案件")
async def list_my_cases(
    session: DbDep,
    current_user: CurrentUser,
    status_filter: PetitionStatus | None = Query(None, alias="status"),
    keyword: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[PetitionCaseListItem]:
    cases = await petition_svc.list_cases(
        session,
        submitter_id=current_user.id,
        status=status_filter,
        keyword=keyword,
        limit=limit,
        offset=offset,
    )
    return [_decorate_list_item(c) for c in cases]


# ── 類型管理 ─────────────────────────────────────────────────────────────────


@router.get(
    "/admin/types",
    response_model=list[PetitionTypeOut],
    summary="管理端列出全部陳情類型",
    dependencies=[Depends(require_any(PermissionCode.PETITION_TYPE_MANAGE, PermissionCode.PETITION_ADMIN))],
)
async def list_admin_types(session: DbDep, _: CurrentUser) -> list[PetitionType]:
    return await petition_svc.list_types(session, active_only=False)


@router.post(
    "/admin/types",
    response_model=PetitionTypeOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增陳情類型",
    dependencies=[Depends(require_any(PermissionCode.PETITION_TYPE_MANAGE, PermissionCode.PETITION_ADMIN))],
)
async def create_type(payload: PetitionTypeCreate, session: DbDep, user: CurrentUser) -> PetitionType:
    petition_type = await petition_svc.create_type(session, payload)
    await audit_svc.record(
        session,
        entity_type="petition_type",
        entity_id=str(petition_type.id),
        action="petition_type.create",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=payload.model_dump(mode="json"),
        summary=f"建立陳情類型「{petition_type.name}」",
    )
    return petition_type


@router.patch(
    "/admin/types/{type_id}",
    response_model=PetitionTypeOut,
    summary="更新陳情類型",
    dependencies=[Depends(require_any(PermissionCode.PETITION_TYPE_MANAGE, PermissionCode.PETITION_ADMIN))],
)
async def update_type(
    type_id: uuid.UUID,
    payload: PetitionTypeUpdate,
    session: DbDep,
    user: CurrentUser,
) -> PetitionType:
    petition_type = await petition_svc.get_type(session, type_id)
    if petition_type is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此陳情類型")
    petition_type = await petition_svc.update_type(session, petition_type, payload)
    await audit_svc.record(
        session,
        entity_type="petition_type",
        entity_id=str(petition_type.id),
        action="petition_type.update",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=payload.model_dump(mode="json", exclude_unset=True),
        summary=f"更新陳情類型「{petition_type.name}」",
    )
    return petition_type


@router.delete(
    "/admin/types/{type_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除陳情類型（若已有案件請改停用）",
    dependencies=[Depends(require_any(PermissionCode.PETITION_TYPE_MANAGE, PermissionCode.PETITION_ADMIN))],
)
async def delete_type(type_id: uuid.UUID, session: DbDep, user: CurrentUser) -> None:
    petition_type = await petition_svc.get_type(session, type_id)
    if petition_type is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此陳情類型")
    await audit_svc.record(
        session,
        entity_type="petition_type",
        entity_id=str(petition_type.id),
        action="petition_type.delete",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={"name": petition_type.name},
        summary=f"刪除陳情類型「{petition_type.name}」",
    )
    await petition_svc.delete_type(session, petition_type)


# ── 機關工作台與統計 ─────────────────────────────────────────────────────────


@router.get(
    "/manage",
    response_model=list[PetitionCaseListItem],
    summary="機關工作台案件列表",
)
async def list_manage_cases(
    session: DbDep,
    user: CurrentUser,
    status_filter: PetitionStatus | None = Query(None, alias="status"),
    assigned_to_me: bool = False,
    keyword: str | None = None,
    limit: int = Query(80, ge=1, le=300),
    offset: int = Query(0, ge=0),
) -> list[PetitionCaseListItem]:
    org_ids = await _manageable_org_ids(
        session,
        user,
        str(PermissionCode.PETITION_VIEW_ORG),
        str(PermissionCode.PETITION_ASSIGN),
        str(PermissionCode.PETITION_HANDLE),
        str(PermissionCode.PETITION_TRANSFER),
    )
    cases = await petition_svc.list_cases(
        session,
        org_ids=org_ids,
        assigned_to_id=user.id if assigned_to_me else None,
        status=status_filter,
        keyword=keyword,
        limit=limit,
        offset=offset,
    )
    return [_decorate_list_item(c) for c in cases]


@router.get("/stats", response_model=PetitionStatsOut, summary="陳情案件統計")
async def get_stats(session: DbDep, user: CurrentUser) -> PetitionStatsOut:
    codes = await get_user_permission_codes(session, user.id)
    include_all = _has_all_scope(codes, user)
    include_by_org = include_all or bool(
        codes & {str(PermissionCode.PETITION_ANALYTICS_ORG), str(PermissionCode.PETITION_VIEW_ORG)}
    )
    org_ids = None if include_all else await _manageable_org_ids(
        session,
        user,
        str(PermissionCode.PETITION_ANALYTICS_ORG),
        str(PermissionCode.PETITION_VIEW_ORG),
        str(PermissionCode.PETITION_ASSIGN),
        str(PermissionCode.PETITION_HANDLE),
    )
    return await petition_svc.stats(
        session,
        org_ids=org_ids,
        user_id=user.id,
        include_by_org=include_by_org,
    )


@router.get("/{case_id}", response_model=PetitionCaseOut, summary="取得陳情案件詳情")
async def get_case(case_id: uuid.UUID, session: DbDep, user: CurrentUser) -> PetitionCaseOut:
    case_obj = await _case_or_404(session, case_id)
    include_internal, can_view_submitter = await _assert_case_access(session, case_obj, user)
    return await _decorate_case(
        case_obj,
        include_internal=include_internal,
        can_view_submitter=can_view_submitter,
    )


@router.get("/{case_id}/assignable-users", response_model=list[dict], summary="列出可分案承辦人")
async def list_assignable_users(case_id: uuid.UUID, session: DbDep, user: CurrentUser) -> list[dict]:
    case_obj = await _case_or_404(session, case_id)
    await _assert_case_access(session, case_obj, user)
    from datetime import date

    today = date.today()
    result = await session.execute(
        select(User)
        .join(UserPosition, UserPosition.user_id == User.id)
        .join(Position, Position.id == UserPosition.position_id)
        .where(
            Position.org_id == case_obj.current_org_id,
            User.is_active == True,  # noqa: E712
            UserPosition.start_date <= today,
            (UserPosition.end_date.is_(None)) | (UserPosition.end_date >= today),
        )
        .order_by(User.display_name)
        .distinct()
    )
    return [
        {"id": str(u.id), "display_name": u.display_name, "email": u.email}
        for u in result.scalars().all()
    ]


@router.post("/{case_id}/discord-channel", response_model=PetitionCaseOut, summary="建立陳情私密 Discord 頻道")
async def create_petition_discord_channel(
    case_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> PetitionCaseOut:
    case_obj = await _case_or_404(session, case_id)
    include_internal, can_view_submitter = await _assert_case_access(session, case_obj, current_user)
    if not include_internal:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權建立陳情私密頻道")
    queued = await enqueue_petition_private_channel(session, case_obj, force=True)
    if not queued:
        raise HTTPException(status_code=409, detail="此案件已建立頻道，或 Discord 陳情頻道設定尚未完成")
    await audit_svc.record(
        session,
        entity_type="petition_case",
        entity_id=str(case_obj.id),
        action="petition.discord_channel.create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"case_number": case_obj.case_number},
        summary=f"建立陳情 Discord 私密頻道 {case_obj.case_number}",
    )
    return await _decorate_case(
        case_obj, include_internal=include_internal, can_view_submitter=can_view_submitter
    )


@router.post("/{case_id}/supplement", response_model=PetitionCaseOut, summary="補充資料")
async def supplement_case(
    case_id: uuid.UUID,
    payload: PetitionSupplementCreate,
    session: DbDep,
    user: OptionalUser,
) -> PetitionCaseOut:
    case_obj = await _case_or_404(session, case_id)
    if (
        (user is None or case_obj.submitter_id != user.id)
        and (
            not payload.verification_code
            or not petition_svc.verify_code(case_obj, payload.verification_code)
        )
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要本人登入或正確驗證碼")
    if case_obj.status != PetitionStatus.NEEDS_INFO:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="此案件目前不需要補件")
    case_obj = await petition_svc.supplement_case(
        session,
        case_obj,
        data=payload,
        actor_id=user.id if user else None,
    )
    await _notify(
        session,
        user_id=case_obj.assigned_to_id,
        type="petition_supplemented",
        title=f"陳情案件 {case_obj.case_number} 已補件",
        body=case_obj.title,
        link=f"/petitions/manage?case={case_obj.id}",
        related_id=case_obj.id,
    )
    return await _decorate_case(case_obj, include_internal=False, can_view_submitter=True)


@router.patch(
    "/{case_id}/assign",
    response_model=PetitionCaseOut,
    summary="機關內部分案",
    dependencies=[Depends(require_any(PermissionCode.PETITION_ASSIGN, PermissionCode.PETITION_ADMIN))],
)
async def assign_case(
    case_id: uuid.UUID,
    payload: PetitionAssignUpdate,
    session: DbDep,
    user: CurrentUser,
) -> PetitionCaseOut:
    case_obj = await _case_or_404(session, case_id)
    await _assert_case_access(session, case_obj, user)
    try:
        case_obj = await petition_svc.assign_case(session, case_obj, data=payload, actor_id=user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await _notify(
        session,
        user_id=case_obj.assigned_to_id,
        type="petition_assigned",
        title=f"你被指派陳情案件 {case_obj.case_number}",
        body=case_obj.title,
        link=f"/petitions/manage?case={case_obj.id}",
        related_id=case_obj.id,
    )
    return await _decorate_case(case_obj, include_internal=True, can_view_submitter=case_obj.is_named)


@router.patch(
    "/{case_id}/transfer",
    response_model=PetitionCaseOut,
    summary="轉派負責機關",
    dependencies=[Depends(require_any(PermissionCode.PETITION_TRANSFER, PermissionCode.PETITION_ADMIN))],
)
async def transfer_case(
    case_id: uuid.UUID,
    payload: PetitionTransferUpdate,
    session: DbDep,
    user: CurrentUser,
) -> PetitionCaseOut:
    case_obj = await _case_or_404(session, case_id)
    await _assert_case_access(session, case_obj, user)
    try:
        case_obj = await petition_svc.transfer_case(session, case_obj, data=payload, actor_id=user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await _notify(
        session,
        user_id=case_obj.submitter_id,
        type="petition_transferred",
        title=f"陳情案件 {case_obj.case_number} 已轉派",
        body=payload.reason,
        link=f"/petitions/{case_obj.id}",
        related_id=case_obj.id,
    )
    return await _decorate_case(case_obj, include_internal=True, can_view_submitter=case_obj.is_named)


@router.post(
    "/{case_id}/reply",
    response_model=PetitionCaseOut,
    summary="承辦回覆",
    dependencies=[Depends(require_any(PermissionCode.PETITION_HANDLE, PermissionCode.PETITION_ADMIN))],
)
async def reply_case(
    case_id: uuid.UUID,
    payload: PetitionReplyCreate,
    session: DbDep,
    user: CurrentUser,
) -> PetitionCaseOut:
    case_obj = await _case_or_404(session, case_id)
    await _assert_case_access(session, case_obj, user)
    case_obj = await petition_svc.reply_case(session, case_obj, data=payload, actor_id=user.id)
    await _notify(
        session,
        user_id=case_obj.submitter_id,
        type="petition_replied",
        title=f"陳情案件 {case_obj.case_number} 已回覆",
        body=case_obj.title,
        link=f"/petitions/{case_obj.id}",
        related_id=case_obj.id,
    )
    return await _decorate_case(case_obj, include_internal=True, can_view_submitter=case_obj.is_named)


@router.patch(
    "/{case_id}/status",
    response_model=PetitionCaseOut,
    summary="更新案件狀態",
    dependencies=[Depends(require_any(PermissionCode.PETITION_HANDLE, PermissionCode.PETITION_ADMIN))],
)
async def update_status(
    case_id: uuid.UUID,
    payload: PetitionStatusUpdate,
    session: DbDep,
    user: CurrentUser,
) -> PetitionCaseOut:
    case_obj = await _case_or_404(session, case_id)
    await _assert_case_access(session, case_obj, user)
    try:
        case_obj = await petition_svc.update_status(session, case_obj, data=payload, actor_id=user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await _notify(
        session,
        user_id=case_obj.submitter_id,
        type=f"petition_{case_obj.status.value}",
        title=f"陳情案件 {case_obj.case_number} 狀態更新",
        body=petition_svc.STATUS_LABELS[case_obj.status],
        link=f"/petitions/{case_obj.id}",
        related_id=case_obj.id,
    )
    return await _decorate_case(case_obj, include_internal=True, can_view_submitter=case_obj.is_named)


@router.post(
    "/{case_id}/notes",
    response_model=PetitionCaseOut,
    summary="新增內部備註",
    dependencies=[Depends(require_any(PermissionCode.PETITION_HANDLE, PermissionCode.PETITION_ADMIN))],
)
async def add_note(
    case_id: uuid.UUID,
    payload: PetitionInternalNoteCreate,
    session: DbDep,
    user: CurrentUser,
) -> PetitionCaseOut:
    case_obj = await _case_or_404(session, case_id)
    await _assert_case_access(session, case_obj, user)
    case_obj = await petition_svc.add_internal_note(session, case_obj, data=payload, actor_id=user.id)
    return await _decorate_case(case_obj, include_internal=True, can_view_submitter=case_obj.is_named)


# ── 附件 ─────────────────────────────────────────────────────────────────────


@router.post("/{case_id}/attachments", response_model=PetitionAttachmentOut, status_code=201)
async def upload_attachment(
    case_id: uuid.UUID,
    session: DbDep,
    user: OptionalUser,
    verification_code: str | None = Form(None),
    visibility: PetitionAttachmentVisibility = Form(PetitionAttachmentVisibility.PUBLIC),
    file: UploadFile = File(...),
) -> PetitionAttachmentOut:
    case_obj = await _case_or_404(session, case_id)
    include_internal = False
    if user is not None:
        try:
            include_internal, _ = await _assert_case_access(session, case_obj, user)
        except HTTPException:
            include_internal = False
    if (
        not include_internal
        and (user is None or case_obj.submitter_id != user.id)
        and (not verification_code or not petition_svc.verify_code(case_obj, verification_code))
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要權限或正確驗證碼")
    if not include_internal:
        visibility = PetitionAttachmentVisibility.PUBLIC

    storage = get_storage()
    try:
        stored = await storage.save(file, prefix=f"petitions/{case_obj.case_number}")
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    attachment = await petition_svc.add_attachment(
        session,
        case_obj,
        filename=stored.filename,
        storage_key=stored.storage_key,
        content_type=stored.content_type,
        file_size=stored.file_size,
        visibility=visibility,
        uploaded_by=user.id if user else None,
    )
    out = PetitionAttachmentOut.model_validate(attachment)
    out.url = stored.url
    return out


@router.get("/{case_id}/attachments/{attachment_id}/download", summary="下載陳情附件")
async def download_attachment(
    case_id: uuid.UUID,
    attachment_id: uuid.UUID,
    session: DbDep,
    user: OptionalUser,
    verification_code: str | None = Query(None),
) -> FileResponse:
    case_obj = await _case_or_404(session, case_id)
    include_internal = False
    if user is not None:
        try:
            include_internal, _ = await _assert_case_access(session, case_obj, user)
        except HTTPException:
            include_internal = False
    if (
        not include_internal
        and (user is None or case_obj.submitter_id != user.id)
        and (not verification_code or not petition_svc.verify_code(case_obj, verification_code))
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要權限或正確驗證碼")
    result = await session.execute(
        select(PetitionAttachment).where(
            PetitionAttachment.id == attachment_id,
            PetitionAttachment.case_id == case_obj.id,
        )
    )
    att = result.scalar_one_or_none()
    if att is None or (att.visibility == PetitionAttachmentVisibility.INTERNAL and not include_internal):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此附件")
    filename = att.display_name or att.filename
    encoded_filename = quote(filename.encode("utf-8"))
    return FileResponse(
        path=os.path.join("uploads", att.storage_key),
        filename=filename,
        media_type=att.content_type,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"},
    )


@router.get("/{case_number}/{verification_code}", response_model=PetitionLookupOut, summary="以分享連結查詢案件")
async def lookup_case_by_share_link(
    case_number: str,
    verification_code: str,
    session: DbDep,
) -> PetitionLookupOut:
    if not case_number.isdigit() or len(case_number) != 7:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="案號或驗證碼錯誤")
    if not verification_code.isdigit() or len(verification_code) != 5:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="案號或驗證碼錯誤")
    case_obj = await petition_svc.get_case_by_number(session, case_number)
    if case_obj is None or not petition_svc.verify_code(case_obj, verification_code):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="案號或驗證碼錯誤")
    return PetitionLookupOut.model_validate(
        await _decorate_case(case_obj, include_internal=False, can_view_submitter=True)
    )
