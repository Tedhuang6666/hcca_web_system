"""個資處理路由測試（apps/api/src/api/routers/privacy.py）。

涵蓋匯出 ZIP、列出/下載匯出檔、假名化（含二次確認短語）與
system:privacy 權限檢查。
"""

from __future__ import annotations

import uuid
import zipfile
from collections.abc import Callable
from datetime import UTC, datetime
from io import BytesIO

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.models.user import User


@pytest.fixture(autouse=True)
def _exports_in_tmp(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    """測試匯出檔寫入暫存目錄，不在 repo 根目錄留下含個資的 zip。"""
    monkeypatch.setattr(settings, "DB_BACKUP_DIR", str(tmp_path / "backups"))


def _authed(factory: Callable[[User], AsyncClient], user: User) -> AsyncClient:
    import secrets

    ac = factory(user)
    token = secrets.token_urlsafe(32)
    ac.cookies.set("csrf_token", token)
    ac._csrf_token = token
    return ac


# ---------------------------------------------------------------------------
# POST /admin/privacy/users/{user_id}/export
# ---------------------------------------------------------------------------


async def test_export_user_without_login_returns_401(client: AsyncClient) -> None:
    response = await client.post(f"/admin/privacy/users/{uuid.uuid4()}/export")
    assert response.status_code == 401


async def test_export_user_without_permission_returns_403(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = _authed(authed_client_factory, member_user)
    response = await ac.post(f"/admin/privacy/users/{uuid.uuid4()}/export")
    assert response.status_code == 403


async def test_export_nonexistent_user_returns_404(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = _authed(authed_client_factory, admin_user)
    response = await ac.post(f"/admin/privacy/users/{uuid.uuid4()}/export")
    assert response.status_code == 404


async def test_export_user_creates_zip_with_manifest(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., object],
) -> None:
    target = await make_user(email="privacy-export-target@school.edu")
    ac = _authed(authed_client_factory, admin_user)

    response = await ac.post(f"/admin/privacy/users/{target.id}/export")

    assert response.status_code == 200
    payload = response.json()
    assert payload["user_id"] == str(target.id)
    assert payload["file_count"] >= 1
    assert payload["size_bytes"] > 0

    # 匯出檔應真的出現在 list_exports
    list_resp = await ac.get("/admin/privacy/exports")
    assert list_resp.status_code == 200
    filenames = {row["filename"] for row in list_resp.json()}
    assert payload["file_path"] in filenames


# ---------------------------------------------------------------------------
# GET /admin/privacy/exports + /admin/privacy/exports/download
# ---------------------------------------------------------------------------


async def test_list_exports_without_permission_returns_403(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    ac = _authed(authed_client_factory, member_user)
    response = await ac.get("/admin/privacy/exports")
    assert response.status_code == 403


async def test_download_export_returns_zip_bytes(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., object],
) -> None:
    target = await make_user(email="privacy-download-target@school.edu")
    ac = _authed(authed_client_factory, admin_user)

    export_resp = await ac.post(f"/admin/privacy/users/{target.id}/export")
    filename = export_resp.json()["file_path"]

    download_resp = await ac.get("/admin/privacy/exports/download", params={"filename": filename})

    assert download_resp.status_code == 200
    assert download_resp.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(BytesIO(download_resp.content)) as zf:
        assert "manifest.json" in zf.namelist()


async def test_download_nonexistent_export_returns_404(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = _authed(authed_client_factory, admin_user)
    response = await ac.get(
        "/admin/privacy/exports/download", params={"filename": "does-not-exist.zip"}
    )
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# POST /admin/privacy/users/{user_id}/anonymize
# ---------------------------------------------------------------------------


async def test_anonymize_without_correct_confirm_phrase_returns_400(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., object],
) -> None:
    target = await make_user(email="anonymize-target@school.edu")
    ac = _authed(authed_client_factory, admin_user)

    response = await ac.post(
        f"/admin/privacy/users/{target.id}/anonymize", json={"confirm_phrase": "wrong"}
    )

    assert response.status_code == 400


async def test_anonymize_with_correct_confirm_phrase_scrubs_pii(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., object],
) -> None:
    target = await make_user(email="anonymize-target2@school.edu", display_name="待假名化使用者")
    original_email = target.email
    ac = _authed(authed_client_factory, admin_user)

    response = await ac.post(
        f"/admin/privacy/users/{target.id}/anonymize", json={"confirm_phrase": "假名化"}
    )

    assert response.status_code == 200
    payload = response.json()
    assert "email" in payload["fields_updated"]
    assert "display_name" in payload["fields_updated"]
    assert target.email != original_email
    assert target.email.endswith("@deleted.local")
    assert target.is_active is False


async def test_anonymize_nonexistent_user_returns_404(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = _authed(authed_client_factory, admin_user)
    response = await ac.post(
        f"/admin/privacy/users/{uuid.uuid4()}/anonymize", json={"confirm_phrase": "假名化"}
    )
    assert response.status_code == 404


async def test_anonymize_owner_is_rejected_even_for_superuser(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., object],
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = await make_user(email="owner@school.edu", is_superuser=True)
    monkeypatch.setattr(settings, "OWNER_EMAILS", ["owner@school.edu"])
    ac = _authed(authed_client_factory, admin_user)

    response = await ac.post(
        f"/admin/privacy/users/{owner.id}/anonymize", json={"confirm_phrase": "假名化"}
    )

    assert response.status_code == 409
    await db_session.refresh(owner)
    assert owner.email == "owner@school.edu"
    assert owner.is_active is True


async def test_anonymize_without_permission_returns_403(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    make_user: Callable[..., object],
) -> None:
    target = await make_user(email="anonymize-target3@school.edu")
    ac = _authed(authed_client_factory, member_user)

    response = await ac.post(
        f"/admin/privacy/users/{target.id}/anonymize", json={"confirm_phrase": "假名化"}
    )

    assert response.status_code == 403


async def test_export_excludes_authentication_secrets(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., object],
) -> None:
    import json

    target = await make_user(
        email="export-secret@school.edu", google_sub="google-sub-1", mfa_secret="enc-secret"
    )
    ac = _authed(authed_client_factory, admin_user)
    payload = (await ac.post(f"/admin/privacy/users/{target.id}/export")).json()
    download = await ac.get(
        "/admin/privacy/exports/download", params={"filename": payload["file_path"]}
    )

    with zipfile.ZipFile(BytesIO(download.content)) as archive:
        users = json.loads(archive.read("users.json"))
    assert users[0]["email"] == "export-secret@school.edu"
    assert "mfa_secret" not in users[0]
    assert "google_sub" not in users[0]


def test_expired_exports_are_purged() -> None:
    import os
    import time

    from api.services import privacy as privacy_svc

    root = privacy_svc.exports_root()
    old = root / f"export_{uuid.uuid4()}_20260101_000000.zip"
    fresh = root / f"export_{uuid.uuid4()}_20261117_000000.zip"
    old.write_bytes(b"old")
    fresh.write_bytes(b"fresh")
    two_days_ago = time.time() - 2 * 24 * 3600
    os.utime(old, (two_days_ago, two_days_ago))

    assert privacy_svc.purge_expired_exports() == 1
    assert not old.exists()
    assert fresh.exists()


async def test_anonymize_removes_remaining_identifiers(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    make_user: Callable[..., object],
    db_session: AsyncSession,
) -> None:
    from api.models.person import Person
    from api.models.user_identity import UserIdentity

    target = await make_user(
        email="anon-full@school.edu", student_id="11599", google_sub="google-sub-anon"
    )
    db_session.add(
        UserIdentity(
            user_id=target.id,
            provider="google",
            external_id="google-sub-anon",
            email="anon-full@school.edu",
            display_name="真實姓名",
            linked_at=datetime.now(UTC),
        )
    )
    db_session.add(
        Person(
            user_id=target.id,
            student_id="11599",
            display_name="真實姓名",
            legal_name="真實姓名",
            email="a@b.c",
        )
    )
    await db_session.flush()
    ac = _authed(authed_client_factory, admin_user)
    await ac.post(f"/admin/privacy/users/{target.id}/export")

    response = await ac.post(
        f"/admin/privacy/users/{target.id}/anonymize", json={"confirm_phrase": "假名化"}
    )

    assert response.status_code == 200
    await db_session.refresh(target)
    assert target.student_id is None and target.google_sub is None
    assert (
        await db_session.scalar(select(UserIdentity).where(UserIdentity.user_id == target.id))
        is None
    )
    person = await db_session.scalar(select(Person).where(Person.user_id == target.id))
    assert person is not None and person.legal_name is None and person.student_id is None
    assert person.display_name != "真實姓名"
    from api.services import privacy as privacy_svc

    assert not list(privacy_svc.exports_root().glob(f"export_{target.id}_*.zip"))
