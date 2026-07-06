"""個資處理路由測試（apps/api/src/api/routers/privacy.py）。

涵蓋匯出 ZIP、列出/下載匯出檔、假名化（含二次確認短語）與
system:privacy 權限檢查。
"""

from __future__ import annotations

import uuid
import zipfile
from collections.abc import Callable
from io import BytesIO

from httpx import AsyncClient

from api.models.user import User


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
