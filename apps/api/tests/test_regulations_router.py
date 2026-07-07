"""法規系統 Router 測試 — CRUD／條文管理／審議流程（含會議綁定）／全文搜尋。"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.models.meeting import Meeting, MeetingAgendaItem
from api.models.org import Org, Permission, Position, UserPosition
from api.models.regulation import (
    ArticleType,
    Regulation,
    RegulationArticle,
    RegulationCategory,
    RegulationWorkflowStatus,
)
from api.models.user import User

pytestmark = pytest.mark.asyncio


# ── 共用建構輔助 ───────────────────────────────────────────────────────────────


async def _grant_permission(
    db: AsyncSession, user: User, org: Org, code: str, *, position_name: str = "職位"
) -> None:
    position = Position(org_id=org.id, name=position_name)
    db.add(position)
    await db.flush()
    db.add(Permission(position_id=position.id, code=code))
    today = local_today()
    db.add(
        UserPosition(
            user_id=user.id,
            position_id=position.id,
            start_date=today - timedelta(days=10),
            end_date=None,
        )
    )
    await db.flush()


async def _make_org(db: AsyncSession, **overrides: object) -> Org:
    defaults: dict = {"name": f"法規測試組織-{uuid.uuid4().hex[:6]}"}
    defaults.update(overrides)
    org = Org(**defaults)
    db.add(org)
    await db.flush()
    return org


async def _make_regulation(
    db: AsyncSession, org: Org, creator: User, **overrides: object
) -> Regulation:
    defaults: dict = {
        "title": f"測試法規-{uuid.uuid4().hex[:8]}",
        "category": RegulationCategory.ORDINANCE,
        "content": "",
        "org_id": org.id,
        "created_by": creator.id,
        "version": 1,
        "is_active": True,
        "workflow_status": RegulationWorkflowStatus.DRAFT,
    }
    defaults.update(overrides)
    reg = Regulation(**defaults)
    db.add(reg)
    await db.flush()
    return reg


async def _make_meeting_with_agenda(
    db: AsyncSession, org: Org, creator: User, reg: Regulation
) -> Meeting:
    """建立一場已將 reg 排入議程的會議（審議流程動作須綁定此類會議）。"""
    meeting = Meeting(
        org_id=org.id,
        title=f"測試會議-{uuid.uuid4().hex[:6]}",
        created_by=creator.id,
        screen_token=uuid.uuid4().hex,
        checkin_token=uuid.uuid4().hex,
    )
    db.add(meeting)
    await db.flush()
    agenda_item = MeetingAgendaItem(
        meeting_id=meeting.id,
        title=reg.title,
        item_type="regulation",
        regulation_id=reg.id,
    )
    db.add(agenda_item)
    await db.flush()
    return meeting


# ── CRUD ───────────────────────────────────────────────────────────────────


async def test_create_regulation_with_permission_succeeds(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="creator@school.edu")
    await _grant_permission(db_session, user, org, "regulation:create")

    ac = authed_client_factory(user)
    resp = await ac.post(
        "/regulations",
        json={
            "title": "學生會組織法",
            "category": "ordinance",
            "org_id": str(org.id),
        },
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["title"] == "學生會組織法"
    assert body["workflow_status"] == "draft"
    assert body["version"] == 1


async def test_create_regulation_without_permission_returns_403(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="stranger@school.edu")

    ac = authed_client_factory(user)
    resp = await ac.post(
        "/regulations",
        json={"title": "無權限法規", "category": "ordinance", "org_id": str(org.id)},
    )

    assert resp.status_code == 403


async def test_get_draft_regulation_anonymous_returns_404(
    db_session: AsyncSession, client, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="draft-owner@school.edu")
    reg = await _make_regulation(db_session, org, creator)

    resp = await client.get(f"/regulations/{reg.id}")

    assert resp.status_code == 404


async def test_get_published_regulation_anonymous_returns_200(
    db_session: AsyncSession, client, make_user
) -> None:
    from datetime import UTC, datetime

    org = await _make_org(db_session)
    creator = await make_user(email="pub-owner@school.edu")
    reg = await _make_regulation(
        db_session,
        org,
        creator,
        workflow_status=RegulationWorkflowStatus.PUBLISHED,
        published_at=datetime.now(UTC),
    )

    resp = await client.get(f"/regulations/{reg.id}")

    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == str(reg.id)


async def test_list_regulations_anonymous_excludes_drafts(
    db_session: AsyncSession, client, make_user
) -> None:
    from datetime import UTC, datetime

    org = await _make_org(db_session)
    creator = await make_user(email="list-owner@school.edu")
    published = await _make_regulation(
        db_session,
        org,
        creator,
        title=f"已公布法規-{uuid.uuid4().hex[:6]}",
        workflow_status=RegulationWorkflowStatus.PUBLISHED,
        published_at=datetime.now(UTC),
    )
    await _make_regulation(db_session, org, creator, title=f"草稿法規-{uuid.uuid4().hex[:6]}")

    resp = await client.get("/regulations", params={"org_id": str(org.id)})

    assert resp.status_code == 200, resp.text
    ids = {row["id"] for row in resp.json()}
    assert str(published.id) in ids
    assert len(resp.json()) == 1


async def test_list_regulations_keyword_full_text_search_matches_title(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    """驗證全文搜尋 trigger（search_vector）確實由 DB 自動維護並可被查詢命中。"""
    org = await _make_org(db_session)
    user = await make_user(email="fts-user@school.edu")
    unique_word = f"UniqueKeyword{uuid.uuid4().hex[:8]}"
    await _make_regulation(db_session, org, user, title=unique_word)

    ac = authed_client_factory(user)
    resp = await ac.get("/regulations", params={"keyword": unique_word})

    assert resp.status_code == 200, resp.text
    titles = [row["title"] for row in resp.json()]
    assert unique_word in titles


async def test_search_regulations_endpoint_matches_content(
    db_session: AsyncSession, client, make_user
) -> None:
    from datetime import UTC, datetime

    org = await _make_org(db_session)
    creator = await make_user(email="search-owner@school.edu")
    needle = f"特殊搜尋詞{uuid.uuid4().hex[:6]}"
    reg = await _make_regulation(
        db_session,
        org,
        creator,
        content=f"本法規內容包含{needle}供搜尋測試。",
        workflow_status=RegulationWorkflowStatus.PUBLISHED,
        published_at=datetime.now(UTC),
    )

    resp = await client.get("/regulations/search", params={"keyword": needle})

    assert resp.status_code == 200, resp.text
    ids = {row["id"] for row in resp.json()}
    assert str(reg.id) in ids


async def test_update_regulation_by_creator_increments_version_and_creates_revision(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="update-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:edit")
    reg = await _make_regulation(db_session, org, creator)

    ac = authed_client_factory(creator)
    resp = await ac.patch(
        f"/regulations/{reg.id}",
        json={"content": "第一條 本法予以制定。", "change_brief": "初次修訂"},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["version"] == 2
    assert len(body["revisions"]) == 1
    assert body["revisions"][0]["change_brief"] == "初次修訂"


async def test_update_regulation_autosave_does_not_increment_version(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="autosave-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:edit")
    reg = await _make_regulation(db_session, org, creator)

    ac = authed_client_factory(creator)
    resp = await ac.patch(
        f"/regulations/{reg.id}",
        json={"content": "草稿自動儲存內容", "autosave": True},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["version"] == 1
    assert body["revisions"] == []


async def test_update_regulation_by_noncreator_returns_403(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="real-owner@school.edu")
    other = await make_user(email="other-editor@school.edu")
    await _grant_permission(db_session, other, org, "regulation:edit")
    reg = await _make_regulation(db_session, org, creator)

    ac = authed_client_factory(other)
    resp = await ac.patch(f"/regulations/{reg.id}", json={"title": "篡改標題"})

    assert resp.status_code == 403


async def test_update_regulation_when_under_review_returns_409(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="under-review-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:edit")
    reg = await _make_regulation(
        db_session, org, creator, workflow_status=RegulationWorkflowStatus.UNDER_REVIEW
    )

    ac = authed_client_factory(creator)
    resp = await ac.patch(f"/regulations/{reg.id}", json={"title": "審查中不可編輯"})

    assert resp.status_code == 409


async def test_fork_draft_from_regulation_creates_new_draft_with_copied_articles(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    from datetime import UTC, datetime

    org = await _make_org(db_session)
    creator = await make_user(email="fork-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:create")
    reg = await _make_regulation(
        db_session,
        org,
        creator,
        workflow_status=RegulationWorkflowStatus.PUBLISHED,
        published_at=datetime.now(UTC),
    )
    db_session.add(
        RegulationArticle(
            regulation_id=reg.id,
            sort_index=10,
            article_type=ArticleType.ARTICLE,
            legal_number="1",
            content="本法規定如下。",
        )
    )
    await db_session.flush()

    ac = authed_client_factory(creator)
    resp = await ac.post(f"/regulations/{reg.id}/fork_draft")

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["workflow_status"] == "draft"
    assert body["source_regulation_id"] == str(reg.id)
    assert body["amendment_type"] == "amend"
    assert len(body["articles"]) == 1


async def test_delete_draft_regulation_succeeds(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="delete-owner@school.edu")
    reg = await _make_regulation(db_session, org, creator)

    ac = authed_client_factory(creator)
    resp = await ac.delete(f"/regulations/{reg.id}")

    assert resp.status_code == 204, resp.text
    follow_up = await ac.get(f"/regulations/{reg.id}")
    assert follow_up.status_code == 404


async def test_delete_published_regulation_returns_409(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    from datetime import UTC, datetime

    org = await _make_org(db_session)
    creator = await make_user(email="delete-pub-owner@school.edu")
    reg = await _make_regulation(
        db_session,
        org,
        creator,
        workflow_status=RegulationWorkflowStatus.PUBLISHED,
        published_at=datetime.now(UTC),
    )

    ac = authed_client_factory(creator)
    resp = await ac.delete(f"/regulations/{reg.id}")

    assert resp.status_code == 409


# ── 停用／廢止 ─────────────────────────────────────────────────────────────


async def test_archive_regulation_succeeds(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="archive-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:archive")
    reg = await _make_regulation(db_session, org, creator)

    ac = authed_client_factory(creator)
    resp = await ac.post(f"/regulations/{reg.id}/archive")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_active"] is False
    assert body["workflow_status"] == "archived"


async def test_archive_regulation_without_permission_returns_403(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="archive-stranger-owner@school.edu")
    stranger = await make_user(email="archive-stranger@school.edu")
    reg = await _make_regulation(db_session, org, creator)

    ac = authed_client_factory(stranger)
    resp = await ac.post(f"/regulations/{reg.id}/archive")

    assert resp.status_code == 403


async def test_repeal_regulation_succeeds(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="repeal-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:publish")
    reg = await _make_regulation(db_session, org, creator)

    ac = authed_client_factory(creator)
    resp = await ac.post(f"/regulations/{reg.id}/repeal", json={"reason": "已無適用必要"})

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_repealed"] is True
    assert body["repeal_reason"] == "已無適用必要"


async def test_repeal_already_repealed_regulation_returns_409(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    from datetime import UTC, datetime

    org = await _make_org(db_session)
    creator = await make_user(email="repeal-twice-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:publish")
    reg = await _make_regulation(
        db_session,
        org,
        creator,
        is_repealed=True,
        repealed_date=datetime.now(UTC),
        repeal_reason="舊原因",
        is_active=False,
    )

    ac = authed_client_factory(creator)
    resp = await ac.post(f"/regulations/{reg.id}/repeal", json={"reason": "再次廢止"})

    assert resp.status_code == 409


async def test_publish_endpoint_is_disabled_returns_409(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    """/publish 端點已停用，一律應改用 president_publish 流程。"""
    org = await _make_org(db_session)
    creator = await make_user(email="disabled-publish-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:publish")
    reg = await _make_regulation(db_session, org, creator)

    ac = authed_client_factory(creator)
    resp = await ac.post(f"/regulations/{reg.id}/publish", json={"change_brief": "初次發布"})

    assert resp.status_code == 409


# ── 條文管理 ─────────────────────────────────────────────────────────────


async def test_add_article_by_creator_succeeds(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="article-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:edit")
    reg = await _make_regulation(db_session, org, creator)

    ac = authed_client_factory(creator)
    resp = await ac.post(
        f"/regulations/{reg.id}/articles",
        json={
            "sort_index": 10,
            "article_type": "article",
            "legal_number": "1",
            "content": "本法依規定制定之。",
        },
    )

    assert resp.status_code == 201, resp.text
    assert resp.json()["legal_number"] == "1"


async def test_add_article_by_noncreator_returns_403(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="article-real-owner@school.edu")
    other = await make_user(email="article-other-editor@school.edu")
    await _grant_permission(db_session, other, org, "regulation:edit")
    reg = await _make_regulation(db_session, org, creator)

    ac = authed_client_factory(other)
    resp = await ac.post(
        f"/regulations/{reg.id}/articles",
        json={"sort_index": 10, "article_type": "article", "content": "測試"},
    )

    assert resp.status_code == 403


async def test_update_article_succeeds(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="article-update-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:edit")
    reg = await _make_regulation(db_session, org, creator)
    article = RegulationArticle(
        regulation_id=reg.id,
        sort_index=10,
        article_type=ArticleType.ARTICLE,
        legal_number="1",
        content="舊內容",
    )
    db_session.add(article)
    await db_session.flush()

    ac = authed_client_factory(creator)
    resp = await ac.patch(
        f"/regulations/{reg.id}/articles/{article.id}",
        json={"content": "新內容"},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["content"] == "新內容"


async def test_delete_article_soft_deletes_by_default(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="article-delete-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:edit")
    reg = await _make_regulation(db_session, org, creator)
    article = RegulationArticle(
        regulation_id=reg.id,
        sort_index=10,
        article_type=ArticleType.ARTICLE,
        legal_number="1",
        content="待刪除內容",
    )
    db_session.add(article)
    await db_session.flush()

    ac = authed_client_factory(creator)
    resp = await ac.delete(f"/regulations/{reg.id}/articles/{article.id}")

    assert resp.status_code == 204, resp.text
    listing = await ac.get(f"/regulations/{reg.id}/articles")
    assert listing.json() == []
    listing_with_deleted = await ac.get(
        f"/regulations/{reg.id}/articles", params={"include_deleted": True}
    )
    assert len(listing_with_deleted.json()) == 1
    assert listing_with_deleted.json()[0]["is_deleted"] is True


async def test_reorder_articles_succeeds(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="reorder-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:edit")
    reg = await _make_regulation(db_session, org, creator)
    a1 = RegulationArticle(
        regulation_id=reg.id, sort_index=10, article_type=ArticleType.ARTICLE, legal_number="1"
    )
    a2 = RegulationArticle(
        regulation_id=reg.id, sort_index=20, article_type=ArticleType.ARTICLE, legal_number="2"
    )
    db_session.add_all([a1, a2])
    await db_session.flush()

    ac = authed_client_factory(creator)
    resp = await ac.put(
        f"/regulations/{reg.id}/articles/reorder",
        json={"items": [{"id": str(a1.id), "sort_index": 30}, {"id": str(a2.id), "sort_index": 5}]},
    )

    assert resp.status_code == 200, resp.text
    ordered = resp.json()
    assert ordered[0]["id"] == str(a2.id)
    assert ordered[1]["id"] == str(a1.id)


async def test_auto_renumber_articles_skips_special_numbers_by_default(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="renumber-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:edit")
    reg = await _make_regulation(db_session, org, creator)
    a1 = RegulationArticle(
        regulation_id=reg.id, sort_index=10, article_type=ArticleType.ARTICLE, legal_number="5-1"
    )
    a2 = RegulationArticle(
        regulation_id=reg.id, sort_index=20, article_type=ArticleType.ARTICLE, legal_number="9"
    )
    db_session.add_all([a1, a2])
    await db_session.flush()

    ac = authed_client_factory(creator)
    resp = await ac.post(f"/regulations/{reg.id}/articles/auto-renumber", json={})

    assert resp.status_code == 200, resp.text
    by_id = {row["id"]: row for row in resp.json()}
    assert by_id[str(a1.id)]["legal_number"] == "5-1"
    assert by_id[str(a2.id)]["legal_number"] == "1"


async def test_get_article_tree_returns_nested_structure(
    db_session: AsyncSession, client, make_user
) -> None:
    from datetime import UTC, datetime

    org = await _make_org(db_session)
    creator = await make_user(email="tree-owner@school.edu")
    reg = await _make_regulation(
        db_session,
        org,
        creator,
        workflow_status=RegulationWorkflowStatus.PUBLISHED,
        published_at=datetime.now(UTC),
    )
    chapter = RegulationArticle(
        regulation_id=reg.id, sort_index=10, article_type=ArticleType.CHAPTER, title="總則"
    )
    db_session.add(chapter)
    await db_session.flush()
    article = RegulationArticle(
        regulation_id=reg.id,
        sort_index=20,
        article_type=ArticleType.ARTICLE,
        legal_number="1",
        parent_id=chapter.id,
    )
    db_session.add(article)
    await db_session.flush()

    resp = await client.get(f"/regulations/{reg.id}/tree")

    assert resp.status_code == 200, resp.text
    tree = resp.json()
    assert len(tree) == 1
    assert tree[0]["id"] == str(chapter.id)
    assert len(tree[0]["children"]) == 1
    assert tree[0]["children"][0]["id"] == str(article.id)


async def test_structure_regulation_content_parses_full_text_into_articles(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="structure-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:edit")
    reg = await _make_regulation(db_session, org, creator, content="第一條 本法予以制定。")

    ac = authed_client_factory(creator)
    resp = await ac.post(f"/regulations/{reg.id}/structure-content", json={})

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["articles"]) >= 1
    assert body["articles"][0]["article_type"] == "article"


# ── 審議流程（會議綁定）────────────────────────────────────────────────────


async def test_submit_regulation_transitions_to_under_review(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="submit-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:submit")
    reg = await _make_regulation(db_session, org, creator)

    ac = authed_client_factory(creator)
    resp = await ac.post(f"/regulations/{reg.id}/submit", json={})

    assert resp.status_code == 200, resp.text
    assert resp.json()["workflow_status"] == "under_review"


async def test_submit_regulation_without_permission_returns_403(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="submit-stranger-owner@school.edu")
    stranger = await make_user(email="submit-stranger@school.edu")
    reg = await _make_regulation(db_session, org, creator)

    ac = authed_client_factory(stranger)
    resp = await ac.post(f"/regulations/{reg.id}/submit", json={})

    assert resp.status_code == 403


async def test_schedule_without_meeting_id_returns_422(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    """業務鐵律：排入議程必須綁會議，不可直接按鈕轉移。"""
    org = await _make_org(db_session)
    creator = await make_user(email="schedule-no-meeting-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:schedule")
    reg = await _make_regulation(
        db_session, org, creator, workflow_status=RegulationWorkflowStatus.UNDER_REVIEW
    )

    ac = authed_client_factory(creator)
    resp = await ac.post(f"/regulations/{reg.id}/schedule", json={})

    assert resp.status_code == 422
    assert reg.workflow_status == RegulationWorkflowStatus.UNDER_REVIEW


async def test_schedule_with_meeting_missing_agenda_item_returns_422(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    """會議存在但法案尚未排入該會議議程時，仍不可推進流程。"""
    org = await _make_org(db_session)
    creator = await make_user(email="schedule-no-agenda-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:schedule")
    reg = await _make_regulation(
        db_session, org, creator, workflow_status=RegulationWorkflowStatus.UNDER_REVIEW
    )
    meeting = Meeting(
        org_id=org.id,
        title="無議程會議",
        created_by=creator.id,
        screen_token=uuid.uuid4().hex,
        checkin_token=uuid.uuid4().hex,
    )
    db_session.add(meeting)
    await db_session.flush()

    ac = authed_client_factory(creator)
    resp = await ac.post(f"/regulations/{reg.id}/schedule", json={"meeting_id": str(meeting.id)})

    assert resp.status_code == 422


async def test_schedule_with_valid_agenda_item_succeeds(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="schedule-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:schedule")
    reg = await _make_regulation(
        db_session, org, creator, workflow_status=RegulationWorkflowStatus.UNDER_REVIEW
    )
    meeting = await _make_meeting_with_agenda(db_session, org, creator, reg)

    ac = authed_client_factory(creator)
    resp = await ac.post(f"/regulations/{reg.id}/schedule", json={"meeting_id": str(meeting.id)})

    assert resp.status_code == 200, resp.text
    assert resp.json()["workflow_status"] == "scheduled"


async def test_council_approve_with_valid_agenda_item_succeeds(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="council-approve-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:council_approve")
    reg = await _make_regulation(
        db_session, org, creator, workflow_status=RegulationWorkflowStatus.SCHEDULED
    )
    meeting = await _make_meeting_with_agenda(db_session, org, creator, reg)

    ac = authed_client_factory(creator)
    resp = await ac.post(
        f"/regulations/{reg.id}/council_approve", json={"meeting_id": str(meeting.id)}
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["workflow_status"] == "council_approved"


async def test_president_publish_with_manual_serial_succeeds(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="president-publish-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:president_publish")
    reg = await _make_regulation(
        db_session, org, creator, workflow_status=RegulationWorkflowStatus.COUNCIL_APPROVED
    )
    db_session.add(
        RegulationArticle(
            regulation_id=reg.id,
            sort_index=10,
            article_type=ArticleType.ARTICLE,
            legal_number="1",
            content="本法予以制定。",
        )
    )
    await db_session.flush()

    ac = authed_client_factory(creator)
    resp = await ac.post(
        f"/regulations/{reg.id}/president_publish",
        json={"note": "第一條", "manual_serial_number": f"測發字第{uuid.uuid4().hex[:6]}號"},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["workflow_status"] == "published"
    assert body["published_document_id"] is not None
    assert len(body["revisions"]) == 1


async def test_reject_requires_note_returns_422(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="reject-no-note-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:submit")
    reg = await _make_regulation(
        db_session, org, creator, workflow_status=RegulationWorkflowStatus.UNDER_REVIEW
    )

    ac = authed_client_factory(creator)
    resp = await ac.post(f"/regulations/{reg.id}/reject", json={})

    assert resp.status_code == 422


async def test_reject_with_note_succeeds(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="reject-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:submit")
    reg = await _make_regulation(
        db_session, org, creator, workflow_status=RegulationWorkflowStatus.UNDER_REVIEW
    )

    ac = authed_client_factory(creator)
    resp = await ac.post(f"/regulations/{reg.id}/reject", json={"note": "格式不符，請重新提送"})

    assert resp.status_code == 200, resp.text
    assert resp.json()["workflow_status"] == "rejected"


async def test_revise_returns_regulation_to_draft(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="revise-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:revise")
    reg = await _make_regulation(
        db_session, org, creator, workflow_status=RegulationWorkflowStatus.UNDER_REVIEW
    )

    ac = authed_client_factory(creator)
    resp = await ac.post(f"/regulations/{reg.id}/revise", json={"note": "需再修正"})

    assert resp.status_code == 200, resp.text
    assert resp.json()["workflow_status"] == "draft"


async def test_get_workflow_logs_returns_history(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="workflow-log-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:submit")
    reg = await _make_regulation(db_session, org, creator)

    ac = authed_client_factory(creator)
    submit_resp = await ac.post(f"/regulations/{reg.id}/submit", json={})
    assert submit_resp.status_code == 200

    resp = await ac.get(f"/regulations/{reg.id}/workflow_logs")

    assert resp.status_code == 200, resp.text
    logs = resp.json()
    assert len(logs) == 1
    assert logs[0]["to_status"] == "under_review"


async def test_get_workflow_logs_anonymous_returns_404(
    db_session: AsyncSession, client, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="workflow-log-anon-owner@school.edu")
    reg = await _make_regulation(db_session, org, creator)

    resp = await client.get(f"/regulations/{reg.id}/workflow_logs")

    assert resp.status_code == 404


async def test_list_eligible_meetings_returns_meeting_with_agenda_item(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="eligible-meetings-owner@school.edu")
    reg = await _make_regulation(db_session, org, creator)
    meeting = await _make_meeting_with_agenda(db_session, org, creator, reg)

    ac = authed_client_factory(creator)
    resp = await ac.get(f"/regulations/{reg.id}/eligible-meetings")

    assert resp.status_code == 200, resp.text
    ids = {row["id"] for row in resp.json()}
    assert str(meeting.id) in ids


# ── 修正對照／參照檢查／Time Machine／Diff ─────────────────────────────────


async def test_amendment_comparison_flags_new_article(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="comparison-owner@school.edu")
    reg = await _make_regulation(db_session, org, creator)
    db_session.add(
        RegulationArticle(
            regulation_id=reg.id,
            sort_index=10,
            article_type=ArticleType.ARTICLE,
            legal_number="1",
            content="新增條文內容",
        )
    )
    await db_session.flush()

    ac = authed_client_factory(creator)
    resp = await ac.get(f"/regulations/{reg.id}/amendment-comparison")

    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["status"] == "新增"


async def test_amendment_comparison_anonymous_returns_404(
    db_session: AsyncSession, client, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="comparison-anon-owner@school.edu")
    reg = await _make_regulation(db_session, org, creator)

    resp = await client.get(f"/regulations/{reg.id}/amendment-comparison")

    assert resp.status_code == 404


async def test_reference_warnings_flags_dangling_reference(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="reference-owner@school.edu")
    reg = await _make_regulation(db_session, org, creator)
    db_session.add(
        RegulationArticle(
            regulation_id=reg.id,
            sort_index=10,
            article_type=ArticleType.ARTICLE,
            legal_number="1",
            content="準用第 99 條之規定。",
        )
    )
    await db_session.flush()

    ac = authed_client_factory(creator)
    resp = await ac.get(f"/regulations/{reg.id}/reference-warnings")

    assert resp.status_code == 200, resp.text
    warnings = resp.json()
    assert len(warnings) == 1
    assert warnings[0]["referenced_legal_number"] == "99"


async def test_time_machine_returns_snapshot_at_given_time(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    from datetime import UTC, datetime

    from api.models.regulation import RegulationRevision

    org = await _make_org(db_session)
    creator = await make_user(email="time-machine-owner@school.edu")
    reg = await _make_regulation(db_session, org, creator)
    amended_at = datetime.now(UTC)
    db_session.add(
        RegulationRevision(
            regulation_id=reg.id,
            version=1,
            change_brief="初始版本",
            content_snapshot="舊版內容",
            article_snapshot="[]",
            amended_at=amended_at,
            amended_by=creator.id,
        )
    )
    await db_session.flush()

    ac = authed_client_factory(creator)
    resp = await ac.get(
        f"/regulations/{reg.id}/time-machine",
        params={"as_of": (amended_at + timedelta(minutes=1)).isoformat()},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["version"] == 1


async def test_regulation_diff_reports_line_changes(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    from datetime import UTC, datetime

    from api.models.regulation import RegulationRevision

    org = await _make_org(db_session)
    creator = await make_user(email="diff-owner@school.edu")
    reg = await _make_regulation(db_session, org, creator)
    now = datetime.now(UTC)
    db_session.add_all(
        [
            RegulationRevision(
                regulation_id=reg.id,
                version=1,
                change_brief="初版",
                content_snapshot="第一條 舊內容\n",
                article_snapshot="[]",
                amended_at=now,
                amended_by=creator.id,
            ),
            RegulationRevision(
                regulation_id=reg.id,
                version=2,
                change_brief="修正",
                content_snapshot="第一條 新內容\n",
                article_snapshot="[]",
                amended_at=now + timedelta(minutes=1),
                amended_by=creator.id,
            ),
        ]
    )
    await db_session.flush()

    ac = authed_client_factory(creator)
    resp = await ac.post(f"/regulations/{reg.id}/diff", params={"from_version": 1, "to_version": 2})

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "舊內容" in body["unified_diff"]
    assert "新內容" in body["unified_diff"]


# ── 凍結／解凍 ─────────────────────────────────────────────────────────────


async def test_freeze_and_unfreeze_regulation(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="freeze-owner@school.edu")
    await _grant_permission(db_session, creator, org, "regulation:archive")
    reg = await _make_regulation(db_session, org, creator)

    ac = authed_client_factory(creator)
    freeze_resp = await ac.post(f"/regulations/{reg.id}/freeze", json={"reason": "爭議待釐清"})
    assert freeze_resp.status_code == 200, freeze_resp.text
    assert freeze_resp.json()["freeze_reason"] == "爭議待釐清"

    unfreeze_resp = await ac.post(f"/regulations/{reg.id}/unfreeze")
    assert unfreeze_resp.status_code == 200, unfreeze_resp.text
    assert unfreeze_resp.json()["freeze_reason"] is None


async def test_freeze_regulation_without_permission_returns_403(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="freeze-stranger-owner@school.edu")
    stranger = await make_user(email="freeze-stranger@school.edu")
    reg = await _make_regulation(db_session, org, creator)

    ac = authed_client_factory(stranger)
    resp = await ac.post(f"/regulations/{reg.id}/freeze", json={"reason": "測試"})

    assert resp.status_code == 403


# ── 匯入 ───────────────────────────────────────────────────────────────────


def _build_docx(lines: list[str]) -> bytes:
    from io import BytesIO
    from zipfile import ZipFile

    body = "".join(f"<w:p><w:r><w:t>{line}</w:t></w:r></w:p>" for line in lines)
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body>"
        "</w:document>"
    )
    buf = BytesIO()
    with ZipFile(buf, "w") as docx:
        docx.writestr("word/document.xml", document_xml)
    return buf.getvalue()


async def test_import_regulation_docx_creates_regulation_with_articles(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="import-docx-owner@school.edu")
    await _grant_permission(db_session, user, org, "regulation:create")
    raw = _build_docx(
        [
            "測試匯入法規",
            "第一條 本法予以制定。",
        ]
    )

    ac = authed_client_factory(user)
    resp = await ac.post(
        "/regulations/import-docx",
        data={"org_id": str(org.id), "category": "ordinance"},
        files={
            "file": (
                "測試.docx",
                raw,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["title"] == "測試匯入法規"
    assert len(body["articles"]) == 1


async def test_import_regulation_docx_without_permission_returns_403(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="import-docx-stranger@school.edu")
    raw = _build_docx(["測試匯入法規", "第一條 本法予以制定。"])

    ac = authed_client_factory(user)
    resp = await ac.post(
        "/regulations/import-docx",
        data={"org_id": str(org.id), "category": "ordinance"},
        files={
            "file": (
                "測試.docx",
                raw,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )

    assert resp.status_code == 403


async def test_print_regulation_returns_pdf_response(
    db_session: AsyncSession, authed_client_factory, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="print-owner@school.edu")
    reg = await _make_regulation(db_session, org, creator)

    ac = authed_client_factory(creator)
    resp = await ac.get(f"/regulations/{reg.id}/print")

    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/pdf"
