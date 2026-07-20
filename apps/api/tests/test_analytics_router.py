"""數據分析路由測試（apps/api/src/api/routers/analytics.py）。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from api.models.analytics_page_view import AnalyticsPageView
from api.models.announcement import Announcement
from api.models.document import ApprovalStepStatus, Document, DocumentApproval, DocumentStatus
from api.models.org import Org
from api.models.survey import Survey, SurveyStatus
from api.models.user import User


async def _grant(db_session, user, code: str) -> None:
    from api.core.clock import local_today
    from api.models.org import Permission, Position, UserPosition

    org = Org(name=f"analytics-org-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="分析人員")
    db_session.add(position)
    await db_session.flush()
    db_session.add(Permission(position_id=position.id, code=code))
    db_session.add(
        UserPosition(
            user_id=user.id,
            position_id=position.id,
            start_date=local_today() - timedelta(days=1),
            end_date=None,
        )
    )
    await db_session.flush()


def _make_doc(org: Org, creator: User, **overrides: object) -> Document:
    defaults: dict = {
        "serial_number": f"DOC-2026-{uuid.uuid4().hex[:8]}",
        "title": "測試公文",
        "org_id": org.id,
        "created_by": creator.id,
        "status": DocumentStatus.APPROVED,
        "subject": "為分析統計測試，請 鑒核。",
    }
    defaults.update(overrides)
    return Document(**defaults)


# ---------------------------------------------------------------------------
# 權限檢查（每個端點都需要 analytics:view 或 admin:all）
# ---------------------------------------------------------------------------


async def test_document_efficiency_without_permission_returns_403(
    member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/analytics/documents/efficiency")
    assert resp.status_code == 403


async def test_dept_ranking_without_permission_returns_403(
    member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/analytics/documents/dept-ranking")
    assert resp.status_code == 403


async def test_pending_alerts_without_permission_returns_403(
    member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/analytics/documents/pending-alerts")
    assert resp.status_code == 403


async def test_insights_without_permission_returns_403(member_user, authed_client_factory) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/analytics/insights")
    assert resp.status_code == 403


async def test_announcement_participation_without_permission_returns_403(
    member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/analytics/announcements/participation")
    assert resp.status_code == 403


async def test_survey_participation_without_permission_returns_403(
    member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/analytics/surveys/participation")
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


async def test_document_efficiency_computes_avg_and_overdue(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "analytics:view")
    org = Org(name=f"效率統計組織-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()

    now = datetime.now(UTC)
    completed = _make_doc(
        org,
        member_user,
        submitted_at=now - timedelta(hours=10),
        completed_at=now - timedelta(hours=2),
    )
    overdue = _make_doc(
        org,
        member_user,
        status=DocumentStatus.PENDING,
        submitted_at=now - timedelta(days=5),
        due_date=now - timedelta(days=1),
    )
    db_session.add_all([completed, overdue])
    await db_session.flush()

    ac = authed_client_factory(member_user)
    resp = await ac.get("/analytics/documents/efficiency")

    assert resp.status_code == 200
    body = resp.json()
    assert body["total_documents"] == 2
    assert body["completed_documents"] == 1
    assert body["overdue_count"] == 1
    assert body["avg_processing_hours"] == 8.0


async def test_dept_ranking_groups_by_org(db_session, member_user, authed_client_factory) -> None:
    await _grant(db_session, member_user, "analytics:view")
    org = Org(name=f"排名組織-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    now = datetime.now(UTC)
    doc = _make_doc(
        org,
        member_user,
        submitted_at=now - timedelta(hours=4),
        completed_at=now,
    )
    db_session.add(doc)
    await db_session.flush()

    ac = authed_client_factory(member_user)
    resp = await ac.get("/analytics/documents/dept-ranking")

    assert resp.status_code == 200
    rows = resp.json()
    assert any(row["org_id"] == str(org.id) and row["total_docs"] == 1 for row in rows)


async def test_pending_alerts_lists_overdue_approvals(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "document:admin")
    org = Org(name=f"警示組織-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    doc = _make_doc(org, member_user, status=DocumentStatus.PENDING)
    db_session.add(doc)
    await db_session.flush()
    db_session.add(
        DocumentApproval(
            document_id=doc.id,
            approver_id=member_user.id,
            step_order=1,
            status=ApprovalStepStatus.PENDING,
            created_at=datetime.now(UTC) - timedelta(hours=72),
        )
    )
    await db_session.flush()

    ac = authed_client_factory(member_user)
    resp = await ac.get("/analytics/documents/pending-alerts", params={"threshold_hours": 48})

    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["document_id"] == str(doc.id)
    assert body[0]["waiting_hours"] >= 48


async def test_pending_alerts_excludes_recent_approvals(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "document:admin")
    org = Org(name=f"警示組織2-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    doc = _make_doc(org, member_user, status=DocumentStatus.PENDING)
    db_session.add(doc)
    await db_session.flush()
    db_session.add(
        DocumentApproval(
            document_id=doc.id,
            approver_id=member_user.id,
            step_order=1,
            status=ApprovalStepStatus.PENDING,
        )
    )
    await db_session.flush()

    ac = authed_client_factory(member_user)
    resp = await ac.get("/analytics/documents/pending-alerts", params={"threshold_hours": 48})

    assert resp.status_code == 200
    assert resp.json() == []


async def test_governance_insights_returns_empty_when_nothing_stale(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "analytics:view")
    ac = authed_client_factory(member_user)

    resp = await ac.get("/analytics/insights")

    assert resp.status_code == 200
    body = resp.json()
    assert body["items"] == []
    assert body["total"] == 0


async def test_announcement_participation_counts_reads(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "analytics:view")
    ann = Announcement(
        title="參與率測試公告",
        content={},
        author_id=member_user.id,
        is_published=True,
        audience_type="all",
        published_at=datetime.now(UTC) - timedelta(hours=2),
    )
    db_session.add(ann)
    await db_session.flush()

    ac = authed_client_factory(member_user)
    resp = await ac.get("/analytics/announcements/participation")

    assert resp.status_code == 200
    body = resp.json()
    assert any(row["announcement_id"] == str(ann.id) and row["reader_count"] == 0 for row in body)


async def test_survey_participation_excludes_draft_surveys(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "analytics:view")
    org = Org(name=f"問卷組織-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    open_survey = Survey(
        title="開放中問卷",
        org_id=org.id,
        created_by=member_user.id,
        status=SurveyStatus.OPEN,
    )
    draft_survey = Survey(
        title="草稿問卷",
        org_id=org.id,
        created_by=member_user.id,
        status=SurveyStatus.DRAFT,
    )
    db_session.add_all([open_survey, draft_survey])
    await db_session.flush()

    ac = authed_client_factory(member_user)
    resp = await ac.get("/analytics/surveys/participation")

    assert resp.status_code == 200
    ids = {row["survey_id"] for row in resp.json()}
    assert str(open_survey.id) in ids
    assert str(draft_survey.id) not in ids


async def test_page_view_tracking_does_not_require_analytics_permission(
    member_user, authed_client_factory, db_session
) -> None:
    ac = authed_client_factory(member_user)

    resp = await ac.post("/analytics/page-views", json={"path": "/documents/123"})

    assert resp.status_code == 204
    result = await db_session.execute(
        select(AnalyticsPageView).where(AnalyticsPageView.user_id == member_user.id)
    )
    assert result.scalar_one().path == "/documents/:id"


async def test_product_analytics_returns_daily_users_and_page_metrics(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "analytics:view")
    now = datetime.now(UTC)
    new_user = User(
        email=f"product-analytics-{uuid.uuid4().hex[:8]}@example.com",
        display_name="產品統計使用者",
        created_at=now - timedelta(days=1),
    )
    db_session.add(new_user)
    await db_session.flush()
    db_session.add_all(
        [
            AnalyticsPageView(user_id=member_user.id, path="/documents/:id", created_at=now),
            AnalyticsPageView(user_id=new_user.id, path="/documents/:id", created_at=now),
            AnalyticsPageView(user_id=member_user.id, path="/analytics", created_at=now),
        ]
    )
    await db_session.flush()

    resp = await authed_client_factory(member_user).get(
        "/analytics/product",
        params={
            "date_from": (now - timedelta(days=2)).date().isoformat(),
            "date_to": now.date().isoformat(),
        },
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["total_users"] >= 1
    assert body["total_page_views"] == 3
    assert body["active_pages"] == 2
    documents = next(item for item in body["page_metrics"] if item["path"] == "/documents/:id")
    assert documents["views"] == 2
    assert documents["unique_visitors"] == 2
    assert documents["click_rate"] == 0.6667
