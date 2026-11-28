"""自治機關專頁業務邏輯。"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.permission_codes import PermissionCode
from api.models.agency import AgencyBranch, AgencyEntry, AgencyProfile
from api.models.council_proposal import CouncilProposal, CouncilProposalStatus
from api.models.judicial_petition import JudicialPetition, JudicialPetitionStatus
from api.models.org import Org
from api.models.user import User
from api.schemas.agency import (
    BRANCH_ENTRY_KINDS,
    AgencyCalendarItem,
    AgencyEntryCreate,
    AgencyEntryOut,
    AgencyLinkedRecord,
    AgencyManageOut,
    AgencyProfileOut,
    AgencyPublicOut,
)
from api.services import site as site_svc
from api.services.org import get_org_descendant_ids
from api.services.permission import get_user_permission_codes, get_user_permission_codes_by_org

_LINKED_RECORD_LIMIT = 20


class EntryKindNotAllowed(ValueError):
    """公開項目類型不屬於該機關。"""


async def is_site_admin(db: AsyncSession, user: User) -> bool:
    if user.is_superuser:
        return True
    codes = await get_user_permission_codes(db, user.id)
    return bool(codes & {PermissionCode.SITE_MANAGE, PermissionCode.ADMIN_ALL})


async def list_manageable(db: AsyncSession, user: User) -> list[AgencyManageOut]:
    """網站管理員看到全部；其他人只看到自己組織內有 agency:manage 的機關。"""
    admin = await is_site_admin(db, user)
    stmt = (
        select(AgencyProfile, Org.name)
        .outerjoin(Org, Org.id == AgencyProfile.org_id)
        .order_by(AgencyProfile.sort_order, AgencyProfile.name)
    )
    if not admin:
        codes_by_org = await get_user_permission_codes_by_org(db, user.id)
        org_ids = [
            org_id
            for org_id, codes in codes_by_org.items()
            if PermissionCode.AGENCY_MANAGE in codes
        ]
        if not org_ids:
            return []
        stmt = stmt.where(AgencyProfile.org_id.in_(org_ids))
    rows = (await db.execute(stmt)).all()
    return [
        AgencyManageOut(
            **AgencyProfileOut.model_validate(agency).model_dump(),
            org_name=org_name,
            can_admin=admin,
        )
        for agency, org_name in rows
    ]


async def can_manage(db: AsyncSession, user: User, agency: AgencyProfile) -> bool:
    """物件範圍檢查：維護權限只在機關綁定的組織內有效。"""
    if await is_site_admin(db, user):
        return True
    if agency.org_id is None:
        return False
    codes_by_org = await get_user_permission_codes_by_org(db, user.id)
    return PermissionCode.AGENCY_MANAGE in codes_by_org.get(agency.org_id, frozenset())


async def create_entry(
    db: AsyncSession, agency: AgencyProfile, data: AgencyEntryCreate
) -> AgencyEntry:
    if data.kind not in BRANCH_ENTRY_KINDS[AgencyBranch(agency.branch)]:
        raise EntryKindNotAllowed(data.kind)
    entry = AgencyEntry(agency_id=agency.id, **data.model_dump())
    db.add(entry)
    await db.flush()
    return entry


async def list_entries(
    db: AsyncSession, agency_id: uuid.UUID, *, published_only: bool
) -> list[AgencyEntry]:
    stmt = (
        select(AgencyEntry)
        .where(AgencyEntry.agency_id == agency_id)
        .order_by(
            AgencyEntry.sort_order,
            AgencyEntry.occurred_on.desc().nulls_last(),
            AgencyEntry.created_at.desc(),
        )
    )
    if published_only:
        stmt = stmt.where(AgencyEntry.is_published.is_(True))
    return list((await db.scalars(stmt)).all())


async def list_published(db: AsyncSession) -> list[AgencyProfile]:
    stmt = (
        select(AgencyProfile)
        .where(AgencyProfile.is_published.is_(True))
        .order_by(AgencyProfile.sort_order, AgencyProfile.name)
    )
    return list((await db.scalars(stmt)).all())


# 已受理（經常委會審查）後即公開追蹤；未受理與撤回案不公開。
PUBLIC_PROPOSAL_STATUSES = (
    CouncilProposalStatus.COMMITTEE_REVIEW,
    CouncilProposalStatus.SCHEDULED,
    CouncilProposalStatus.COUNCIL_REVIEW,
    CouncilProposalStatus.PASSED,
    CouncilProposalStatus.REJECTED,
    CouncilProposalStatus.PUBLISHED,
)


async def _linked_records(db: AsyncSession, branch: AgencyBranch) -> list[AgencyLinkedRecord]:
    if branch == AgencyBranch.LEGISLATIVE:
        proposals = await db.scalars(
            select(CouncilProposal)
            .where(CouncilProposal.status.in_(PUBLIC_PROPOSAL_STATUSES))
            .order_by(CouncilProposal.created_at.desc())
            .limit(_LINKED_RECORD_LIMIT)
        )
        return [
            AgencyLinkedRecord(
                id=p.id,
                reference_no=p.serial_number,
                title=p.title,
                category=str(p.case_type),
                status=str(p.status),
                proposer_name=p.proposer_name,
                summary=p.summary,
                submitted_at=p.created_at,
                decided_at=p.decided_at,
            )
            for p in proposals
        ]
    if branch == AgencyBranch.JUDICIAL:
        # 評議結果只公開已公布者，且不帶聲請人姓名與聯絡資料。
        petitions = await db.scalars(
            select(JudicialPetition)
            .where(JudicialPetition.status == JudicialPetitionStatus.PUBLISHED)
            .order_by(JudicialPetition.decided_at.desc().nulls_last())
            .limit(_LINKED_RECORD_LIMIT)
        )
        return [
            AgencyLinkedRecord(
                id=p.id,
                reference_no=p.docket_number,
                title=p.title,
                category=str(p.petition_type),
                status=str(p.status),
                summary=p.decision_summary,
                submitted_at=p.created_at,
                decided_at=p.decided_at,
            )
            for p in petitions
        ]
    return []


async def get_public_proposal(db: AsyncSession, proposal_id: uuid.UUID) -> CouncilProposal | None:
    return await db.scalar(
        select(CouncilProposal).where(
            CouncilProposal.id == proposal_id,
            CouncilProposal.status.in_(PUBLIC_PROPOSAL_STATUSES),
        )
    )


async def list_calendar(db: AsyncSession, start: date, end: date) -> list[AgencyCalendarItem]:
    rows = await db.execute(
        select(AgencyEntry, AgencyProfile)
        .join(AgencyProfile, AgencyProfile.id == AgencyEntry.agency_id)
        .where(
            AgencyEntry.show_on_calendar.is_(True),
            AgencyEntry.is_published.is_(True),
            AgencyProfile.is_published.is_(True),
            AgencyEntry.occurred_on >= start,
            AgencyEntry.occurred_on <= end,
        )
        .order_by(AgencyEntry.occurred_on, AgencyProfile.sort_order, AgencyEntry.title)
    )
    return [
        AgencyCalendarItem(
            id=entry.id,
            date=entry.occurred_on,
            title=entry.title,
            kind=entry.kind,
            summary=entry.summary,
            link_url=entry.link_url,
            agency_slug=agency.slug,
            agency_name=agency.name,
            agency_branch=agency.branch,
        )
        for entry, agency in rows.all()
    ]


async def get_public(db: AsyncSession, slug: str) -> AgencyPublicOut | None:
    agency = await db.scalar(
        select(AgencyProfile).where(
            AgencyProfile.slug == slug, AgencyProfile.is_published.is_(True)
        )
    )
    if agency is None:
        return None
    members = []
    if agency.org_id is not None:
        org_ids = await get_org_descendant_ids(db, agency.org_id)
        members = await site_svc.list_officers(db, org_ids=org_ids)
    entries = await list_entries(db, agency.id, published_only=True)
    return AgencyPublicOut(
        agency=AgencyProfileOut.model_validate(agency),
        entries=[AgencyEntryOut.model_validate(entry) for entry in entries],
        members=members,
        linked_records=await _linked_records(db, AgencyBranch(agency.branch)),
    )
