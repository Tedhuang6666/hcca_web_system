"""即時開票紀錄系統 HTTP API。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.core.ws_manager import manager
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.models.election import BallotBox, Election
from api.models.user import User
from api.schemas.election import (
    BallotBoxOut,
    BallotBoxStatusUpdate,
    ElectionCreate,
    ElectionListItem,
    ElectionLiveSummary,
    ElectionOut,
    ElectionStatusUpdate,
    ElectionUpdate,
    VoteEventCreate,
    VoteEventOut,
)
from api.services import election as election_svc

router = APIRouter(prefix="/elections", tags=["即時開票"])
DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
ManageElection = Depends(require_permission(PermissionCode.ELECTION_MANAGE))


async def _election_or_404(session: AsyncSession, election_id: uuid.UUID) -> Election:
    election = await election_svc.get_election(session, election_id)
    if election is None:
        raise HTTPException(status_code=404, detail="找不到此選舉")
    return election


async def _broadcast_summary(session: AsyncSession, election_id: uuid.UUID) -> None:
    summary = await election_svc.get_live_summary(session, election_id)
    if summary is None:
        return
    await manager.broadcast_to_room(
        f"election:{election_id}",
        manager.build_message(
            "election_update",
            summary.model_dump(mode="json"),
            room=f"election:{election_id}",
        ),
    )


@router.get("", response_model=list[ElectionListItem], dependencies=[ManageElection])
async def list_elections(session: DbDep) -> list[Election]:
    return await election_svc.list_elections(session)


@router.get("/public", response_model=list[ElectionListItem])
async def list_public_elections(session: DbDep) -> list[Election]:
    return await election_svc.list_public_elections(session)


@router.post(
    "",
    response_model=ElectionOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[ManageElection],
)
async def create_election(payload: ElectionCreate, session: DbDep, user: CurrentUser) -> Election:
    return await election_svc.create_election(session, payload, user.id)


@router.get("/{election_id}", response_model=ElectionOut, dependencies=[ManageElection])
async def get_election(election_id: uuid.UUID, session: DbDep) -> Election:
    return await _election_or_404(session, election_id)


@router.patch("/{election_id}", response_model=ElectionOut, dependencies=[ManageElection])
async def update_election(
    election_id: uuid.UUID, payload: ElectionUpdate, session: DbDep
) -> Election:
    election = await _election_or_404(session, election_id)
    try:
        return await election_svc.update_election(session, election, payload)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{election_id}/status", response_model=ElectionOut, dependencies=[ManageElection])
async def set_election_status(
    election_id: uuid.UUID, payload: ElectionStatusUpdate, session: DbDep
) -> Election:
    try:
        election = await election_svc.set_election_status(session, election_id, payload.status)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await _broadcast_summary(session, election_id)
    return election


@router.post(
    "/{election_id}/ballot-boxes/{ballot_box_id}/status",
    response_model=BallotBoxOut,
    dependencies=[ManageElection],
)
async def set_ballot_box_status(
    election_id: uuid.UUID,
    ballot_box_id: uuid.UUID,
    payload: BallotBoxStatusUpdate,
    session: DbDep,
) -> BallotBox:
    try:
        box = await election_svc.set_ballot_box_status(
            session, election_id, ballot_box_id, payload.status
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await _broadcast_summary(session, election_id)
    return box


@router.post(
    "/{election_id}/events",
    response_model=VoteEventOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[ManageElection],
)
async def add_vote_event(
    election_id: uuid.UUID,
    payload: VoteEventCreate,
    session: DbDep,
    user: CurrentUser,
) -> VoteEventOut:
    try:
        event = await election_svc.add_vote_event(session, election_id, payload, user.id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await _broadcast_summary(session, election_id)
    event_out = await election_svc.get_vote_event_out(session, election_id, event.id)
    assert event_out is not None
    return event_out


@router.post(
    "/{election_id}/events/{event_id}/reverse",
    response_model=VoteEventOut,
    dependencies=[ManageElection],
)
async def reverse_vote_event(
    election_id: uuid.UUID, event_id: uuid.UUID, session: DbDep, user: CurrentUser
) -> VoteEventOut:
    try:
        event = await election_svc.reverse_vote_event(session, election_id, event_id, user.id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await _broadcast_summary(session, election_id)
    event_out = await election_svc.get_vote_event_out(session, election_id, event.id)
    assert event_out is not None
    return event_out


@router.get(
    "/{election_id}/events",
    response_model=list[VoteEventOut],
    dependencies=[ManageElection],
)
async def list_vote_events(
    election_id: uuid.UUID, session: DbDep, limit: int = Query(100, ge=1, le=500)
) -> list[VoteEventOut]:
    await _election_or_404(session, election_id)
    return await election_svc.list_vote_events(session, election_id, limit)


@router.get("/public/{election_id}/live", response_model=ElectionLiveSummary)
async def get_public_live_summary(election_id: uuid.UUID, session: DbDep) -> ElectionLiveSummary:
    election = await _election_or_404(session, election_id)
    if not election.is_public:
        raise HTTPException(status_code=404, detail="找不到此選舉")
    summary = await election_svc.get_live_summary(session, election_id)
    assert summary is not None
    return summary
