"""預寫常用報表路由測試（apps/api/src/api/routers/reports.py）。"""

from __future__ import annotations

from api.services.reports import REPORTS


async def test_list_reports_without_login_returns_401(client) -> None:
    resp = await client.get("/admin/reports")
    assert resp.status_code == 401


async def test_list_reports_by_member_returns_403(member_user, authed_client_factory) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/admin/reports")
    assert resp.status_code == 403


async def test_list_reports_by_admin_returns_all_registered_reports(
    admin_user, authed_client_factory
) -> None:
    ac = authed_client_factory(admin_user)
    resp = await ac.get("/admin/reports")
    assert resp.status_code == 200
    body = resp.json()
    assert {row["id"] for row in body} == {r.id for r in REPORTS}
    assert len(body) == len(REPORTS)


async def test_run_unknown_report_returns_404(admin_user, authed_client_factory) -> None:
    ac = authed_client_factory(admin_user)
    resp = await ac.get("/admin/reports/does-not-exist")
    assert resp.status_code == 404


async def test_run_report_by_member_returns_403(member_user, authed_client_factory) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/admin/reports/superuser_list")
    assert resp.status_code == 403


async def test_run_superuser_list_report_includes_seeded_superuser(
    admin_user, authed_client_factory
) -> None:
    ac = authed_client_factory(admin_user)
    resp = await ac.get("/admin/reports/superuser_list")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == "superuser_list"
    assert body["row_count"] == len(body["rows"])
    assert any(row["email"] == admin_user.email for row in body["rows"])


async def test_export_report_csv_unknown_report_returns_404(
    admin_user, authed_client_factory
) -> None:
    ac = authed_client_factory(admin_user)
    resp = await ac.get("/admin/reports/does-not-exist/csv")
    assert resp.status_code == 404


async def test_export_report_csv_returns_csv_with_header_row(
    admin_user, authed_client_factory
) -> None:
    ac = authed_client_factory(admin_user)
    resp = await ac.get("/admin/reports/superuser_list/csv")
    assert resp.status_code == 200
    assert "text/csv" in resp.headers["content-type"]
    assert 'filename="report_superuser_list.csv"' in resp.headers["content-disposition"]
    decoded = resp.content.decode("utf-8-sig")
    header = decoded.splitlines()[0]
    assert "email" in header
