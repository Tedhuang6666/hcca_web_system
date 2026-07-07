"""公開官網 / Linktree 路由測試（apps/api/src/api/routers/site.py）。"""

from __future__ import annotations

import uuid
from datetime import timedelta


async def _grant(db_session, user, code: str) -> None:
    from api.core.clock import local_today
    from api.models.org import Org, Permission, Position, UserPosition

    org = Org(name=f"site-org-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="官網管理員")
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


def _settings_payload(**overrides) -> dict:
    defaults = {
        "site_title": "學生會官網",
        "hero_title": "歡迎光臨",
        "about_title": "關於我們",
        "about_body_md": "介紹內容",
        "cta_label": "了解更多",
        "cta_href": "/about",
        "public_database_label": "公開資料庫",
    }
    defaults.update(overrides)
    return defaults


def _link_category_payload(**overrides) -> dict:
    defaults = {"slug": f"cat-{uuid.uuid4().hex[:6]}", "title": "社群媒體"}
    defaults.update(overrides)
    return defaults


def _link_payload(**overrides) -> dict:
    defaults = {"title": "Instagram", "url": "https://instagram.com/example"}
    defaults.update(overrides)
    return defaults


def _page_payload(**overrides) -> dict:
    defaults = {
        "slug": f"page-{uuid.uuid4().hex[:6]}",
        "title": "組織架構",
        "body_md": "# 組織架構\n內容",
    }
    defaults.update(overrides)
    return defaults


# ---------------------------------------------------------------------------
# 公開端點（不需登入）
# ---------------------------------------------------------------------------


async def test_get_public_site_returns_bundle(client) -> None:
    resp = await client.get("/site/public")
    assert resp.status_code == 200
    body = resp.json()
    assert "settings" in body
    assert body["links"] == []
    assert body["nav_pages"] == []


async def test_list_public_links_only_shows_active(db_session, client) -> None:
    resp = await client.get(
        "/site/link-categories",
    )
    assert resp.status_code == 200

    resp = await client.get("/site/links")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_get_public_page_unpublished_returns_404(db_session, client) -> None:
    from api.models.site import PublicSitePage

    page = PublicSitePage(slug="draft-page", title="草稿頁", body_md="內容", is_published=False)
    db_session.add(page)
    await db_session.flush()

    resp = await client.get("/site/pages/draft-page")
    assert resp.status_code == 404


async def test_get_public_page_published_succeeds(db_session, client) -> None:
    from api.models.site import PublicSitePage

    page = PublicSitePage(slug="published-page", title="公開頁", body_md="內容", is_published=True)
    db_session.add(page)
    await db_session.flush()

    resp = await client.get("/site/pages/published-page")
    assert resp.status_code == 200
    assert resp.json()["title"] == "公開頁"


async def test_get_public_page_missing_returns_404(client) -> None:
    resp = await client.get("/site/pages/does-not-exist")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# 管理員：權限檢查
# ---------------------------------------------------------------------------


async def test_admin_get_settings_without_permission_returns_403(
    member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/site/admin/settings")
    assert resp.status_code == 403


async def test_admin_create_link_category_without_permission_returns_403(
    member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.post("/site/admin/link-categories", json=_link_category_payload())
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# 管理員：設定
# ---------------------------------------------------------------------------


async def test_admin_update_settings_succeeds(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "site:manage")
    ac = authed_client_factory(member_user)

    resp = await ac.patch("/site/admin/settings", json={"site_title": "新標題"})

    assert resp.status_code == 200
    assert resp.json()["site_title"] == "新標題"


# ---------------------------------------------------------------------------
# 管理員：連結分類
# ---------------------------------------------------------------------------


async def test_admin_link_category_crud_flow(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "site:manage")
    ac = authed_client_factory(member_user)

    created = await ac.post(
        "/site/admin/link-categories", json=_link_category_payload(slug="social")
    )
    assert created.status_code == 201
    category_id = created.json()["id"]

    dup = await ac.post("/site/admin/link-categories", json=_link_category_payload(slug="social"))
    assert dup.status_code == 409

    updated = await ac.patch(
        f"/site/admin/link-categories/{category_id}", json={"title": "社群連結（改）"}
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "社群連結（改）"

    listed = await ac.get("/site/admin/link-categories")
    assert len(listed.json()) == 1

    deleted = await ac.delete(f"/site/admin/link-categories/{category_id}")
    assert deleted.status_code == 204


async def test_admin_update_missing_link_category_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "site:manage")
    ac = authed_client_factory(member_user)

    resp = await ac.patch(f"/site/admin/link-categories/{uuid.uuid4()}", json={"title": "x"})
    assert resp.status_code == 404


async def test_admin_delete_missing_link_category_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "site:manage")
    ac = authed_client_factory(member_user)

    resp = await ac.delete(f"/site/admin/link-categories/{uuid.uuid4()}")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# 管理員：連結
# ---------------------------------------------------------------------------


async def test_admin_link_crud_flow(db_session, member_user, authed_client_factory) -> None:
    await _grant(db_session, member_user, "site:manage")
    ac = authed_client_factory(member_user)

    created = await ac.post("/site/admin/links", json=_link_payload())
    assert created.status_code == 201
    link_id = created.json()["id"]

    updated = await ac.patch(f"/site/admin/links/{link_id}", json={"title": "IG（改）"})
    assert updated.status_code == 200
    assert updated.json()["title"] == "IG（改）"

    listed = await ac.get("/site/admin/links")
    assert len(listed.json()) == 1

    deleted = await ac.delete(f"/site/admin/links/{link_id}")
    assert deleted.status_code == 204


async def test_admin_update_missing_link_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "site:manage")
    ac = authed_client_factory(member_user)

    resp = await ac.patch(f"/site/admin/links/{uuid.uuid4()}", json={"title": "x"})
    assert resp.status_code == 404


async def test_admin_delete_missing_link_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "site:manage")
    ac = authed_client_factory(member_user)

    resp = await ac.delete(f"/site/admin/links/{uuid.uuid4()}")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# 管理員：頁面
