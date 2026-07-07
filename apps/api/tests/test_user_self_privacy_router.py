"""使用者自助隱私路由測試（apps/api/src/api/routers/users.py，個資法當事人權利）。

涵蓋自助匯出 ZIP、下載（含跨使用者檔名防護）、以及自助申請假名化刪除。
"""

from __future__ import annotations

import zipfile
from collections.abc import Callable
from io import BytesIO

from httpx import AsyncClient

from api.models.user import User


async def test_self_export_requires_login(client: AsyncClient) -> None:
    response = await client.post("/users/me/privacy/export")
    assert response.status_code == 401


async def test_self_export_returns_download_url(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.post("/users/me/privacy/export")
    assert response.status_code == 202
    body = response.json()
    assert body["file_count"] >= 1
    assert body["download_url"].startswith("/users/me/privacy/export/download?filename=")
    assert body["filename"].startswith(f"export_{member_user.id}_")


async def test_self_download_export_returns_valid_zip(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    export_resp = await ac.post("/users/me/privacy/export")
    filename = export_resp.json()["filename"]

    download_resp = await ac.get(f"/users/me/privacy/export/download?filename={filename}")
    assert download_resp.status_code == 200
    assert download_resp.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(BytesIO(download_resp.content)) as zf:
        assert "manifest.json" in zf.namelist()


async def test_self_download_export_rejects_other_users_file(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    make_user: Callable[..., User],
) -> None:
    other_user = await make_user(email="other-privacy@school.edu")
    other_ac = authed_client_factory(other_user)
    export_resp = await other_ac.post("/users/me/privacy/export")
    other_filename = export_resp.json()["filename"]

    ac = authed_client_factory(member_user)
    response = await ac.get(f"/users/me/privacy/export/download?filename={other_filename}")
    assert response.status_code == 403


async def test_self_download_export_rejects_path_traversal(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.get(
        "/users/me/privacy/export/download",
        params={"filename": f"export_{member_user.id}_../../etc/passwd"},
    )
    # WAF middleware 在到達 router 前即攔截路徑跳脫（400）；即使繞過 WAF，
    # router 自身的 ".." / "/" 檢查也會擋（403）——兩層防禦都不可為 200。
    assert response.status_code in (400, 403)


async def test_self_download_export_404_when_missing(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.get(
        "/users/me/privacy/export/download",
        params={"filename": f"export_{member_user.id}_20260101_000000.zip"},
    )
    assert response.status_code == 404


async def test_self_request_deletion_anonymizes_self(
    authed_client_factory: Callable[[User], AsyncClient],
    make_user: Callable[..., User],
    db_session,
) -> None:
    from sqlalchemy import select

    original_email = "delete-me@school.edu"
    target = await make_user(email=original_email, display_name="要刪除的我")
    ac = authed_client_factory(target)
    response = await ac.post("/users/me/privacy/request-deletion")
    assert response.status_code == 202

    refreshed = await db_session.scalar(select(User).where(User.id == target.id))
    assert refreshed is not None
    assert refreshed.email != original_email
    assert refreshed.display_name != "要刪除的我"
    assert refreshed.is_active is False
