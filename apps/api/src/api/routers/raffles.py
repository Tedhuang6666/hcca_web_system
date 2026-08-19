"""現場抽獎 API。參加者只需驗證碼；管理端可調整獎池。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.permissions import require_permission
from api.models.raffle import RaffleStatus
from api.models.user import User
from api.schemas.raffle import (
    RaffleActivate,
    RaffleAdminOut,
    RaffleDrawOut,
    RaffleDrawRequest,
    RaffleEventOut,
    RaffleJoinOut,
    RaffleJoinRequest,
    RaffleNextOut,
    RaffleNextRequest,
    RafflePrizeOut,
    RaffleStatusUpdate,
)
from api.services import raffle as raffle_service

router = APIRouter(prefix="/raffles", tags=["抽獎活動"])
DbDep = Annotated[AsyncSession, Depends(get_db)]
AdminUser = Annotated[User, Depends(require_permission("admin:all"))]


def _draw_out(draw) -> RaffleDrawOut:
    return RaffleDrawOut(
        id=draw.id,
        draw_number=draw.draw_number,
        prize_id=draw.prize_id,
        prize_tier=draw.prize.tier,
        prize_name=draw.prize.name,
        created_at=draw.created_at,
    )


def _event_out(event) -> RaffleEventOut:
    probabilities = raffle_service.current_prize_probabilities(event)
    reserved = raffle_service.reserved_quantities(event)
    return RaffleEventOut(
        id=event.id,
        title=event.title,
        description=event.description,
        status=event.status,
        draw_count=event.draw_count,
        reserve_released=event.reserve_released,
        prizes=[
            RafflePrizeOut(
                id=prize.id,
                tier=prize.tier,
                name=prize.name,
                total_quantity=prize.total_quantity,
                remaining_quantity=prize.remaining_quantity,
                sort_order=prize.sort_order,
                reserved_quantity=0
                if prize.total_quantity is None
                else reserved.get(prize.tier, 0),
                current_probability=probabilities.get(prize.id, 0),
            )
            for prize in event.prizes
        ],
        created_at=event.created_at,
        updated_at=event.updated_at,
    )


@router.get("/ping", status_code=status.HTTP_204_NO_CONTENT)
async def raffle_ping() -> None:
    """讓匿名抽獎頁先取得 CSRF cookie，再送出 join。"""


@router.post("/join", response_model=RaffleJoinOut)
async def join(body: RaffleJoinRequest, db: DbDep) -> RaffleJoinOut:
    try:
        _session, event, token = await raffle_service.join_event(
            db, body.access_code, body.device_id
        )
        await db.commit()
    except PermissionError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return RaffleJoinOut(session_token=token, event=_event_out(event))


@router.get("/session", response_model=RaffleJoinOut)
async def restore_session(session_token: str, db: DbDep) -> RaffleJoinOut:
    try:
        session, event = await raffle_service.get_public_event(db, session_token)
        existing = await raffle_service.get_session_draw(db, session.id)
        return RaffleJoinOut(
            session_token=session_token,
            event=_event_out(event),
            existing_draw=_draw_out(existing) if existing else None,
        )
    except PermissionError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc


@router.post("/draw", response_model=RaffleDrawOut)
async def draw(body: RaffleDrawRequest, db: DbDep) -> RaffleDrawOut:
    try:
        result = await raffle_service.draw(db, body)
        await db.commit()
        return _draw_out(result)
    except PermissionError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc


@router.post("/next", response_model=RaffleNextOut)
async def next_turn(body: RaffleNextRequest, db: DbDep) -> RaffleNextOut:
    try:
        _session, event, token = await raffle_service.next_session(db, body.session_token)
        await db.commit()
        return RaffleNextOut(session_token=token, event=_event_out(event))
    except PermissionError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc


@router.get(
    "",
    response_model=list[RaffleAdminOut],
    dependencies=[Depends(require_permission("admin:all"))],
)
async def admin_list(db: DbDep, _user: AdminUser) -> list[RaffleAdminOut]:
    events = await raffle_service.list_events(db)
    return [
        RaffleAdminOut(
            **_event_out(event).model_dump(),
            recent_draws=[
                _draw_out(draw) for draw in await raffle_service.recent_draws(db, event.id)
            ],
        )
        for event in events
    ]


@router.post(
    "",
    response_model=RaffleAdminOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("admin:all"))],
)
async def admin_create(body: RaffleActivate, db: DbDep, user: AdminUser) -> RaffleAdminOut:
    try:
        event = await raffle_service.create_event(db, body, user)
        await db.commit()
        return RaffleAdminOut(**_event_out(event).model_dump(), recent_draws=[])
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, f"建立活動失敗：{exc}") from exc


@router.patch(
    "/{event_id}",
    response_model=RaffleAdminOut,
    dependencies=[Depends(require_permission("admin:all"))],
)
async def admin_update(
    event_id: uuid.UUID, body: RaffleStatusUpdate, db: DbDep, _user: AdminUser
) -> RaffleAdminOut:
    try:
        event = await raffle_service.update_event(
            db,
            event_id,
            RaffleStatus(body.status) if body.status else None,
            body.reserve_released,
            body.prizes,
        )
        await db.commit()
        event = await raffle_service.get_event(db, event.id)
        return RaffleAdminOut(
            **_event_out(event).model_dump(),
            recent_draws=[
                _draw_out(draw) for draw in await raffle_service.recent_draws(db, event.id)
            ],
        )
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


@router.post(
    "/{event_id}/reset",
    response_model=RaffleAdminOut,
    dependencies=[Depends(require_permission("admin:all"))],
)
async def admin_reset(event_id: uuid.UUID, db: DbDep, _user: AdminUser) -> RaffleAdminOut:
    try:
        event = await raffle_service.reset_event(db, event_id)
        await db.commit()
        event = await raffle_service.get_event(db, event.id)
        return RaffleAdminOut(
            **_event_out(event).model_dump(),
            recent_draws=[],
        )
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


__all__ = ["router"]