# ---------------------------------------------------------------------------


async def test_admin_page_crud_flow(db_session, member_user, authed_client_factory) -> None:
    await _grant(db_session, member_user, "site:manage")
    ac = authed_client_factory(member_user)

    created = await ac.post("/site/admin/pages", json=_page_payload(slug="about-us"))
    assert created.status_code == 201
    page_id = created.json()["id"]

    dup = await ac.post("/site/admin/pages", json=_page_payload(slug="about-us"))
    assert dup.status_code == 409

    updated = await ac.patch(f"/site/admin/pages/{page_id}", json={"title": "組織架構（改）"})
    assert updated.status_code == 200
    assert updated.json()["title"] == "組織架構（改）"

    listed = await ac.get("/site/admin/pages")
    assert len(listed.json()) == 1

    deleted = await ac.delete(f"/site/admin/pages/{page_id}")
    assert deleted.status_code == 204


async def test_admin_update_missing_page_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "site:manage")
    ac = authed_client_factory(member_user)

    resp = await ac.patch(f"/site/admin/pages/{uuid.uuid4()}", json={"title": "x"})
    assert resp.status_code == 404


async def test_admin_delete_missing_page_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "site:manage")
    ac = authed_client_factory(member_user)

    resp = await ac.delete(f"/site/admin/pages/{uuid.uuid4()}")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# 管理員：圖片上傳
# ---------------------------------------------------------------------------


async def test_admin_upload_image_rejects_bad_content_type(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "site:manage")
    ac = authed_client_factory(member_user)

    resp = await ac.post(
        "/site/admin/images",
        files={"file": ("evil.txt", b"not an image", "text/plain")},
    )
    assert resp.status_code == 422


async def test_admin_upload_image_succeeds(
    db_session, member_user, authed_client_factory, tmp_path, monkeypatch
) -> None:
    from api.core import config as config_module

    monkeypatch.setattr(config_module.settings, "STORAGE_LOCAL_DIR", str(tmp_path))
    await _grant(db_session, member_user, "site:manage")
    ac = authed_client_factory(member_user)

    png_magic = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
    resp = await ac.post(
        "/site/admin/images",
        files={"file": ("logo.png", png_magic, "image/png")},
    )
    assert resp.status_code == 201
    assert resp.json()["content_type"] == "image/png"
