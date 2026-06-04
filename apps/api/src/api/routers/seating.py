"""劃位系統 Router - 場次/座位圖管理、分批時段、自助選位、管理員代劃。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.models.seating import SeatingZone
from api.models.user import User
from api.schemas.seating import (
    AdminAssignRequest,
    AssignmentOut,
    HoldOut,
    HoldRequest,
    SeatMapOut,
    SeatSelectRequest,
    SeatsReplace,
    WavesReplace,
    ZoneCreate,
    ZoneListItem,
    ZoneOut,
    ZoneUpdate,
)
from api.services import seating as seating_svc

router = APIRouter(prefix="/seating", tags=["劃位"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
SeatingManager = Annotated[User, Depends(require_permission(PermissionCode.SEATING_MANAGE))]
SeatingAssigner = Annotated[User, Depends(require_permission(PermissionCode.SEATING_ASSIGN))]


# ── 輔助 ─────────────────────────────────────────────────────────────────────


async def _get_zone_or_404(zone_id: uuid.UUID, session: AsyncSession) -> SeatingZone:
    zone = await seating_svc.get_zone(session, zone_id)
    if zone is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此場次")
    return zone


def _bad_request(exc: Exception) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


# ── 場次 / 座位圖管理（SEATING_MANAGE）─────────────────────────────────────────


@router.get(
    "/products/{product_id}/zones",
    response_model=list[ZoneListItem],
    summary="列出票種的場次（含座位統計）",
)
async def list_zones(product_id: uuid.UUID, session: DbDep, _: CurrentUser) -> list[ZoneListItem]:
    return await seating_svc.list_zones_for_product(session, product_id)


@router.post(
    "/zones",
    response_model=ZoneOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增場次（座位圖）",
)
async def create_zone(payload: ZoneCreate, session: DbDep, _: SeatingManager) -> SeatingZone:
    try:
        return await seating_svc.create_zone(session, data=payload)
    except ValueError as e:
        raise _bad_request(e) from e


@router.get("/zones/{zone_id}", response_model=ZoneOut, summary="場次完整內容（座位 + 時段）")
async def get_zone(zone_id: uuid.UUID, session: DbDep, _: CurrentUser) -> SeatingZone:
    return await _get_zone_or_404(zone_id, session)


@router.patch("/zones/{zone_id}", response_model=ZoneOut, summary="更新場次設定")
async def update_zone(
    zone_id: uuid.UUID, payload: ZoneUpdate, session: DbDep, _: SeatingManager
) -> SeatingZone:
    zone = await _get_zone_or_404(zone_id, session)
    return await seating_svc.update_zone(session, zone, data=payload)


@router.delete("/zones/{zone_id}", status_code=status.HTTP_204_NO_CONTENT, summary="刪除場次")
async def delete_zone(zone_id: uuid.UUID, session: DbDep, _: SeatingManager) -> None:
    zone = await _get_zone_or_404(zone_id, session)
    try:
        await seating_svc.delete_zone(session, zone)
    except ValueError as e:
        raise _bad_request(e) from e


@router.put(
    "/zones/{zone_id}/seats",
    response_model=ZoneOut,
    summary="儲存座位圖（覆蓋座位集合）",
)
async def replace_seats(
    zone_id: uuid.UUID, payload: SeatsReplace, session: DbDep, _: SeatingManager
) -> SeatingZone:
    zone = await _get_zone_or_404(zone_id, session)
    try:
        return await seating_svc.replace_seats(session, zone, data=payload)
    except ValueError as e:
        raise _bad_request(e) from e


@router.put(
    "/zones/{zone_id}/waves",
    response_model=ZoneOut,
    summary="儲存分批開放時段",
)
async def replace_waves(
    zone_id: uuid.UUID, payload: WavesReplace, session: DbDep, _: SeatingManager
) -> SeatingZone:
    zone = await _get_zone_or_404(zone_id, session)
    return await seating_svc.replace_waves(session, zone, data=payload)


@router.get(
    "/zones/{zone_id}/assignments",
    response_model=list[AssignmentOut],
    summary="場次的劃位清單（管理）",
    dependencies=[Depends(require_permission(PermissionCode.SEATING_MANAGE))],
)
async def list_zone_assignments(zone_id: uuid.UUID, session: DbDep) -> list[AssignmentOut]:
    rows = await seating_svc.list_assignments(session, zone_id=zone_id)
    return [seating_svc.serialize_assignment(a) for a in rows]


@router.delete(
    "/assignments/{assignment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="釋放劃位（管理）",
    dependencies=[Depends(require_permission(PermissionCode.SEATING_MANAGE))],
)
async def release_assignment(assignment_id: uuid.UUID, session: DbDep) -> None:
    try:
        await seating_svc.release_assignment(session, assignment_id)
    except ValueError as e:
        raise _bad_request(e) from e


# ── 管理員代為劃位（SEATING_ASSIGN）────────────────────────────────────────────


@router.post(
    "/assign",
    response_model=list[AssignmentOut],
    summary="管理員代為劃位（依到場順序）",
)
async def admin_assign(
    payload: AdminAssignRequest, session: DbDep, current_user: SeatingAssigner
) -> list[AssignmentOut]:
    try:
        await seating_svc.admin_assign(
            session, admin=current_user, order_id=payload.order_id, seat_ids=payload.seat_ids
        )
    except ValueError as e:
        raise _bad_request(e) from e
    return [
        seating_svc.serialize_assignment(a)
        for a in await seating_svc.list_assignments(session, order_id=payload.order_id)
    ]


# ── 使用者自助選位 ────────────────────────────────────────────────────────────


@router.get(
    "/zones/{zone_id}/map",
    response_model=SeatMapOut,
    summary="選位畫面（座位即時狀態 + 本人額度與資格）",
)
async def seat_map(
    zone_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
    order_id: uuid.UUID | None = Query(None),
) -> SeatMapOut:
    zone = await _get_zone_or_404(zone_id, session)
    return await seating_svc.get_seat_map(session, zone, current_user, order_id=order_id)


@router.post("/zones/{zone_id}/hold", response_model=HoldOut, summary="保留座位（暫時鎖）")
async def hold(
    zone_id: uuid.UUID, payload: HoldRequest, session: DbDep, current_user: CurrentUser
) -> HoldOut:
    zone = await _get_zone_or_404(zone_id, session)
    can_now, _ = await seating_svc.resolve_open_state(session, zone, current_user)
    if not can_now:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="尚未輪到您劃位")
    return await seating_svc.hold_seats(session, zone, current_user, payload.seat_ids)


@router.delete(
    "/zones/{zone_id}/hold",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="釋放本人在此場次的保留",
)
async def release_hold(zone_id: uuid.UUID, session: DbDep, current_user: CurrentUser) -> None:
    await seating_svc.release_holds(session, zone_id, current_user.id)


@router.post("/select", response_model=list[AssignmentOut], summary="確認劃位（自助）")
async def select_seats(
    payload: SeatSelectRequest, session: DbDep, current_user: CurrentUser
) -> list[AssignmentOut]:
    try:
        await seating_svc.confirm_selection(
            session, user=current_user, order_id=payload.order_id, seat_ids=payload.seat_ids
        )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except ValueError as e:
        raise _bad_request(e) from e
    return [
        seating_svc.serialize_assignment(a)
        for a in await seating_svc.list_assignments(session, order_id=payload.order_id)
    ]


@router.get(
    "/orders/{order_id}/assignments",
    response_model=list[AssignmentOut],
    summary="某訂單的劃位結果",
)
async def order_assignments(
    order_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> list[AssignmentOut]:
    rows = await seating_svc.list_assignments(session, order_id=order_id)
    return [seating_svc.serialize_assignment(a) for a in rows]
