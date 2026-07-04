"""Matter integration service tests."""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.activity import Activity, ActivityStatus
from api.models.governance import EntityRelation, MatterResource, MatterResourceType
from api.models.user import User
from api.schemas.governance import MatterCreate, MatterResourceCreate
from api.services import activity_workspace
from api.services import matter as matter_svc


@pytest.mark.asyncio
async def test_create_matter_resource_records_external_collaboration_link(
    db_session: AsyncSession,
) -> None:
    user = User(email="matter-owner@example.edu", display_name="Matter Owner", is_active=True)
    db_session.add(user)
    await db_session.flush()
    matter = await matter_svc.create_matter(
        db_session,
        data=MatterCreate(title="整合測試事項"),
        user=user,
    )

    resource = await matter_svc.create_resource(
        db_session,
        matter=matter,
        data=MatterResourceCreate(
            resource_type=MatterResourceType.GOOGLE_MEET,
            title="籌備會議",
            url="https://meet.google.com/abc-defg-hij",
            provider="google",
        ),
        user=user,
    )

    stored = await db_session.get(MatterResource, resource.id)
    assert stored is not None
    assert stored.matter_id == matter.id
    assert stored.resource_type == MatterResourceType.GOOGLE_MEET
    assert stored.provider == "google"


@pytest.mark.asyncio
async def test_activity_workspace_creates_matter_and_source_relation(
    db_session: AsyncSession,
) -> None:
    activity = Activity(name="園遊會", status=ActivityStatus.ACTIVE)
    db_session.add(activity)
    await db_session.flush()
    await db_session.refresh(activity, ["conveners"])

    workspace = await activity_workspace.workspace(db_session, activity)

    assert workspace["matter_id"] is not None
    relation = await db_session.scalar(
        select(EntityRelation).where(
            EntityRelation.matter_id == workspace["matter_id"],
            EntityRelation.target_type == "activity",
            EntityRelation.target_id == activity.id,
            EntityRelation.relation == "source",
        )
    )
    assert relation is not None
