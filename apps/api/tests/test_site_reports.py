"""網站漏洞與功能問題回報 API 測試。"""

from __future__ import annotations

import uuid
from collections.abc import Callable

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.site_report import SiteReport
from api.models.user import User

pytestmark = pytest.mark.asyncio


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
