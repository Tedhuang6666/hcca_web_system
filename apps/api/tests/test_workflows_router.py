"""跨模組工作流路由測試（apps/api/src/api/routers/workflows.py）。"""

from __future__ import annotations

import uuid
from collections.abc import Callable

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.user import User
from api.models.workflow import WorkflowInstance


async def _make_instance(db_session: AsyncSession, **overrides) -> WorkflowInstance:
    defaults = dict(
        workflow_type="council_proposal",
        source_type="council_proposal",
        source_id=uuid.uuid4(),
        title="測試議案工作流",
        status="submitted",
    )
    defaults.update(overrides)
    instance = WorkflowInstance(**defaults)
    db_session.add(instance)
    await db_session.flush()
    return instance


async def test_list_instances_requires_login(client: AsyncClient) -> None:
    response = await client.get("/workflows/instances")
    assert response.status_code == 401


async def test_list_instances_requires_permission(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.get("/workflows/instances")
    assert response.status_code == 403


async def test_list_instances_returns_created_instance(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    instance = await _make_instance(db_session)
    ac = authed_client_factory(admin_user)
    response = await ac.get("/workflows/instances")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(instance.id) in ids


async def test_list_instances_filters_by_workflow_type(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    council = await _make_instance(db_session, workflow_type="council_proposal")
    petition = await _make_instance(
        db_session,
        workflow_type="judicial_petition",
        source_type="judicial_petition",
        title="測試訴願工作流",
    )
    ac = authed_client_factory(admin_user)
    response = await ac.get("/workflows/instances", params={"workflow_type": "judicial_petition"})
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert str(petition.id) in ids
    assert str(council.id) not in ids


@pytest.mark.parametrize(
    ("code", "allowed_type", "blocked_type"),
    [
        ("council_proposal:manage", "council_proposal", "judicial_petition"),
        ("judicial_petition:manage", "judicial_petition", "council_proposal"),
    ],
)
async def test_workflow_reads_require_matching_source_permission(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
    code: str,
    allowed_type: str,
    blocked_type: str,
) -> None:
    await _grant(db_session, member_user, code)
    allowed = await _make_instance(db_session, workflow_type=allowed_type, source_type=allowed_type)
    blocked = await _make_instance(db_session, workflow_type=blocked_type, source_type=blocked_type)
    ac = authed_client_factory(member_user)

    listing = await ac.get("/workflows/instances")
    blocked_filter = await ac.get("/workflows/instances", params={"workflow_type": blocked_type})
    blocked_detail = await ac.get(f"/workflows/instances/{blocked.id}")
    blocked_timeline = await ac.get(f"/workflows/instances/{blocked.id}/timeline")
    allowed_detail = await ac.get(f"/workflows/instances/{allowed.id}")

    assert listing.status_code == 200
    assert {row["id"] for row in listing.json()} == {str(allowed.id)}
    assert blocked_filter.status_code == 200
    assert blocked_filter.json() == []
    assert blocked_detail.status_code == 403
    assert blocked_timeline.status_code == 403
    assert allowed_detail.status_code == 200


async def test_get_instance_404_when_missing(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.get(f"/workflows/instances/{uuid.uuid4()}")
    assert response.status_code == 404


async def test_get_instance_returns_detail(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    instance = await _make_instance(db_session)
    ac = authed_client_factory(admin_user)
    response = await ac.get(f"/workflows/instances/{instance.id}")
    assert response.status_code == 200
    assert response.json()["title"] == "測試議案工作流"


async def test_transition_instance_updates_status(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    instance = await _make_instance(db_session)
    ac = authed_client_factory(admin_user)
    response = await ac.post(
        f"/workflows/instances/{instance.id}/transition",
        json={"status": "committee_review", "note": "轉入常委審查"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "committee_review"


async def test_transition_instance_requires_permission(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    instance = await _make_instance(db_session)
    ac = authed_client_factory(member_user)
    response = await ac.post(
        f"/workflows/instances/{instance.id}/transition",
        json={"status": "committee_review"},
    )
    assert response.status_code == 403


async def test_get_timeline_includes_transition_event(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    instance = await _make_instance(db_session)
    ac = authed_client_factory(admin_user)
    await ac.post(
        f"/workflows/instances/{instance.id}/transition",
        json={"status": "committee_review"},
    )
    response = await ac.get(f"/workflows/instances/{instance.id}/timeline")
    assert response.status_code == 200
    body = response.json()
    assert body["instance"]["status"] == "committee_review"
    assert len(body["events"]) >= 1


async def test_create_link_returns_link_and_appears_in_instance(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    instance = await _make_instance(db_session)
    ac = authed_client_factory(admin_user)
    response = await ac.post(
        f"/workflows/instances/{instance.id}/links",
        json={
            "target_type": "document",
            "relation": "related",
            "title": "相關公文",
            "href": "/documents/abc",
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["instance_id"] == str(instance.id)
    assert body["title"] == "相關公文"

    timeline = await ac.get(f"/workflows/instances/{instance.id}/timeline")
    link_titles = {link["title"] for link in timeline.json()["links"]}
    assert "相關公文" in link_titles


async def test_create_link_404_when_instance_missing(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.post(
        f"/workflows/instances/{uuid.uuid4()}/links",
        json={"target_type": "document", "title": "相關公文"},
    )
    assert response.status_code == 404


async def _grant(db_session: AsyncSession, user: User, code: str) -> None:
    from datetime import timedelta

    from api.core.clock import local_today
    from api.models.org import Org, Permission, Position, UserPosition

    org = Org(name=f"wf-org-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="管理人")
    db_session.add(position)
    await db_session.flush()
    db_session.add(Permission(position_id=position.id, code=code))
    db_session.add(
        UserPosition(
            user_id=user.id,
            position_id=position.id,
            start_date=local_today() - timedelta(days=1),
        )
    )
    await db_session.flush()


async def test_council_manager_cannot_transition_judicial_workflow(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    await _grant(db_session, member_user, "council_proposal:manage")
    judicial = await _make_instance(
        db_session, workflow_type="judicial_petition", source_type="judicial_petition"
    )
    ac = authed_client_factory(member_user)

    transition = await ac.post(
        f"/workflows/instances/{judicial.id}/transition",
        json={"status": "decided", "payload": {"decision_summary": "越權決定"}},
    )
    link = await ac.post(
        f"/workflows/instances/{judicial.id}/links",
        json={"target_type": "document", "target_id": str(uuid.uuid4()), "title": "越權連結"},
    )

    assert transition.status_code == 403
    assert link.status_code == 403
    await db_session.refresh(judicial)
    assert judicial.status == "submitted"


async def test_transition_rejects_unknown_status(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    await _grant(db_session, member_user, "council_proposal:manage")
    council = await _make_instance(db_session)
    ac = authed_client_factory(member_user)

    response = await ac.post(
        f"/workflows/instances/{council.id}/transition", json={"status": "xyz"}
    )

    assert response.status_code == 422
    await db_session.refresh(council)
    assert council.status == "submitted"


async def test_council_manager_can_transition_council_workflow(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    await _grant(db_session, member_user, "council_proposal:manage")
    council = await _make_instance(db_session)
    ac = authed_client_factory(member_user)

    response = await ac.post(
        f"/workflows/instances/{council.id}/transition", json={"status": "committee_review"}
    )

    assert response.status_code == 200
    assert response.json()["status"] == "committee_review"
