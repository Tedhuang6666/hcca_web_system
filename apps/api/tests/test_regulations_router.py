"""雲端法規查詢、歷史資料、公布權限與已撤除的寫入入口。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.models.document import Document, DocumentCategory, DocumentStatus, DocumentVisibility
from api.models.org import Org, Permission, Position, UserPosition
from api.models.regulation import (
    ArticleType,
    Regulation,
    RegulationArticle,
    RegulationCategory,
    RegulationRevision,
    RegulationWorkflowStatus,
)
from api.models.user import User

pytestmark = pytest.mark.asyncio


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


async def test_public_regulation_detail_includes_linked_document_summary(
    db_session: AsyncSession, client, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user(email="public-revision-document@school.edu")
    document = Document(
        serial_number=f"DOC-{uuid.uuid4().hex[:12]}",
        title="公布法規命令",
        summary="這是公布公文摘要",
        category=DocumentCategory.DECREE,
        status=DocumentStatus.APPROVED,
        visibility_level=DocumentVisibility.PUBLICLY_OPEN,
        is_public=True,
        org_id=org.id,
        created_by=creator.id,
    )
    db_session.add(document)
    await db_session.flush()
    reg = await _make_regulation(
        db_session,
        org,
        creator,
        workflow_status=RegulationWorkflowStatus.PUBLISHED,
        published_at=datetime.now(UTC),
        published_document_id=document.id,
    )
    revision = RegulationRevision(
        regulation_id=reg.id,
        version=1,
        change_brief="初次公布",
        content_snapshot="第一條 內容",
        article_snapshot="[]",
        amended_at=datetime.now(UTC),
        amended_by=creator.id,
        published_document=document,
    )
    db_session.add(revision)
    await db_session.flush()

    response = await client.get(f"/regulations/{reg.id}")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["version"] == 1
    assert body["revisions"][0]["published_document_id"] == str(document.id)
    assert body["revisions"][0]["published_document_summary"] == "這是公布公文摘要"


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


@pytest.mark.parametrize("category", list(RegulationCategory))
async def test_publish_source_without_deliberation(
    db_session: AsyncSession, authed_client_factory, make_user, category: RegulationCategory
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email=f"publish-{category.value}@school.edu")
    await _grant_permission(db_session, user, org, "regulation:publish")
    reg = await _make_regulation(
        db_session, org, user, category=category, content="第一條 測試內容"
    )
    response = await authed_client_factory(user).post(
        f"/regulations/{reg.id}/publish", json={"change_brief": "公布來源文件"}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["workflow_status"] == "published"
    assert body["published_at"]
    assert body["published_document_id"] is None
    assert body["workflow_logs"] == []
    assert body["revisions"][0]["content_snapshot"] == "第一條 測試內容"
    repeated = await authed_client_factory(user).post(
        f"/regulations/{reg.id}/publish", json={"change_brief": "重複公布"}
    )
    assert repeated.status_code == 409


@pytest.mark.parametrize("code", ["regulation:admin", "regulation:president_publish"])
async def test_publish_uses_existing_publication_permissions(
    db_session: AsyncSession, authed_client_factory, make_user, code: str
) -> None:
    org = await _make_org(db_session)
    user = await make_user()
    await _grant_permission(db_session, user, org, code)
    reg = await _make_regulation(db_session, org, user, content="第一條 測試內容")
    response = await authed_client_factory(user).post(
        f"/regulations/{reg.id}/publish", json={"change_brief": "公布"}
    )
    assert response.status_code == 200, response.text


@pytest.mark.parametrize("permission_org", ["none", "other"])
async def test_publish_requires_permission_in_source_organization(
    db_session: AsyncSession, authed_client_factory, make_user, permission_org: str
) -> None:
    org = await _make_org(db_session)
    user = await make_user()
    reg = await _make_regulation(db_session, org, user, content="第一條 測試內容")
    if permission_org == "other":
        other_org = await _make_org(db_session)
        await _grant_permission(db_session, user, other_org, "regulation:admin")
    response = await authed_client_factory(user).post(
        f"/regulations/{reg.id}/publish", json={"change_brief": "公布"}
    )
    assert response.status_code == 403, response.text
    assert reg.published_at is None


async def test_publish_requires_login(db_session: AsyncSession, client, make_user) -> None:
    org = await _make_org(db_session)
    user = await make_user()
    reg = await _make_regulation(db_session, org, user, content="第一條 測試內容")
    response = await client.post(f"/regulations/{reg.id}/publish", json={"change_brief": "公布"})
    assert response.status_code == 401


@pytest.mark.parametrize(
    "overrides",
    [
        {"content": ""},
        {"content": "第一條 測試", "is_repealed": True},
        {"content": "第一條 測試", "workflow_status": RegulationWorkflowStatus.ARCHIVED},
    ],
)
async def test_publish_rejects_empty_or_retired_content(
    db_session: AsyncSession, authed_client_factory, make_user, overrides: dict
) -> None:
    org = await _make_org(db_session)
    user = await make_user()
    await _grant_permission(db_session, user, org, "regulation:publish")
    reg = await _make_regulation(db_session, org, user, **overrides)
    response = await authed_client_factory(user).post(
        f"/regulations/{reg.id}/publish", json={"change_brief": "公布"}
    )
    assert response.status_code == 409, response.text
