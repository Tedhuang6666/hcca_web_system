"""網站漏洞與功能問題回報 API 測試。"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.notification import Notification
from api.models.org import Org, Position, UserPosition
from api.models.outbox import OutboxEvent
from api.models.site_report import SiteReport
from api.models.user import User

pytestmark = pytest.mark.asyncio


async def _make_it_department_member(
    db_session: AsyncSession, make_user: Callable[..., User]
) -> User:
    user = await make_user(
        email=f"it-{uuid.uuid4().hex[:8]}@school.edu", display_name="資訊部幹部"
    )
    org = Org(name="資訊部", is_active=True)
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="資訊", weight=10)
    db_session.add(position)
    await db_session.flush()
    db_session.add(
        UserPosition(user_id=user.id, position_id=position.id, start_date=date.today())
    )
    await db_session.flush()
    return user


async def test_portal_exposes_kind_and_severity_options(client: AsyncClient) -> None:
    response = await client.get("/site-reports/portal")

    assert response.status_code == 200
    body = response.json()
    assert body["is_open"] is True
    assert {item["value"] for item in body["kinds"]} == {"vulnerability", "bug"}
    assert {item["value"] for item in body["severities"]} == {
        "low",
        "medium",
        "high",
        "critical",
    }


async def test_anonymous_report_is_stored_with_reference_code(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    response = await client.post(
        "/site-reports",
        json={
            "kind": "vulnerability",
            "severity": "high",
            "title": "  公開附件可被未登入者讀取  ",
            "description": "將附件網址中的文件 ID 換成其他文件即可下載。",
            "steps_to_reproduce": "1. 開啟任一公開公文\n2. 替換附件 ID",
            "affected_url": "/documents/abc/attachments/def/download",
            "contact_email": "Reporter@Example.com",
        },
        headers={"User-Agent": "pytest-agent"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["reference_code"].startswith("SR-")
    assert body["id"]

    report = await db_session.scalar(
        select(SiteReport).where(SiteReport.id == uuid.UUID(body["id"]))
    )
    assert report is not None
    assert report.title == "公開附件可被未登入者讀取"
    assert report.reporter_id is None
    assert report.contact_email == "reporter@example.com"
    assert report.user_agent == "pytest-agent"
    assert report.status == "new"


async def test_honeypot_report_is_rejected(client: AsyncClient, db_session: AsyncSession) -> None:
    response = await client.post(
        "/site-reports",
        json={
            "title": "機器人送出測試",
            "description": "這是一筆用來驗證誘餌欄位的測試內容。",
            "website": "https://spam.example",
        },
    )

    assert response.status_code == 422
    assert await db_session.scalar(select(SiteReport.id)) is None


async def test_blank_title_is_rejected_after_trimming(client: AsyncClient) -> None:
    response = await client.post(
        "/site-reports",
        json={
            "title": "        ",
            "description": "標題只有空白時應該被視為未填寫。",
        },
    )

    assert response.status_code == 422
    assert "title" in response.text


async def test_affected_url_rejects_unsafe_scheme(client: AsyncClient) -> None:
    response = await client.post(
        "/site-reports",
        json={
            "title": "網址格式測試",
            "description": "確認非 http 或站內路徑的網址會被拒絕。",
            "affected_url": "javascript:alert(1)",
        },
    )

    assert response.status_code == 422


async def test_logged_in_report_records_reporter(
    client: AsyncClient,
    make_user: Callable[..., User],
    authed_client_factory: Callable[[User], AsyncClient],
) -> None:
    user = await make_user()
    authed = authed_client_factory(user)

    response = await authed.post(
        "/site-reports",
        json={
            "kind": "bug",
            "severity": "low",
            "title": "公告列表換頁後空白",
            "description": "在公告列表點下一頁後畫面一直停在載入中。",
        },
    )

    assert response.status_code == 201


async def test_admin_list_requires_permission(
    client: AsyncClient, make_user: Callable[..., User], authed_client_factory: Callable[[User], AsyncClient]
) -> None:
    member = await make_user()
    authed = authed_client_factory(member)

    response = await authed.get("/site-reports/admin")

    assert response.status_code == 403


async def test_admin_can_list_and_update_report(
    client: AsyncClient,
    db_session: AsyncSession,
    admin_user: User,
    authed_client_factory: Callable[[User], AsyncClient],
) -> None:
    await client.post(
        "/site-reports",
        json={
            "kind": "vulnerability",
            "severity": "critical",
            "title": "權限繞過測試",
            "description": "需要確認管理端點是否會誤放行未授權使用者。",
        },
    )
    admin = authed_client_factory(admin_user)

    listing = await admin.get("/site-reports/admin")
    assert listing.status_code == 200
    reports = listing.json()
    assert len(reports) == 1

    updated = await admin.patch(
        f"/site-reports/admin/{reports[0]['id']}",
        json={"status": "triaged", "severity": "low", "admin_note": "已排入下個維護窗口"},
    )

    assert updated.status_code == 200
    body = updated.json()
    assert body["status"] == "triaged"
    assert body["severity"] == "low"
    assert body["admin_note"] == "已排入下個維護窗口"
    assert body["reviewed_by"] == str(admin_user.id)

    stored = await db_session.scalar(
        select(SiteReport).where(SiteReport.id == uuid.UUID(body["id"]))
    )
    assert stored is not None
    assert stored.status == "triaged"


async def test_new_report_notifies_it_department_members(
    client: AsyncClient,
    db_session: AsyncSession,
    make_user: Callable[..., User],
) -> None:
    cadre = await _make_it_department_member(db_session, make_user)
    outsider = await make_user()

    response = await client.post(
        "/site-reports",
        json={
            "kind": "vulnerability",
            "severity": "high",
            "title": "附件下載端點可繞過權限",
            "description": "替換附件 ID 後可以直接下載未公開的附件。",
            "affected_url": "/documents/abc/attachments/def/download",
            "contact_email": "reporter@example.com",
        },
    )

    assert response.status_code == 201
    report_id = uuid.UUID(response.json()["id"])

    notifications = list(
        (
            await db_session.scalars(
                select(Notification).where(Notification.type == "site_report_received")
            )
        ).all()
    )
    assert len(notifications) == 1
    notification = notifications[0]
    assert notification.user_id == cadre.id
    assert notification.related_id == report_id
    assert notification.link == f"/security-reports#report-{report_id}"
    assert notification.title.startswith("新網站回報")
    assert "SR-" in (notification.body or "")
    assert "資安漏洞" in (notification.body or "")
    assert "reporter@example.com" in (notification.body or "")
    assert outsider.id not in {item.user_id for item in notifications}

    email_events = list(
        (
            await db_session.scalars(
                select(OutboxEvent).where(
                    OutboxEvent.event_type == "notification.email_batch"
                )
            )
        ).all()
    )
    assert any(
        event.payload.get("notification_id") == str(notification.id)
        for event in email_events
    )


async def test_reporter_is_not_notified_about_own_report(
    client: AsyncClient,
    db_session: AsyncSession,
    make_user: Callable[..., User],
    authed_client_factory: Callable[[User], AsyncClient],
) -> None:
    cadre = await _make_it_department_member(db_session, make_user)
    authed = authed_client_factory(cadre)

    response = await authed.post(
        "/site-reports",
        json={
            "kind": "bug",
            "severity": "low",
            "title": "自己回報的問題",
            "description": "由資訊部幹部本人送出的測試回報。",
        },
    )

    assert response.status_code == 201
    assert (
        await db_session.scalar(
            select(Notification.id).where(Notification.type == "site_report_received")
        )
        is None
    )
