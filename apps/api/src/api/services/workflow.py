"""跨模組案件工作流 service。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.council_proposal import CouncilProposal, CouncilProposalStatus
from api.models.governance import (
    EntityRelation,
    GovernanceEventType,
    Matter,
    MatterResource,
    MatterResourceType,
    MatterType,
)
from api.models.judicial_petition import JudicialPetition, JudicialPetitionStatus
from api.models.publication import PublicationCampaign, PublicationStatus
from api.models.workflow import (
    WorkflowEvent,
    WorkflowEventType,
    WorkflowInstance,
    WorkflowLink,
)
from api.schemas.workflow import WorkflowLinkCreate
from api.services.governance._events import record_event as record_matter_event

_COMPLETED_STATUSES = {"passed", "rejected", "withdrawn", "decided", "dismissed", "published"}


def _step_for(workflow_type: str, status: str) -> str:
    steps = {
        "judicial_petition": {
            "submitted": "送件",
            "docketing_review": "收案審查",
            "accepted": "受理",
            "in_review": "審議中",
            "decided": "作成決定",
            "dismissed": "不受理/駁回",
            "withdrawn": "撤回",
            "published": "公布",
        },
        "council_proposal": {
            "submitted": "送案",
            "committee_review": "常委審查",
            "scheduled": "排入大會",
            "council_review": "大會審議",
            "passed": "通過",
            "rejected": "否決",
            "withdrawn": "撤回",
            "published": "公布/歸檔",
        },
    }
    return steps.get(workflow_type, {}).get(status, status)


async def get_instance(db: AsyncSession, instance_id: uuid.UUID) -> WorkflowInstance | None:
    result = await db.execute(
        select(WorkflowInstance)
        .options(selectinload(WorkflowInstance.links))
        .where(WorkflowInstance.id == instance_id)
    )
    return result.scalar_one_or_none()


async def get_instance_by_source(
    db: AsyncSession, source_type: str, source_id: uuid.UUID
) -> WorkflowInstance | None:
    result = await db.execute(
        select(WorkflowInstance)
        .options(selectinload(WorkflowInstance.links))
        .where(WorkflowInstance.source_type == source_type, WorkflowInstance.source_id == source_id)
    )
    return result.scalar_one_or_none()


async def list_instances(
    db: AsyncSession,
    *,
    workflow_type: str | None = None,
    status: str | None = None,
    activity_id: uuid.UUID | None = None,
    limit: int = 80,
    offset: int = 0,
) -> list[WorkflowInstance]:
    stmt = (
        select(WorkflowInstance)
        .options(selectinload(WorkflowInstance.links))
        .where(WorkflowInstance.is_active.is_(True))
        .order_by(WorkflowInstance.updated_at.desc(), WorkflowInstance.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if workflow_type:
        stmt = stmt.where(WorkflowInstance.workflow_type == workflow_type)
    if status:
        stmt = stmt.where(WorkflowInstance.status == status)
    if activity_id:
        stmt = stmt.where(WorkflowInstance.activity_id == activity_id)
    return list((await db.execute(stmt)).scalars().all())


async def ensure_instance(
    db: AsyncSession,
    *,
    workflow_type: str,
    source_type: str,
    source_id: uuid.UUID,
    title: str,
    status: str,
    created_by_id: uuid.UUID | None = None,
    org_id: uuid.UUID | None = None,
    activity_id: uuid.UUID | None = None,
    meta: dict | None = None,
    actor_email: str | None = None,
) -> WorkflowInstance:
    existing = await get_instance_by_source(db, source_type, source_id)
    if existing is not None:
        existing.title = title
        existing.status = status
        existing.current_step = _step_for(workflow_type, status)
        existing.org_id = org_id
        existing.activity_id = activity_id
        existing.meta = meta or existing.meta or {}
        await db.flush()
        await _ensure_matter_for_instance(
            db,
            existing,
            actor_id=created_by_id,
            actor_email=actor_email,
        )
        return existing

    instance = WorkflowInstance(
        workflow_type=workflow_type,
        source_type=source_type,
        source_id=source_id,
        title=title,
        status=status,
        current_step=_step_for(workflow_type, status),
        org_id=org_id,
        activity_id=activity_id,
        created_by_id=created_by_id,
        meta=meta or {},
    )
    db.add(instance)
    await db.flush()
    await record_event(
        db,
        instance,
        event_type=WorkflowEventType.CREATED,
        to_status=status,
        actor_id=created_by_id,
        actor_email=actor_email,
        payload={"source_type": source_type, "source_id": str(source_id)},
    )
    await _ensure_matter_for_instance(
        db,
        instance,
        actor_id=created_by_id,
        actor_email=actor_email,
    )
    return instance


async def record_event(
    db: AsyncSession,
    instance: WorkflowInstance,
    *,
    event_type: str,
    from_status: str | None = None,
    to_status: str | None = None,
    actor_id: uuid.UUID | None = None,
    actor_email: str | None = None,
    note: str | None = None,
    payload: dict | None = None,
) -> WorkflowEvent:
    event = WorkflowEvent(
        instance_id=instance.id,
        event_type=str(event_type),
        from_status=from_status,
        to_status=to_status,
        actor_id=actor_id,
        actor_email=actor_email,
        note=note,
        payload=payload or {},
        created_at=datetime.now(UTC),
    )
    db.add(event)
    await db.flush()
    return event


async def transition_instance(
    db: AsyncSession,
    instance: WorkflowInstance,
    *,
    status: str,
    actor_id: uuid.UUID | None = None,
    actor_email: str | None = None,
    note: str | None = None,
    payload: dict | None = None,
) -> WorkflowInstance:
    previous = instance.status
    instance.status = status
    instance.current_step = _step_for(instance.workflow_type, status)
    if status in _COMPLETED_STATUSES:
        instance.completed_at = instance.completed_at or datetime.now(UTC)
    else:
        instance.completed_at = None
    await _sync_source_status(db, instance, status, payload or {}, note)
    if status == "published":
        await _ensure_publication_campaign(db, instance, actor_id=actor_id)
    await record_event(
        db,
        instance,
        event_type=WorkflowEventType.TRANSITION,
        from_status=previous,
        to_status=status,
        actor_id=actor_id,
        actor_email=actor_email,
        note=note,
        payload=payload,
    )
    await db.flush()
    return instance


async def transition_by_source(
    db: AsyncSession,
    *,
    source_type: str,
    source_id: uuid.UUID,
    status: str,
    title: str,
    actor_id: uuid.UUID | None = None,
    actor_email: str | None = None,
    note: str | None = None,
    payload: dict | None = None,
) -> WorkflowInstance:
    instance = await get_instance_by_source(db, source_type, source_id)
    if instance is None:
        instance = await ensure_instance(
            db,
            workflow_type=source_type,
            source_type=source_type,
            source_id=source_id,
            title=title,
            status=status,
            created_by_id=actor_id,
            actor_email=actor_email,
        )
    return await transition_instance(
        db,
        instance,
        status=status,
        actor_id=actor_id,
        actor_email=actor_email,
        note=note,
        payload=payload,
    )


async def add_link(
    db: AsyncSession,
    instance: WorkflowInstance,
    *,
    data: WorkflowLinkCreate,
    created_by_id: uuid.UUID | None = None,
) -> WorkflowLink:
    existing = None
    if data.target_id is not None:
        existing = await db.scalar(
            select(WorkflowLink).where(
                WorkflowLink.instance_id == instance.id,
                WorkflowLink.target_type == data.target_type,
                WorkflowLink.target_id == data.target_id,
                WorkflowLink.relation == data.relation,
            )
        )
    if existing is not None:
        existing.title = data.title
        existing.href = data.href
        existing.note = data.note
        existing.meta = data.meta
        await db.flush()
        return existing
    link = WorkflowLink(instance_id=instance.id, created_by_id=created_by_id, **data.model_dump())
    db.add(link)
    await db.flush()
    await record_event(
        db,
        instance,
        event_type=WorkflowEventType.LINKED,
        actor_id=created_by_id,
        payload={
            "target_type": link.target_type,
            "target_id": str(link.target_id) if link.target_id else None,
            "relation": link.relation,
            "title": link.title,
        },
    )
    matter = await _ensure_matter_for_instance(
        db,
        instance,
        actor_id=created_by_id,
    )
    await _sync_workflow_link_to_matter(db, matter=matter, link=link, actor_id=created_by_id)
    return link


async def _ensure_matter_for_instance(
    db: AsyncSession,
    instance: WorkflowInstance,
    *,
    actor_id: uuid.UUID | None = None,
    actor_email: str | None = None,
) -> Matter:
    existing = await db.scalar(
        select(Matter)
        .join(EntityRelation, EntityRelation.matter_id == Matter.id)
        .where(
            EntityRelation.target_type == "workflow_instance",
            EntityRelation.target_id == instance.id,
            EntityRelation.relation == "source",
            Matter.is_active.is_(True),
        )
    )
    if existing is not None:
        existing.title = instance.title
        existing.status = "completed" if instance.completed_at else "active"
        existing.org_id = instance.org_id
        await db.flush()
        return existing
    matter = Matter(
        title=instance.title,
        matter_type=_matter_type_for_workflow(instance),
        description=instance.meta.get("summary") if isinstance(instance.meta, dict) else None,
        org_id=instance.org_id,
        status="completed" if instance.completed_at else "active",
        created_by_id=actor_id or instance.created_by_id,
        meta={
            "source_type": "workflow_instance",
            "source_id": str(instance.id),
            "workflow_type": instance.workflow_type,
            "workflow_source_type": instance.source_type,
            "workflow_source_id": str(instance.source_id),
        },
    )
    db.add(matter)
    await db.flush()
    db.add(
        EntityRelation(
            matter_id=matter.id,
            source_type="matter",
            source_id=matter.id,
            target_type="workflow_instance",
            target_id=instance.id,
            relation="source",
            title=instance.title,
            href=f"/workflows/instances/{instance.id}",
            created_by_id=actor_id,
            meta={"synced_from": "workflow"},
        )
    )
    db.add(
        EntityRelation(
            matter_id=matter.id,
            source_type="workflow_instance",
            source_id=instance.id,
            target_type=instance.source_type,
            target_id=instance.source_id,
            relation="source_object",
            title=instance.title,
            href=_href_for_source(instance.source_type, instance.source_id),
            created_by_id=actor_id,
            meta={"synced_from": "workflow"},
        )
    )
    await record_matter_event(
        db,
        matter_id=matter.id,
        event_type=GovernanceEventType.CREATED,
        title=f"建立工作流事項：{instance.title}",
        actor_id=actor_id,
        actor_email=actor_email,
        payload={"workflow_instance_id": str(instance.id)},
    )
    await db.flush()
    return matter


def _matter_type_for_workflow(instance: WorkflowInstance) -> str:
    if instance.source_type == "activity":
        return MatterType.ACTIVITY
    if instance.source_type == "meeting":
        return MatterType.MEETING
    if instance.source_type == "judicial_petition":
        return MatterType.PETITION
    if instance.source_type == "council_proposal":
        return MatterType.POLICY
    return MatterType.ADMINISTRATION


def _href_for_source(source_type: str, source_id: uuid.UUID) -> str | None:
    hrefs = {
        "activity": f"/activities/{source_id}",
        "meeting": f"/meetings/{source_id}",
        "judicial_petition": f"/judicial-petitions/{source_id}",
        "council_proposal": f"/council-proposals/{source_id}",
    }
    return hrefs.get(source_type)


async def _sync_workflow_link_to_matter(
    db: AsyncSession,
    *,
    matter: Matter,
    link: WorkflowLink,
    actor_id: uuid.UUID | None,
) -> None:
    if _is_external_resource(link):
        await _sync_workflow_resource(db, matter=matter, link=link, actor_id=actor_id)
        return
    if link.target_id is None:
        return
    existing = await db.scalar(
        select(EntityRelation).where(
            EntityRelation.matter_id == matter.id,
            EntityRelation.target_type == link.target_type,
            EntityRelation.target_id == link.target_id,
            EntityRelation.relation == link.relation,
        )
    )
    if existing is not None:
        return
    db.add(
        EntityRelation(
            matter_id=matter.id,
            source_type="workflow_instance",
            source_id=link.instance_id,
            target_type=link.target_type,
            target_id=link.target_id,
            relation=link.relation,
            title=link.title,
            href=link.href,
            note=link.note,
            meta={**(link.meta or {}), "workflow_link_id": str(link.id)},
            created_by_id=actor_id,
        )
    )
    await record_matter_event(
        db,
        matter_id=matter.id,
        event_type=GovernanceEventType.LINKED,
        title=f"新增工作流關聯：{link.title}",
        actor_id=actor_id,
        payload={"workflow_link_id": str(link.id), "target_type": link.target_type},
    )


def _is_external_resource(link: WorkflowLink) -> bool:
    if not link.href:
        return False
    resource_types = {
        "external",
        "external_url",
        "google_meet",
        "google_drive",
        "discord_text",
        "discord_voice",
        "drive",
        "meet",
        "url",
    }
    return link.target_id is None or link.target_type in resource_types


async def _sync_workflow_resource(
    db: AsyncSession,
    *,
    matter: Matter,
    link: WorkflowLink,
    actor_id: uuid.UUID | None,
) -> None:
    if not link.href:
        return
    existing = await db.scalar(
        select(MatterResource).where(
            MatterResource.matter_id == matter.id,
            MatterResource.url == link.href,
            MatterResource.is_active.is_(True),
        )
    )
    if existing is not None:
        return
    resource = MatterResource(
        matter_id=matter.id,
        resource_type=_resource_type_for_link(link),
        title=link.title,
        url=link.href,
        provider=_provider_for_link(link),
        description=link.note,
        meta={**(link.meta or {}), "workflow_link_id": str(link.id)},
        created_by_id=actor_id,
    )
    db.add(resource)
    await record_matter_event(
        db,
        matter_id=matter.id,
        event_type=GovernanceEventType.LINKED,
        title=f"新增工作流資源：{link.title}",
        actor_id=actor_id,
        payload={"workflow_link_id": str(link.id), "resource_type": resource.resource_type},
    )


def _resource_type_for_link(link: WorkflowLink) -> str:
    if link.target_type in {"google_meet", "meet"}:
        return MatterResourceType.GOOGLE_MEET
    if link.target_type in {"google_drive", "drive"}:
        return MatterResourceType.GOOGLE_DRIVE
    if link.target_type == "discord_voice":
        return MatterResourceType.DISCORD_VOICE
    if link.target_type == "discord_text":
        return MatterResourceType.DISCORD_TEXT
    return MatterResourceType.EXTERNAL_URL


def _provider_for_link(link: WorkflowLink) -> str | None:
    if link.target_type.startswith("google") or link.target_type in {"meet", "drive"}:
        return "google"
    if link.target_type.startswith("discord"):
        return "discord"
    return None


async def timeline(
    db: AsyncSession, instance: WorkflowInstance
) -> tuple[list[WorkflowEvent], list[WorkflowLink]]:
    events = list(
        (
            await db.execute(
                select(WorkflowEvent)
                .where(WorkflowEvent.instance_id == instance.id)
                .order_by(WorkflowEvent.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    links = list(
        (
            await db.execute(
                select(WorkflowLink)
                .where(WorkflowLink.instance_id == instance.id)
                .order_by(WorkflowLink.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    return events, links


async def _sync_source_status(
    db: AsyncSession, instance: WorkflowInstance, status: str, payload: dict, note: str | None
) -> None:
    now = datetime.now(UTC)
    if instance.source_type == "judicial_petition":
        petition = await db.get(JudicialPetition, instance.source_id)
        if petition is None:
            return
        petition.status = status
        if note:
            petition.docketing_note = note
        decision_summary = payload.get("decision_summary")
        if isinstance(decision_summary, str):
            petition.decision_summary = decision_summary
        if status in {
            JudicialPetitionStatus.DECIDED,
            JudicialPetitionStatus.DISMISSED,
            "published",
        }:
            petition.decided_at = petition.decided_at or now
    elif instance.source_type == "council_proposal":
        proposal = await db.get(CouncilProposal, instance.source_id)
        if proposal is None:
            return
        proposal.status = status
        if note:
            proposal.committee_review_note = note
        meeting_id = payload.get("scheduled_meeting_id")
        if meeting_id:
            proposal.scheduled_meeting_id = uuid.UUID(str(meeting_id))
        if status == CouncilProposalStatus.SCHEDULED:
            proposal.scheduled_at = proposal.scheduled_at or now
        if status in {CouncilProposalStatus.PASSED, CouncilProposalStatus.REJECTED, "published"}:
            proposal.decided_at = proposal.decided_at or now


async def _ensure_publication_campaign(
    db: AsyncSession, instance: WorkflowInstance, *, actor_id: uuid.UUID | None
) -> PublicationCampaign:
    existing = await db.scalar(
        select(PublicationCampaign).where(
            PublicationCampaign.source_type == instance.source_type,
            PublicationCampaign.source_id == instance.source_id,
        )
    )
    if existing is not None:
        return existing
    campaign = PublicationCampaign(
        title=f"公布：{instance.title}",
        body=instance.meta.get("summary") or instance.title,
        source_type=instance.source_type,
        source_id=instance.source_id,
        activity_id=instance.activity_id,
        org_id=instance.org_id,
        audience_type="all",
        audience_filter={},
        channels=["announcement"],
        status=PublicationStatus.DRAFT,
        created_by_id=actor_id or instance.created_by_id,
    )
    db.add(campaign)
    await db.flush()
    await add_link(
        db,
        instance,
        data=WorkflowLinkCreate(
            target_type="publication",
            target_id=campaign.id,
            relation="publication",
            title=campaign.title,
            href=f"/announcements/new?publication={campaign.id}",
        ),
        created_by_id=actor_id,
    )
    return campaign
