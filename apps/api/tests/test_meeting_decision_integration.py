from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from api.models.calendar import CalendarEvent
from api.models.document import Document, DocumentStatus
from api.models.governance import EntityRelation, Matter
from api.models.meeting import Meeting, MeetingAgendaItem, MeetingDecision, MeetingDecisionStatus
from api.models.org import Org
from api.models.user import User
from api.models.work_item import WorkItem
from api.schemas.governance import EntityRelationCreate
from api.services import coordination, governance_ingest
from api.services import governance as governance_svc


@pytest.mark.asyncio
async def test_meeting_decision_creates_task_calendar_projection_and_document(db_session) -> None:
    actor = User(
        email="chair@example.edu.tw",
        display_name="會議主席",
        is_active=True,
        is_verified=True,
    )
    org = Org(name="學生議會", prefix="議")
    db_session.add_all([actor, org])
    await db_session.flush()

    meeting = Meeting(
        org_id=org.id,
        title="第一次定期會",
        screen_token=uuid.uuid4().hex,
        checkin_token=uuid.uuid4().hex,
        created_by=actor.id,
    )
    db_session.add(meeting)
    await db_session.flush()
    agenda = MeetingAgendaItem(meeting_id=meeting.id, title="執行校園改善案")
    db_session.add(agenda)
    await db_session.flush()
    decision = MeetingDecision(
        meeting_id=meeting.id,
        agenda_item_id=agenda.id,
        title="通過校園改善案",
        content="由行政部於期限前完成公告與公文作業。",
        status=MeetingDecisionStatus.PASSED,
        created_by=actor.id,
    )
    matter = Matter(title="校園改善專案", created_by_id=actor.id)
    db_session.add_all([decision, matter])
    await db_session.flush()
    db_session.add(
        EntityRelation(
            matter_id=matter.id,
            source_type="matter",
            source_id=matter.id,
            target_type="meeting",
            target_id=meeting.id,
            relation="includes",
            title=meeting.title,
            created_by_id=actor.id,
        )
    )
    await db_session.flush()

    due_at = datetime.now(UTC) + timedelta(days=3)
    document_id = await governance_ingest.create_meeting_decision_outputs(
        db_session,
        meeting=meeting,
        decision=decision,
        actor=actor,
        create_follow_up=True,
        follow_up_assignee_id=actor.id,
        follow_up_due_at=due_at,
        create_document_draft=True,
    )

    task = await db_session.scalar(
        select(WorkItem).where(
            WorkItem.source_type == "meeting_decision",
            WorkItem.source_id == decision.id,
        )
    )
    assert task is not None
    assert task.assigned_to_id == actor.id
    assert task.due_at.replace(tzinfo=UTC) == due_at

    document = await db_session.get(Document, document_id)
    assert document is not None
    assert document.status == DocumentStatus.DRAFT
    assert document.serial_number.startswith("DRAFT-")
    assert await db_session.scalar(
        select(EntityRelation.id).where(
            EntityRelation.matter_id == matter.id,
            EntityRelation.target_type == "document",
            EntityRelation.target_id == document.id,
        )
    )

    await coordination.sync_calendar_projections(
        db_session,
        start=due_at - timedelta(minutes=1),
        end=due_at + timedelta(minutes=1),
    )
    calendar_event = await db_session.scalar(
        select(CalendarEvent).where(
            CalendarEvent.source_module == "work_item",
            CalendarEvent.source_id == task.id,
        )
    )
    assert calendar_event is not None
    assert calendar_event.starts_at.replace(tzinfo=UTC) == due_at


@pytest.mark.asyncio
async def test_any_entities_can_be_linked_and_traversed(db_session) -> None:
    actor = User(
        email="integrator@example.edu.tw",
        display_name="整合管理員",
        is_active=True,
        is_verified=True,
    )
    db_session.add(actor)
    await db_session.flush()
    document_id = uuid.uuid4()
    meeting_id = uuid.uuid4()
    survey_id = uuid.uuid4()

    first = await governance_svc.create_entity_relation(
        db_session,
        source_type="document",
        source_id=document_id,
        data=EntityRelationCreate(
            source_type="document",
            source_id=document_id,
            target_type="meeting",
            target_id=meeting_id,
            relation="scheduled_in",
            title="排入第一次定期會",
            href=f"/meetings/{meeting_id}",
        ),
        user=actor,
    )
    second = await governance_svc.create_entity_relation(
        db_session,
        source_type="meeting",
        source_id=meeting_id,
        data=EntityRelationCreate(
            source_type="meeting",
            source_id=meeting_id,
            target_type="survey",
            target_id=survey_id,
            relation="produces",
            title="會後意見調查",
            href=f"/surveys/{survey_id}",
        ),
        user=actor,
    )

    relations = await governance_svc.list_entity_relations(
        db_session,
        entity_type="meeting",
        entity_id=meeting_id,
    )
    assert {row.id for row in relations} == {first.id, second.id}

    nodes, edges = await governance_svc.entity_relation_graph(
        db_session,
        entity_type="document",
        entity_id=document_id,
        depth=2,
    )
    assert {node["type"] for node in nodes} == {"document", "meeting", "survey"}
    assert {edge.id for edge in edges} == {first.id, second.id}
