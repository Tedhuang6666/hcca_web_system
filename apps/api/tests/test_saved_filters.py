"""常用篩選（/saved-filters）路由測試。

涵蓋列表（含 scope 篩選）、建立、更新、刪除，以及跨使用者不可見/不可操作。
"""

from __future__ import annotations

import uuid
from collections.abc import Callable

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.saved_filter import SavedFilter
from api.models.user import User


async def _make_saved_filter(
    db_session: AsyncSession, user: User, *, scope: str = "documents", name: str = "我的篩選"
) -> SavedFilter:
    sf = SavedFilter(
        id=uuid.uuid4(),
        user_id=user.id,
        scope=scope,
        name=name,
        description=None,
        params={"status": "pending"},
        share_path=None,
    )
    db_session.add(sf)
    await db_session.flush()
    return sf


async def test_list_saved_filters_without_login_returns_401(client: AsyncClient) -> None:
    """匿名使用者不可查詢常用篩選。"""
    response = await client.get("/saved-filters")
    assert response.status_code == 401


async def test_list_saved_filters_only_returns_own_filters(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    make_user: Callable[..., object],
    db_session: AsyncSession,
) -> None:
    """常用篩選只能看到自己的，不可看到別人的。"""
    other = await make_user(email="other-saved-filter@school.edu")
    mine = await _make_saved_filter(db_session, member_user, name="我的")
    await _make_saved_filter(db_session, other, name="別人的")

    ac = authed_client_factory(member_user)
    response = await ac.get("/saved-filters")

    assert response.status_code == 200
    body = response.json()
    assert {item["id"] for item in body} == {str(mine.id)}


async def test_list_saved_filters_filters_by_scope(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    """scope 查詢參數應正確過濾。"""
    doc_filter = await _make_saved_filter(db_session, member_user, scope="documents")
    await _make_saved_filter(db_session, member_user, scope="regulations")

    ac = authed_client_factory(member_user)
    response = await ac.get("/saved-filters", params={"scope": "documents"})

    assert response.status_code == 200
    body = response.json()
    assert {item["id"] for item in body} == {str(doc_filter.id)}


async def test_create_saved_filter_success(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    """建立常用篩選成功並回傳 201。"""
    ac = authed_client_factory(member_user)
    response = await ac.post(
        "/saved-filters",
        json={
            "scope": "documents",
            "name": "待審核公文",
            "description": "我常查的",
            "params": {"status": "pending"},
            "share_path": "/documents?status=pending",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "待審核公文"
    assert body["params"] == {"status": "pending"}


async def test_create_saved_filter_without_login_returns_401(client: AsyncClient) -> None:
    """匿名使用者不可建立常用篩選。"""
    response = await client.post("/saved-filters", json={"scope": "documents", "name": "測試"})
    assert response.status_code == 401


async def test_update_saved_filter_success(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    """使用者可更新自己的常用篩選。"""
    sf = await _make_saved_filter(db_session, member_user)

    ac = authed_client_factory(member_user)
    response = await ac.patch(f"/saved-filters/{sf.id}", json={"name": "新名稱"})

    assert response.status_code == 200
    assert response.json()["name"] == "新名稱"


async def test_update_saved_filter_of_other_user_returns_404(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    make_user: Callable[..., object],
    db_session: AsyncSession,
) -> None:
    """不可更新別人的常用篩選（回傳 404 而非 403，避免洩漏存在性）。"""
    other = await make_user(email="other-update@school.edu")
    sf = await _make_saved_filter(db_session, other)

    ac = authed_client_factory(member_user)
    response = await ac.patch(f"/saved-filters/{sf.id}", json={"name": "偷改"})

    assert response.status_code == 404


async def test_update_saved_filter_missing_returns_404(
    authed_client_factory: Callable[[User], AsyncClient], member_user: User
) -> None:
    """更新不存在的常用篩選應回傳 404。"""
    ac = authed_client_factory(member_user)
    response = await ac.patch(f"/saved-filters/{uuid.uuid4()}", json={"name": "x"})
    assert response.status_code == 404


async def test_delete_saved_filter_success(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    """使用者可刪除自己的常用篩選。"""
    sf = await _make_saved_filter(db_session, member_user)

    ac = authed_client_factory(member_user)
    response = await ac.delete(f"/saved-filters/{sf.id}")

    assert response.status_code == 204


async def test_delete_saved_filter_of_other_user_returns_404(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    make_user: Callable[..., object],
    db_session: AsyncSession,
) -> None:
    """不可刪除別人的常用篩選。"""
    other = await make_user(email="other-delete@school.edu")
    sf = await _make_saved_filter(db_session, other)

    ac = authed_client_factory(member_user)
    response = await ac.delete(f"/saved-filters/{sf.id}")

    assert response.status_code == 404
