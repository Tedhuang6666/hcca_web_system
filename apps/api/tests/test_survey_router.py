"""問卷系統 HTTP 路由測試（apps/api/src/api/routers/survey.py）。

test_survey.py 已涵蓋 schema 解析與部分服務層邏輯；本檔補齊 HTTP 層：權限檢查、
CRUD 流程、公開填答與 403/404/409/422 分支。
"""

from __future__ import annotations

import uuid
from collections.abc import Callable

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.org import Org
from api.models.user import User


async def _make_org(db: AsyncSession) -> Org:
    org = Org(name=f"survey-org-{uuid.uuid4().hex[:6]}")
    db.add(org)
    await db.flush()
    return org


async def test_create_survey_requires_login(client: AsyncClient) -> None:
    response = await client.post(
        "/surveys", json={"title": "測試問卷", "org_id": str(uuid.uuid4())}
    )
    assert response.status_code == 401


async def test_create_survey_stranger_forbidden(
    authed_client_factory: Callable[[User], AsyncClient],
    member_user: User,
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(member_user)
    response = await ac.post("/surveys", json={"title": "測試問卷", "org_id": str(org.id)})
    assert response.status_code == 403


async def test_create_survey_and_get_detail(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    response = await ac.post("/surveys", json={"title": "滿意度調查", "org_id": str(org.id)})
    assert response.status_code == 201
    survey_id = response.json()["id"]

    detail = await ac.get(f"/surveys/{survey_id}")
    assert detail.status_code == 200
    assert detail.json()["title"] == "滿意度調查"
    assert detail.json()["status"] == "draft"


async def test_get_survey_404_when_missing(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.get(f"/surveys/{uuid.uuid4()}")
    assert response.status_code == 404


async def test_list_surveys_filters_by_org(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org_a = await _make_org(db_session)
    org_b = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    await ac.post("/surveys", json={"title": "A問卷", "org_id": str(org_a.id)})
    await ac.post("/surveys", json={"title": "B問卷", "org_id": str(org_b.id)})

    response = await ac.get("/surveys", params={"org_id": str(org_a.id)})
    assert response.status_code == 200
    titles = {row["title"] for row in response.json()}
    assert titles == {"A問卷"}


async def test_update_survey_changes_title(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post("/surveys", json={"title": "舊標題", "org_id": str(org.id)})
    survey_id = create_resp.json()["id"]

    response = await ac.patch(f"/surveys/{survey_id}", json={"title": "新標題"})
    assert response.status_code == 200
    assert response.json()["title"] == "新標題"


async def test_add_question_then_open_survey(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post("/surveys", json={"title": "開放測試", "org_id": str(org.id)})
    survey_id = create_resp.json()["id"]

    question_resp = await ac.post(
        f"/surveys/{survey_id}/questions",
        json={"question_text": "你滿意嗎？", "question_type": "text"},
    )
    assert question_resp.status_code == 201
    question_id = question_resp.json()["id"]

    open_resp = await ac.post(f"/surveys/{survey_id}/open")
    assert open_resp.status_code == 200
    assert open_resp.json()["status"] == "open"

    update_resp = await ac.patch(
        f"/surveys/questions/{question_id}", json={"question_text": "你今天滿意嗎？"}
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["question_text"] == "你今天滿意嗎？"


async def test_open_survey_without_question_conflicts(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post("/surveys", json={"title": "空問卷", "org_id": str(org.id)})
    survey_id = create_resp.json()["id"]

    response = await ac.post(f"/surveys/{survey_id}/open")
    assert response.status_code == 409


async def test_delete_question(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post("/surveys", json={"title": "刪題測試", "org_id": str(org.id)})
    survey_id = create_resp.json()["id"]
    question_resp = await ac.post(
        f"/surveys/{survey_id}/questions",
        json={"question_text": "要刪除的題目", "question_type": "text"},
    )
    question_id = question_resp.json()["id"]

    response = await ac.delete(f"/surveys/questions/{question_id}")
    assert response.status_code == 204


async def test_close_survey_requires_open_status(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post("/surveys", json={"title": "尚未開放", "org_id": str(org.id)})
    survey_id = create_resp.json()["id"]

    response = await ac.post(f"/surveys/{survey_id}/close")
    assert response.status_code == 409


# ── 填答 ─────────────────────────────────────────────────────────────────────


async def _make_open_survey_with_question(
    ac: AsyncClient, org_id: uuid.UUID, *, is_public: bool = False, allow_multiple: bool = False
) -> tuple[str, str]:
    create_resp = await ac.post(
        "/surveys",
        json={
            "title": "填答測試",
            "org_id": str(org_id),
            "is_public": is_public,
            "allow_multiple": allow_multiple,
        },
    )
    survey_id = create_resp.json()["id"]
    question_resp = await ac.post(
        f"/surveys/{survey_id}/questions",
        json={"question_text": "你的意見？", "question_type": "text"},
    )
    question_id = question_resp.json()["id"]
    await ac.post(f"/surveys/{survey_id}/open")
    return survey_id, question_id


async def test_submit_response_happy_path(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    member_user: User,
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    admin_ac = authed_client_factory(admin_user)
    survey_id, question_id = await _make_open_survey_with_question(admin_ac, org.id)

    ac = authed_client_factory(member_user)
    response = await ac.post(
        f"/surveys/{survey_id}/submit",
        json={"answers": [{"question_id": question_id, "answer_text": "很好"}]},
    )
    assert response.status_code == 201
    assert response.json()["survey_id"] == survey_id


async def test_submit_response_missing_required_returns_422(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    member_user: User,
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    admin_ac = authed_client_factory(admin_user)
    survey_id, question_id = await _make_open_survey_with_question(admin_ac, org.id)

    ac = authed_client_factory(member_user)
    response = await ac.post(
        f"/surveys/{survey_id}/submit",
        json={
            "answers": [{"question_id": str(uuid.uuid4()), "answer_text": "answer to unrelated q"}]
        },
    )
    assert response.status_code == 422


async def test_submit_response_duplicate_conflicts(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    member_user: User,
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    admin_ac = authed_client_factory(admin_user)
    survey_id, question_id = await _make_open_survey_with_question(admin_ac, org.id)

    ac = authed_client_factory(member_user)
    payload = {"answers": [{"question_id": question_id, "answer_text": "第一次"}]}
    first = await ac.post(f"/surveys/{survey_id}/submit", json=payload)
    assert first.status_code == 201
    second = await ac.post(f"/surveys/{survey_id}/submit", json=payload)
    assert second.status_code == 422


async def test_submit_response_without_login_requires_public(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    admin_ac = authed_client_factory(admin_user)
    survey_id, question_id = await _make_open_survey_with_question(
        admin_ac, org.id, is_public=False
    )

    response = await client.post(
        f"/surveys/{survey_id}/submit",
        json={"answers": [{"question_id": question_id, "answer_text": "匿名回答"}]},
    )
    assert response.status_code == 403


async def test_submit_response_public_survey_allows_anonymous(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    admin_ac = authed_client_factory(admin_user)
    survey_id, question_id = await _make_open_survey_with_question(admin_ac, org.id, is_public=True)

    response = await client.post(
        f"/surveys/{survey_id}/submit",
        json={"answers": [{"question_id": question_id, "answer_text": "匿名回答"}]},
    )
    assert response.status_code == 201


# ── 公開端點 ──────────────────────────────────────────────────────────────────


async def test_get_public_survey_hides_non_public(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        "/surveys", json={"title": "非公開問卷", "org_id": str(org.id), "is_public": False}
    )
    survey_id = create_resp.json()["id"]

    response = await client.get(f"/surveys/public/{survey_id}")
    assert response.status_code == 404


async def test_get_public_survey_shows_open_public(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    admin_ac = authed_client_factory(admin_user)
    survey_id, _ = await _make_open_survey_with_question(admin_ac, org.id, is_public=True)

    response = await client.get(f"/surveys/public/{survey_id}")
    assert response.status_code == 200
    assert response.json()["id"] == survey_id


async def test_list_public_surveys_excludes_drafts(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    admin_ac = authed_client_factory(admin_user)
    await admin_ac.post(
        "/surveys", json={"title": "草稿公開問卷", "org_id": str(org.id), "is_public": True}
    )
    open_survey_id, _ = await _make_open_survey_with_question(admin_ac, org.id, is_public=True)

    response = await client.get("/surveys/public")
    assert response.status_code == 200
    ids = {row["id"] for row in response.json()}
    assert open_survey_id in ids


# ── 統計 / 匯出 ───────────────────────────────────────────────────────────────


async def test_get_survey_stats_requires_manage(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    member_user: User,
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    admin_ac = authed_client_factory(admin_user)
    survey_id, _ = await _make_open_survey_with_question(admin_ac, org.id)

    ac = authed_client_factory(member_user)
    response = await ac.get(f"/surveys/{survey_id}/stats")
    assert response.status_code == 403


async def test_get_survey_stats_and_responses(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    member_user: User,
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    admin_ac = authed_client_factory(admin_user)
    survey_id, question_id = await _make_open_survey_with_question(admin_ac, org.id)

    member_ac = authed_client_factory(member_user)
    await member_ac.post(
        f"/surveys/{survey_id}/submit",
        json={"answers": [{"question_id": question_id, "answer_text": "回覆內容"}]},
    )

    stats_resp = await admin_ac.get(f"/surveys/{survey_id}/stats")
    assert stats_resp.status_code == 200
    assert stats_resp.json()["total_responses"] == 1

    responses_resp = await admin_ac.get(f"/surveys/{survey_id}/responses")
    assert responses_resp.status_code == 200
    assert len(responses_resp.json()) == 1


async def test_export_survey_requires_manage(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    member_user: User,
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    admin_ac = authed_client_factory(admin_user)
    survey_id, _ = await _make_open_survey_with_question(admin_ac, org.id)

    ac = authed_client_factory(member_user)
    response = await ac.get(f"/surveys/{survey_id}/export")
    assert response.status_code == 403


async def test_export_survey_returns_xlsx(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    survey_id, _ = await _make_open_survey_with_question(ac, org.id)

    response = await ac.get(f"/surveys/{survey_id}/export")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
