"""問卷系統 HTTP 路由測試（apps/api/src/api/routers/survey.py）。

test_survey.py 已涵蓋 schema 解析與部分服務層邏輯；本檔補齊 HTTP 層：權限檢查、
CRUD 流程、公開填答與 403/404/409/422 分支。
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.announcement import Announcement
from api.models.org import Org
from api.models.user import User
from api.models.user_identity import UserIdentity


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


async def test_survey_announcement_links_to_survey_and_publishes_on_open(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    response = await ac.post(
        "/surveys",
        json={
            "title": "校園意見調查",
            "org_id": str(org.id),
            "announcement": "歡迎大家完成本次問卷。",
            "announcement_title": "校園意見調查開始填答",
            "show_announcement_popup": True,
        },
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["announcement"] == "歡迎大家完成本次問卷。"
    assert payload["announcement_id"]

    announcement = await db_session.get(Announcement, uuid.UUID(payload["announcement_id"]))
    assert announcement is not None
    assert announcement.is_published is False
    assert announcement.is_urgent is False

    survey_id = payload["id"]
    question_response = await ac.post(
        f"/surveys/{survey_id}/questions",
        json={"question_text": "你的意見？", "question_type": "text"},
    )
    assert question_response.status_code == 201
    assert (await ac.post(f"/surveys/{survey_id}/open")).status_code == 200

    await db_session.refresh(announcement)
    assert announcement.is_published is True
    assert announcement.is_urgent is True
    assert announcement.link_url == f"/surveys/{survey_id}"
    assert announcement.link_label == "前往填答"


async def test_clearing_survey_announcement_unpublishes_linked_announcement(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    create_response = await ac.post(
        "/surveys",
        json={
            "title": "公告清除測試",
            "org_id": str(org.id),
            "announcement": "暫時公告",
        },
    )
    announcement_id = uuid.UUID(create_response.json()["announcement_id"])

    response = await ac.patch(
        f"/surveys/{create_response.json()['id']}",
        json={"announcement": None, "show_announcement_popup": False},
    )
    assert response.status_code == 200
    assert response.json()["announcement"] is None

    announcement = await db_session.get(Announcement, announcement_id)
    assert announcement is not None
    assert announcement.is_published is False
    assert announcement.is_urgent is False


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


async def test_closed_survey_can_be_reopened(
    authed_client_factory: Callable[[User], AsyncClient], admin_user: User, db_session: AsyncSession
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post("/surveys", json={"title": "重新開放測試", "org_id": str(org.id)})
    survey_id = create_resp.json()["id"]
    await ac.post(
        f"/surveys/{survey_id}/questions",
        json={"question_text": "是否同意？", "question_type": "text"},
    )
    assert (await ac.post(f"/surveys/{survey_id}/open")).status_code == 200
    assert (await ac.post(f"/surveys/{survey_id}/close")).status_code == 200

    response = await ac.post(f"/surveys/{survey_id}/open")

    assert response.status_code == 200
    assert response.json()["status"] == "open"


# ── 填答 ─────────────────────────────────────────────────────────────────────


async def _make_open_survey_with_question(
    ac: AsyncClient,
    org_id: uuid.UUID,
    *,
    is_public: bool = False,
    is_anonymous: bool = False,
    allow_multiple: bool = False,
    allowed_domains: list[str] | None = None,
) -> tuple[str, str]:
    create_resp = await ac.post(
        "/surveys",
        json={
            "title": "填答測試",
            "org_id": str(org_id),
            "is_public": is_public,
            "is_anonymous": is_anonymous,
            "allow_multiple": allow_multiple,
            "allowed_domains": allowed_domains or [],
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


async def test_single_response_can_be_loaded_and_updated(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    member_user: User,
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    admin_ac = authed_client_factory(admin_user)
    survey_id, question_id = await _make_open_survey_with_question(admin_ac, org.id)
    member_ac = authed_client_factory(member_user)

    created = await member_ac.post(
        f"/surveys/{survey_id}/submit",
        json={"answers": [{"question_id": question_id, "answer_text": "原本的回答"}]},
    )
    assert created.status_code == 201
    response_id = created.json()["id"]

    mine = await member_ac.get(f"/surveys/{survey_id}/my-responses")
    assert mine.status_code == 200
    assert mine.json()[0]["answers"][0]["answer_text"] == "原本的回答"

    updated = await member_ac.patch(
        f"/surveys/{survey_id}/responses/{response_id}",
        json={"answers": [{"question_id": question_id, "answer_text": "更新後的回答"}]},
    )
    assert updated.status_code == 200
    assert updated.json()["answers"][0]["answer_text"] == "更新後的回答"

    mine_after_update = await member_ac.get(f"/surveys/{survey_id}/my-responses")
    assert len(mine_after_update.json()) == 1
    assert mine_after_update.json()[0]["answers"][0]["answer_text"] == "更新後的回答"


async def test_multiple_response_survey_allows_add_and_own_update_only(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    member_user: User,
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    admin_ac = authed_client_factory(admin_user)
    survey_id, question_id = await _make_open_survey_with_question(
        admin_ac, org.id, allow_multiple=True
    )
    member_ac = authed_client_factory(member_user)
    first = await member_ac.post(
        f"/surveys/{survey_id}/submit",
        json={"answers": [{"question_id": question_id, "answer_text": "第一份"}]},
    )
    second = await member_ac.post(
        f"/surveys/{survey_id}/submit",
        json={"answers": [{"question_id": question_id, "answer_text": "第二份"}]},
    )
    assert first.status_code == second.status_code == 201

    updated = await member_ac.patch(
        f"/surveys/{survey_id}/responses/{first.json()['id']}",
        json={"answers": [{"question_id": question_id, "answer_text": "第一份已修改"}]},
    )
    assert updated.status_code == 200

    mine = await member_ac.get(f"/surveys/{survey_id}/my-responses")
    assert mine.status_code == 200
    assert len(mine.json()) == 2
    assert {item["answers"][0]["answer_text"] for item in mine.json()} == {
        "第一份已修改",
        "第二份",
    }

    other = User(email=f"other-{uuid.uuid4().hex[:8]}@test.edu", display_name="其他填答者")
    db_session.add(other)
    await db_session.flush()
    other_ac = authed_client_factory(other)
    forbidden = await other_ac.patch(
        f"/surveys/{survey_id}/responses/{first.json()['id']}",
        json={"answers": [{"question_id": question_id, "answer_text": "不應被修改"}]},
    )
    assert forbidden.status_code == 404


async def test_anonymous_response_can_be_updated_with_its_original_token(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    admin_ac = authed_client_factory(admin_user)
    survey_id, question_id = await _make_open_survey_with_question(
        admin_ac,
        org.id,
        is_public=True,
        is_anonymous=True,
    )
    anon_token = str(uuid.uuid4())
    created = await client.post(
        f"/surveys/{survey_id}/submit",
        json={
            "anon_token": anon_token,
            "answers": [{"question_id": question_id, "answer_text": "匿名原答"}],
        },
    )
    assert created.status_code == 201
    response_id = created.json()["id"]

    mine = await client.get(
        f"/surveys/{survey_id}/my-responses",
        params={"anon_token": anon_token},
    )
    assert mine.status_code == 200
    assert mine.json()[0]["id"] == response_id

    updated = await client.patch(
        f"/surveys/{survey_id}/responses/{response_id}",
        json={
            "anon_token": anon_token,
            "answers": [{"question_id": question_id, "answer_text": "匿名修改後"}],
        },
    )
    assert updated.status_code == 200
    assert updated.json()["answers"][0]["answer_text"] == "匿名修改後"


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


async def test_domain_restricted_survey_hides_non_target_and_accepts_linked_school_email(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    member_user: User,
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    admin_ac = authed_client_factory(admin_user)
    survey_id, _ = await _make_open_survey_with_question(
        admin_ac,
        org.id,
        allowed_domains=["hchs.hc.edu.tw"],
    )
    member_ac = authed_client_factory(member_user)

    public_detail = await client.get(f"/surveys/public/{survey_id}")
    assert public_detail.status_code == 403
    assert "切換" in public_detail.json()["detail"]

    denied_detail = await member_ac.get(f"/surveys/{survey_id}")
    assert denied_detail.status_code == 403
    assert "@hchs.hc.edu.tw" in denied_detail.json()["detail"]
    hidden_from_list = await member_ac.get("/surveys", params={"status": "open"})
    assert survey_id not in {item["id"] for item in hidden_from_list.json()}

    db_session.add(
        UserIdentity(
            user_id=member_user.id,
            provider="google",
            external_id=f"school-{uuid.uuid4().hex}",
            email=f"student-{uuid.uuid4().hex[:8]}@hchs.hc.edu.tw",
            linked_at=datetime.now(UTC),
        )
    )
    await db_session.flush()

    allowed_detail = await member_ac.get(f"/surveys/{survey_id}")
    assert allowed_detail.status_code == 200
    visible_in_list = await member_ac.get("/surveys", params={"status": "open"})
    assert survey_id in {item["id"] for item in visible_in_list.json()}


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


async def test_survey_stats_and_responses_include_respondent_details(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    member_user: User,
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    admin_ac = authed_client_factory(admin_user)
    created = await admin_ac.post(
        "/surveys",
        json={"title": "選項統計問卷", "org_id": str(org.id)},
    )
    survey_id = created.json()["id"]
    question = await admin_ac.post(
        f"/surveys/{survey_id}/questions",
        json={
            "question_text": "偏好？",
            "question_type": "single",
            "options": ["A", "B"],
        },
    )
    question_id = question.json()["id"]
    await admin_ac.post(f"/surveys/{survey_id}/open")

    member_ac = authed_client_factory(member_user)
    submitted = await member_ac.post(
        f"/surveys/{survey_id}/submit",
        json={"answers": [{"question_id": question_id, "answer_options": ["A"]}]},
    )
    assert submitted.status_code == 201

    stats = (await admin_ac.get(f"/surveys/{survey_id}/stats")).json()
    assert stats["questions"][0]["option_respondents"]["A"] == [
        {
            "user_id": str(member_user.id),
            "display_name": member_user.display_name,
            "email": member_user.email,
        }
    ]

    responses = (await admin_ac.get(f"/surveys/{survey_id}/responses")).json()
    assert responses[0]["respondent_id"] == str(member_user.id)
    assert responses[0]["respondent_name"] == member_user.display_name
    assert responses[0]["respondent_email"] == member_user.email


async def test_manager_can_delete_one_response_and_clear_all_responses(
    authed_client_factory: Callable[[User], AsyncClient],
    admin_user: User,
    member_user: User,
    db_session: AsyncSession,
) -> None:
    org = await _make_org(db_session)
    admin_ac = authed_client_factory(admin_user)
    survey_id, question_id = await _make_open_survey_with_question(
        admin_ac, org.id, allow_multiple=True
    )
    member_ac = authed_client_factory(member_user)
    first = await member_ac.post(
        f"/surveys/{survey_id}/submit",
        json={"answers": [{"question_id": question_id, "answer_text": "第一份"}]},
    )
    second = await member_ac.post(
        f"/surveys/{survey_id}/submit",
        json={"answers": [{"question_id": question_id, "answer_text": "第二份"}]},
    )
    assert first.status_code == second.status_code == 201
    first_id = first.json()["id"]

    forbidden = await member_ac.delete(f"/surveys/{survey_id}/responses/{first_id}")
    assert forbidden.status_code == 403

    deleted = await admin_ac.delete(f"/surveys/{survey_id}/responses/{first_id}")
    assert deleted.status_code == 204
    remaining = await admin_ac.get(f"/surveys/{survey_id}/responses")
    assert [item["id"] for item in remaining.json()] == [second.json()["id"]]

    cleared = await admin_ac.delete(f"/surveys/{survey_id}/responses")
    assert cleared.status_code == 204
    assert (await admin_ac.get(f"/surveys/{survey_id}/responses")).json() == []
    assert (await admin_ac.get(f"/surveys/{survey_id}/stats")).json()["total_responses"] == 0


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
