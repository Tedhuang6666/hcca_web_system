"""議會提案 Router。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user, get_optional_user
from api.dependencies.permissions import require_any
from api.models.council_proposal import (
    CouncilProposal,
    CouncilProposalCaseType,
    CouncilProposalStatus,
)
from api.models.user import User
from api.routers._common import or_404
from api.schemas.council_proposal import (
    CouncilProposalCreate,
    CouncilProposalListItem,
    CouncilProposalOut,
    CouncilProposalSchedule,
    CouncilProposalStatusUpdate,
    EligibleMeetingBrief,
)
from api.services import audit as audit_svc
from api.services import council_proposal as proposal_svc
from api.services.permission import get_user_permission_codes

router = APIRouter(prefix="/council-proposals", tags=["議會提案"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]


async def _proposal_or_404(session: AsyncSession, proposal_id: uuid.UUID) -> CouncilProposal:
    proposal = await proposal_svc.get(session, proposal_id)
    return or_404(proposal, "找不到此議會提案")


@router.post(
    "",
    response_model=CouncilProposalOut,
    status_code=status.HTTP_201_CREATED,
    summary="送出議會提案",
)
async def create_proposal(
    payload: CouncilProposalCreate,
    session: DbDep,
    current_user: OptionalUser,
) -> CouncilProposal:
    proposal = await proposal_svc.create(session, data=payload, submitter=current_user)
    await audit_svc.record(
        session,
        entity_type="council_proposal",
        entity_id=str(proposal.id),
        action="council_proposal.create",
        actor_id=str(current_user.id) if current_user else None,
        actor_email=current_user.email if current_user else None,
        meta={
            "serial_number": proposal.serial_number,
            "case_type": proposal.case_type,
            "kind": proposal.kind,
        },
        summary=f"建立議會提案 {proposal.serial_number}",
    )
    return proposal


@router.get("/my", response_model=list[CouncilProposalListItem], summary="列出我送出的議會提案")
async def list_my_proposals(
    session: DbDep,
    current_user: CurrentUser,
    status_filter: CouncilProposalStatus | None = Query(None, alias="status"),
    case_type: CouncilProposalCaseType | None = Query(None),
    limit: int = Query(80, ge=1, le=300),
    offset: int = Query(0, ge=0),
) -> list[CouncilProposal]:
    return await proposal_svc.list_items(
        session,
        submitter_id=current_user.id,
        status=status_filter,
        case_type=case_type,
        limit=limit,
        offset=offset,
    )


@router.get(
    "",
    response_model=list[CouncilProposalListItem],
    summary="管理端列出議會提案",
    dependencies=[
        Depends(
            require_any(
                PermissionCode.COUNCIL_PROPOSAL_MANAGE,
                PermissionCode.MEETING_MANAGE,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def list_proposals(
    session: DbDep,
    _: CurrentUser,
    status_filter: CouncilProposalStatus | None = Query(None, alias="status"),
    case_type: CouncilProposalCaseType | None = Query(None),
    limit: int = Query(80, ge=1, le=300),
    offset: int = Query(0, ge=0),
) -> list[CouncilProposal]:
    return await proposal_svc.list_items(
        session,
        status=status_filter,
        case_type=case_type,
        limit=limit,
        offset=offset,
    )


@router.get("/{proposal_id}", response_model=CouncilProposalOut, summary="取得議會提案詳情")
async def get_proposal(
    proposal_id: uuid.UUID, session: DbDep, user: CurrentUser
) -> CouncilProposal:
    proposal = await _proposal_or_404(session, proposal_id)
    if proposal.submitter_id == user.id or user.is_superuser:
        return proposal
    codes = await get_user_permission_codes(session, user.id)
    if codes & {
        str(PermissionCode.COUNCIL_PROPOSAL_MANAGE),
        str(PermissionCode.MEETING_MANAGE),
        str(PermissionCode.ADMIN_ALL),
    }:
        return proposal
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權查看此議會提案")


@router.get(
    "/{proposal_id}/eligible-meetings",
    response_model=list[EligibleMeetingBrief],
    summary="列出可排入此提案的會議（議程仍可編輯者）",
    dependencies=[
        Depends(
            require_any(
                PermissionCode.COUNCIL_PROPOSAL_MANAGE,
                PermissionCode.MEETING_MANAGE,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def list_eligible_meetings(
    proposal_id: uuid.UUID, session: DbDep, _: CurrentUser
) -> list[dict]:
    proposal = await _proposal_or_404(session, proposal_id)
    return await proposal_svc.list_eligible_meetings(session, proposal)


@router.post(
    "/{proposal_id}/schedule",
    response_model=CouncilProposalOut,
    summary="把提案排入大會議程（常委會審查通過後）",
    dependencies=[
        Depends(
            require_any(
                PermissionCode.COUNCIL_PROPOSAL_MANAGE,
                PermissionCode.MEETING_MANAGE,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def schedule_proposal(
    proposal_id: uuid.UUID,
    payload: CouncilProposalSchedule,
    session: DbDep,
    user: CurrentUser,
) -> CouncilProposal:
    proposal = await _proposal_or_404(session, proposal_id)
    try:
        proposal = await proposal_svc.schedule_into_meeting(
            session, proposal, meeting_id=payload.meeting_id, note=payload.note, actor=user
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    await audit_svc.record(
        session,
        entity_type="council_proposal",
        entity_id=str(proposal.id),
        action="council_proposal.schedule",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={"meeting_id": str(payload.meeting_id)},
        summary=f"議會提案 {proposal.serial_number} 排入會議議程",
    )
    return proposal


@router.patch(
    "/{proposal_id}/status",
    response_model=CouncilProposalOut,
    summary="更新議會提案審查狀態",
    dependencies=[
        Depends(
            require_any(
                PermissionCode.COUNCIL_PROPOSAL_MANAGE,
                PermissionCode.MEETING_MANAGE,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def update_proposal_status(
    proposal_id: uuid.UUID,
    payload: CouncilProposalStatusUpdate,
    session: DbDep,
    user: CurrentUser,
) -> CouncilProposal:
    proposal = await _proposal_or_404(session, proposal_id)
    proposal = await proposal_svc.update_status(session, proposal, data=payload, actor=user)
    await audit_svc.record(
        session,
        entity_type="council_proposal",
        entity_id=str(proposal.id),
        action="council_proposal.status",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=payload.model_dump(mode="json"),
        summary=f"更新議會提案 {proposal.serial_number} 狀態為 {proposal.status}",
    )
    return proposal
