"""公告系統路由測試 — 公開列表 / 管理端 CRUD / 發布狀態 / 媒體管理。"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies.auth import get_current_active_user, get_optional_user
from api.main import app
from api.models.announcement import Announcement
from api.models.org import Org, Permission, Position, UserPosition
from api.models.user import User


def _override_user(user: User | None) -> None:
    """同時覆寫必登入與選填登入兩個依賴：/announcements 部分端點（如公告詳情）
    用 get_optional_user（訪客也可呼叫），與 get_current_active_user 是各自獨立的
    依賴函式，只覆寫其中一個不會影響另一個。"""

    async def override() -> User | None:
        return user

    app.dependency_overrides[get_current_active_user] = override
    app.dependency_overrides[get_optional_user] = override


async def _seed_user_with_codes(
    db: AsyncSession, email: str, codes: list[str], *, superuser: bool = False
) -> User:
    from datetime import date

    user = User(
        email=email,
        display_name="測試使用者",
        is_active=True,
        is_verified=True,
        is_superuser=superuser,
    )
    db.add(user)
    await db.flush()
    if codes:
        org = Org(name="測試組織")
        db.add(org)
        await db.flush()
        position = Position(org_id=org.id, name="測試職位")
        db.add(position)
        await db.flush()
        for code in codes:
            db.add(Permission(position_id=position.id, code=code))
        db.add(UserPosition(user_id=user.id, position_id=position.id, start_date=date.today()))
        await db.flush()
    return user


@pytest.mark.asyncio
async def test_get_active_urgent_returns_null_when_none(client: AsyncClient) -> None:
    resp = await client.get("/announcements/active-urgent")
    assert resp.status_code == 200
    assert resp.json() is None


@pytest.mark.asyncio
async def test_list_announcements_only_returns_published(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    author = await _seed_user_with_codes(db_session, "ann-author@school.edu", [])
    db_session.add_all(
        [
            Announcement(
                title="已發布公告",
                content={},
                author_id=author.id,
                is_published=True,
                audience_type="all",
            ),
            Announcement(
                title="草稿公告",
                content={},
                author_id=author.id,
                is_published=False,
                audience_type="all",
            ),
        ]
    )
    await db_session.flush()

    resp = await client.get("/announcements")

    assert resp.status_code == 200
    assert [item["title"] for item in resp.json()] == ["已發布公告"]


@pytest.mark.asyncio
async def test_list_all_announcements_without_permission_returns_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user_with_codes(db_session, "ann-no-perm@school.edu", [])
    _override_user(user)

    resp = await client.get("/announcements/admin/all")

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_all_announcements_with_permission_includes_drafts(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    author = await _seed_user_with_codes(
        db_session, "ann-admin@school.edu", ["announcement:create"]
    )
    db_session.add(
        Announcement(
            title="待審草稿",
            content={},
            author_id=author.id,
            is_published=False,
            audience_type="all",
        )
    )
    await db_session.flush()
    _override_user(author)

    resp = await client.get("/announcements/admin/all")

    assert resp.status_code == 200
    assert [item["title"] for item in resp.json()] == ["待審草稿"]


@pytest.mark.asyncio
async def test_get_draft_announcement_hidden_from_stranger_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    author = await _seed_user_with_codes(db_session, "ann-draft-author@school.edu", [])
    stranger = await _seed_user_with_codes(db_session, "ann-stranger@school.edu", [])
    ann = Announcement(
        title="他人草稿", content={}, author_id=author.id, is_published=False, audience_type="all"
    )
    db_session.add(ann)
    await db_session.flush()
    _override_user(stranger)

    resp = await client.get(f"/announcements/{ann.id}")

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_draft_announcement_visible_to_author(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    author = await _seed_user_with_codes(db_session, "ann-self-author@school.edu", [])
    ann = Announcement(
        title="自己的草稿", content={}, author_id=author.id, is_published=False, audience_type="all"
    )
    db_session.add(ann)
    await db_session.flush()
    _override_user(author)

    resp = await client.get(f"/announcements/{ann.id}")

    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_get_announcement_stats_without_permission_returns_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    author = await _seed_user_with_codes(db_session, "ann-stats-author@school.edu", [])
    stranger = await _seed_user_with_codes(db_session, "ann-stats-stranger@school.edu", [])
    ann = Announcement(
        title="統計公告", content={}, author_id=author.id, is_published=True, audience_type="all"
    )
    db_session.add(ann)
    await db_session.flush()
    _override_user(stranger)

    resp = await client.get(f"/announcements/{ann.id}/stats")

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_announcement_without_permission_returns_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user_with_codes(db_session, "ann-create-403@school.edu", [])
    _override_user(user)

    resp = await client.post("/announcements", json={"title": "新公告", "content": {}})

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_announcement_succeeds(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _seed_user_with_codes(
        db_session, "ann-create-ok@school.edu", ["announcement:create"]
    )
    _override_user(user)

    resp = await client.post("/announcements", json={"title": "新公告", "content": {}})

    assert resp.status_code == 201
    assert resp.json()["title"] == "新公告"
    assert resp.json()["is_published"] is False


@pytest.mark.asyncio
async def test_update_announcement_without_permission_returns_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    author = await _seed_user_with_codes(db_session, "ann-update-author@school.edu", [])
    stranger = await _seed_user_with_codes(db_session, "ann-update-stranger@school.edu", [])
    ann = Announcement(
        title="待改公告", content={}, author_id=author.id, is_published=False, audience_type="all"
    )
    db_session.add(ann)
    await db_session.flush()
    _override_user(stranger)

    resp = await client.patch(f"/announcements/{ann.id}", json={"title": "偷改"})

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_update_announcement_succeeds(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _seed_user_with_codes(
        db_session, "ann-update-ok@school.edu", ["announcement:create", "announcement:edit"]
    )
    _override_user(user)
    ann_id = (await client.post("/announcements", json={"title": "原標題2", "content": {}})).json()[
        "id"
    ]

    resp = await client.patch(f"/announcements/{ann_id}", json={"title": "更新標題"})

    assert resp.status_code == 200
    assert resp.json()["title"] == "更新標題"


@pytest.mark.asyncio
async def test_publish_and_unpublish_announcement(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user_with_codes(
        db_session,
        "ann-publish@school.edu",
        ["announcement:create", "announcement:publish"],
    )
    _override_user(user)
    ann_id = (await client.post("/announcements", json={"title": "待發布", "content": {}})).json()[
        "id"
    ]

    published = await client.post(f"/announcements/{ann_id}/publish")
    assert published.status_code == 200
    assert published.json()["is_published"] is True

    unpublished = await client.post(f"/announcements/{ann_id}/unpublish")
    assert unpublished.status_code == 200
    assert unpublished.json()["is_published"] is False


@pytest.mark.asyncio
async def test_publish_announcement_without_permission_returns_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    author = await _seed_user_with_codes(
        db_session, "ann-publish-403-author@school.edu", ["announcement:create"]
    )
    _override_user(author)
    ann_id = (
        await client.post("/announcements", json={"title": "無權發布", "content": {}})
    ).json()["id"]

    resp = await client.post(f"/announcements/{ann_id}/publish")

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_set_urgent_only_changes_urgent_fields(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user_with_codes(
        db_session,
        "ann-urgent@school.edu",
        ["announcement:create", "announcement:set_urgent"],
    )
    _override_user(user)
    ann_id = (
        await client.post("/announcements", json={"title": "緊急公告", "content": {}})
    ).json()["id"]

    resp = await client.patch(
        f"/announcements/{ann_id}/urgent",
        json={"is_urgent": True, "title": "不該生效的標題"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["is_urgent"] is True
    assert body["title"] == "緊急公告"


@pytest.mark.asyncio
async def test_delete_announcement_without_permission_returns_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    author = await _seed_user_with_codes(db_session, "ann-delete-author@school.edu", [])
    stranger = await _seed_user_with_codes(db_session, "ann-delete-stranger@school.edu", [])
    ann = Announcement(
        title="待刪公告", content={}, author_id=author.id, is_published=False, audience_type="all"
    )
    db_session.add(ann)
    await db_session.flush()
    _override_user(stranger)

    resp = await client.delete(f"/announcements/{ann.id}")

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_delete_announcement_succeeds(client: AsyncClient, db_session: AsyncSession) -> None:
    user = await _seed_user_with_codes(
        db_session, "ann-delete-ok@school.edu", ["announcement:create", "announcement:edit"]
    )
    _override_user(user)
    ann_id = (await client.post("/announcements", json={"title": "待刪", "content": {}})).json()[
        "id"
    ]

    resp = await client.delete(f"/announcements/{ann_id}")

    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_upload_media_without_permission_returns_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    author = await _seed_user_with_codes(
        db_session, "ann-media-author@school.edu", ["announcement:create"]
    )
    stranger = await _seed_user_with_codes(db_session, "ann-media-stranger@school.edu", [])
    ann = Announcement(
        title="媒體公告", content={}, author_id=author.id, is_published=False, audience_type="all"
    )
    db_session.add(ann)
    await db_session.flush()
    _override_user(stranger)

    resp = await client.post(
        f"/announcements/{ann.id}/media",
        files={"file": ("a.png", b"\x89PNG\r\n\x1a\n data", "image/png")},
    )

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_upload_and_delete_media_succeeds(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    from api.services.storage import LocalStorageBackend

    user = await _seed_user_with_codes(
        db_session,
        "ann-media-ok@school.edu",
        ["announcement:create", "announcement:media_manage"],
    )
    _override_user(user)
    ann_id = (
        await client.post("/announcements", json={"title": "媒體公告2", "content": {}})
    ).json()["id"]
    monkeypatch.setattr(
        "api.routers.announcements.get_storage",
        lambda: LocalStorageBackend(base_dir=str(tmp_path)),
    )

    uploaded = await client.post(
        f"/announcements/{ann_id}/media",
        files={"file": ("photo.png", b"\x89PNG\r\n\x1a\n data", "image/png")},
    )
    assert uploaded.status_code == 201
    media_id = uploaded.json()["id"]

    deleted = await client.delete(f"/announcements/{ann_id}/media/{media_id}")
    assert deleted.status_code == 204
