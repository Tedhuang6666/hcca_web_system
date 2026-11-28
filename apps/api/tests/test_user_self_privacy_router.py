"""使用者自助隱私路由測試（apps/api/src/api/routers/users.py，個資法當事人權利）。

涵蓋自助匯出 ZIP、下載（含跨使用者檔名防護）、以及自助申請假名化刪除。
"""

from __future__ import annotations

import json
import uuid
import zipfile
from collections.abc import Callable
from datetime import UTC, datetime
from io import BytesIO

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.models.org import Org
from api.models.petition import PetitionCase, PetitionType
from api.models.user import User


@pytest.fixture(autouse=True)
def _exports_in_tmp(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    """測試匯出檔寫入暫存目錄，不在 repo 根目錄留下含個資的 zip。"""
    monkeypatch.setattr(settings, "DB_BACKUP_DIR", str(tmp_path / "backups"))
    monkeypatch.setattr(settings, "PRIVACY_EXPORT_DIR", str(tmp_path / "private_exports"))


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


async def test_self_export_omits_staff_only_petition_fields(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    org = Org(name=f"privacy-petition-org-{uuid.uuid4().hex[:8]}")
    db_session.add(org)
    await db_session.flush()
    petition_type = PetitionType(
        name=f"privacy-petition-type-{uuid.uuid4().hex[:8]}", responsible_org_id=org.id
    )
    db_session.add(petition_type)
    await db_session.flush()
    db_session.add(
        PetitionCase(
            case_number="PRV1234",
            share_token_hash="a" * 64,
            type_id=petition_type.id,
            submitter_id=member_user.id,
            current_org_id=org.id,
            title="我的陳情",
            content="陳情內容",
            latest_internal_note="僅供承辦人閱讀",
            discord_channel_id="123456789",
            submitted_at=datetime.now(UTC),
        )
    )
    await db_session.flush()

    ac = authed_client_factory(member_user)
    export = await ac.post("/users/me/privacy/export")
    assert export.status_code == 202
    downloaded = await ac.get(export.json()["download_url"])
    assert downloaded.status_code == 200
    with zipfile.ZipFile(BytesIO(downloaded.content)) as zf:
        petitions = json.loads(zf.read("petitions.json"))
        manifest = json.loads(zf.read("manifest.json"))
    assert len(petitions) == 1
    assert petitions[0]["title"] == "我的陳情"
    assert "latest_internal_note" not in petitions[0]
    assert "discord_channel_id" not in petitions[0]
    assert "share_token_hash" not in petitions[0]
    assert "latest_internal_note" not in manifest["files"]["petitions.json"]["fields"]


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
