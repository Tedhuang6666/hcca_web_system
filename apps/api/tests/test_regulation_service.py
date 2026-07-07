"""法規服務層測試 — CRUD／審議狀態機／條文結構驗證／一致性巡檢。

與 test_regulation_policy.py 的差異：該檔案多為純函式或 fake-session 的隔離
單元測試；本檔案一律使用真實 Postgres `db_session`，驗證服務層與 DB 互動
（flush 時機、relationship 同步、trigger 行為）是否正確。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.document import Document, DocumentCategory
from api.models.org import Org
from api.models.regulation import (
    ArticleType,
    Regulation,
    RegulationArticle,
    RegulationCategory,
    RegulationRevision,
    RegulationWorkflowStatus,
)
from api.models.user import User
from api.schemas.regulation import (
    ArticleReorderItem,
    ArticleReorderRequest,
    RegulationArticleCreate,
    RegulationArticleUpdate,
    RegulationCreate,
    RegulationUpdate,
)
from api.services import regulation as reg_svc
from api.services.regulation_consistency import audit_regulation_document_consistency

pytestmark = pytest.mark.asyncio


async def _make_org(db: AsyncSession, **overrides: object) -> Org:
    defaults: dict = {"name": f"服務層測試組織-{uuid.uuid4().hex[:6]}"}
    defaults.update(overrides)
    org = Org(**defaults)
    db.add(org)
    await db.flush()
    return org


async def _make_regulation(
    db: AsyncSession, org: Org, creator: User, **overrides: object
) -> Regulation:
    """建立法規並重新查詢回傳（模擬 router 經 `_get_reg_or_404` 已 selectinload
    articles/revisions/workflow_logs 的狀態）。service 層函式（fork_regulation_draft、
    update_regulation 的自動結構化分支等）預期呼叫者傳入的 reg 已載入這些
    collection；直接傳入剛 construct 的物件會在 AsyncSession 下對未載入的
    relationship 觸發 lazy load，丟出 sqlalchemy.exc.MissingGreenlet。
    """
    defaults: dict = {
        "title": f"服務層測試法規-{uuid.uuid4().hex[:8]}",
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
    reloaded = await reg_svc.get_regulation(db, reg.id)
    assert reloaded is not None
    return reloaded


async def _reload_regulation(db: AsyncSession, reg: Regulation) -> Regulation:
    """強制重新查詢並刷新 articles/revisions/workflow_logs。

    `reg_svc.get_regulation` 用 selectinload 撈關聯，但若該 collection
    先前已在同一個 identity map 物件上被載入過（例如本輔助函式的呼叫者已呼叫過
    `_make_regulation`），SQLAlchemy 預設不會重新覆寫已載入的屬性狀態——
    測試在那之後又直接對 DB 補寫關聯列時，需要先 expire 才能看到最新資料。
    """
    db.expire(reg, ["articles", "revisions", "workflow_logs"])
    reloaded = await reg_svc.get_regulation(db, reg.id)
    assert reloaded is not None
    return reloaded


# ── 建立 ─────────────────────────────────────────────────────────────────


async def test_create_regulation_with_article_formatted_content_auto_structures(
    db_session: AsyncSession, make_user
) -> None:
    """建立法規時若 content 已符合「第○條」格式，服務層應自動產生結構化條文。"""
    org = await _make_org(db_session)
    user = await make_user(email="create-auto@school.edu")

    reg = await reg_svc.create_regulation(
        db_session,
        data=RegulationCreate(
            title="自動結構化測試法規",
            category=RegulationCategory.ORDINANCE,
            content="第一條 本法予以制定。",
            org_id=org.id,
        ),
        created_by=user.id,
    )

    assert reg.version == 1
    assert len(reg.articles) == 1
    assert reg.articles[0].article_type == ArticleType.ARTICLE


async def test_create_regulation_without_article_content_creates_no_articles(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="create-plain@school.edu")

    reg = await reg_svc.create_regulation(
        db_session,
        data=RegulationCreate(
            title="純文字法規",
            category=RegulationCategory.PROCEDURE,
            content="這只是一段沒有條號格式的敘述。",
            org_id=org.id,
        ),
        created_by=user.id,
    )

    assert reg.articles == []


# ── 更新 ─────────────────────────────────────────────────────────────────


async def test_update_regulation_raises_when_status_not_editable(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="update-locked@school.edu")
    reg = await _make_regulation(
        db_session, org, user, workflow_status=RegulationWorkflowStatus.PUBLISHED
    )

    with pytest.raises(ValueError, match="不可編輯"):
        await reg_svc.update_regulation(
            db_session, reg, data=RegulationUpdate(title="改名"), updated_by=user.id
        )


async def test_update_regulation_content_with_change_brief_creates_visible_revision(
    db_session: AsyncSession, make_user
) -> None:
    """驗證先前 bug 修復：content 觸發自動結構化＋change_brief 同時提供時，
    不應在建立修訂快照時因未 flush 的條文缺值而丟出 pydantic ValidationError，
    且回傳物件的 revisions collection 應立即反映新快照（不需重新查詢）。"""
    org = await _make_org(db_session)
    user = await make_user(email="update-visible-rev@school.edu")
    reg = await _make_regulation(db_session, org, user)

    updated = await reg_svc.update_regulation(
        db_session,
        reg,
        data=RegulationUpdate(content="第一條 本法予以制定。", change_brief="首次修訂"),
        updated_by=user.id,
    )

    assert updated.version == 2
    assert len(updated.revisions) == 1
    assert updated.revisions[0].change_brief == "首次修訂"
    assert len(updated.articles) == 1


async def test_update_regulation_autosave_skips_version_and_revision(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="update-autosave@school.edu")
    reg = await _make_regulation(db_session, org, user)

    updated = await reg_svc.update_regulation(
        db_session,
        reg,
        data=RegulationUpdate(content="草稿內容", autosave=True),
        updated_by=user.id,
    )

    assert updated.version == 1
    assert updated.content == "草稿內容"


# ── 結構化條文 ───────────────────────────────────────────────────────────


async def test_structure_regulation_content_populates_articles_in_response(
    db_session: AsyncSession, make_user
) -> None:
    """驗證先前 bug 修復：結構化後回傳物件應立即看得到新條文，不需重新查詢。"""
    org = await _make_org(db_session)
    user = await make_user(email="structure-visible@school.edu")
    reg = await _make_regulation(db_session, org, user, content="第一條 本法予以制定。")
    # 模擬 router 在呼叫前已先載入過一次（selectinload articles），
    # 重現「同一 identity map 物件」情境。
    reloaded = await reg_svc.get_regulation(db_session, reg.id)
    assert reloaded is not None

    result = await reg_svc.structure_regulation_content(db_session, reloaded)

    assert len(result.articles) == 1
    assert result.articles[0].content == "本法予以制定。"


async def test_structure_regulation_content_raises_when_already_has_articles(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="structure-conflict@school.edu")
    reg = await _make_regulation(db_session, org, user, content="第一條 本法予以制定。")
    db_session.add(
        RegulationArticle(
            regulation_id=reg.id,
            sort_index=10,
            article_type=ArticleType.ARTICLE,
            legal_number="1",
        )
    )
    await db_session.flush()
    reloaded = await _reload_regulation(db_session, reg)

    with pytest.raises(ValueError, match="已有結構化條文"):
        await reg_svc.structure_regulation_content(db_session, reloaded)


# ── 分支草案 ─────────────────────────────────────────────────────────────


async def test_fork_regulation_draft_marks_amend_type_when_source_published(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="fork-amend@school.edu")
    reg = await _make_regulation(
        db_session,
        org,
        user,
        workflow_status=RegulationWorkflowStatus.PUBLISHED,
        published_at=datetime.now(UTC),
    )

    draft = await reg_svc.fork_regulation_draft(db_session, reg, created_by=user.id)

    assert draft.workflow_status == RegulationWorkflowStatus.DRAFT
    assert draft.source_regulation_id == reg.id
    from api.models.regulation import RegulationAmendmentType

    assert draft.amendment_type == RegulationAmendmentType.AMEND


async def test_fork_regulation_draft_copies_article_parent_relationships(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="fork-tree@school.edu")
    reg = await _make_regulation(db_session, org, user)
    chapter = RegulationArticle(
        regulation_id=reg.id, sort_index=10, article_type=ArticleType.CHAPTER, title="總則"
    )
    db_session.add(chapter)
    await db_session.flush()
    db_session.add(
        RegulationArticle(
            regulation_id=reg.id,
            sort_index=20,
            article_type=ArticleType.ARTICLE,
            legal_number="1",
            parent_id=chapter.id,
        )
    )
    await db_session.flush()
    reloaded = await _reload_regulation(db_session, reg)

    draft = await reg_svc.fork_regulation_draft(db_session, reloaded, created_by=user.id)

    assert len(draft.articles) == 2
    new_chapter = next(a for a in draft.articles if a.article_type == ArticleType.CHAPTER)
    new_article = next(a for a in draft.articles if a.article_type == ArticleType.ARTICLE)
    assert new_article.parent_id == new_chapter.id
    # lineage_id 應延續原條文，讓修正對照（compare_amendment）能正確辨識為同一條
    original_article = next(a for a in reloaded.articles if a.article_type == ArticleType.ARTICLE)
    assert new_article.lineage_id == original_article.lineage_id


# ── 停用／廢止／刪除 ─────────────────────────────────────────────────────


async def test_archive_regulation_raises_when_already_archived(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="archive-twice@school.edu")
    reg = await _make_regulation(db_session, org, user, is_active=False)

    with pytest.raises(ValueError, match="已停用"):
        await reg_svc.archive_regulation(db_session, reg)


async def test_repeal_regulation_raises_when_not_active(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="repeal-inactive@school.edu")
    reg = await _make_regulation(db_session, org, user, is_active=False)

    with pytest.raises(ValueError, match="非現行有效"):
        await reg_svc.repeal_regulation(db_session, reg, "理由")


async def test_delete_regulation_raises_when_published(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="delete-published@school.edu")
    reg = await _make_regulation(
        db_session,
        org,
        user,
        workflow_status=RegulationWorkflowStatus.PUBLISHED,
        published_at=datetime.now(UTC),
    )

    with pytest.raises(ValueError, match="不可直接刪除"):
        await reg_svc.delete_regulation(db_session, reg)


# ── 條文管理 ─────────────────────────────────────────────────────────────


async def test_add_article_rejects_disallowed_parent_child_combination(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="article-invalid-parent@school.edu")
    reg = await _make_regulation(db_session, org, user)
    article = await reg_svc.add_article(
        db_session,
        reg,
        data=RegulationArticleCreate(
            sort_index=10, article_type=ArticleType.ARTICLE, legal_number="1"
        ),
    )
    reg.articles.append(article)

    with pytest.raises(ValueError, match="不允許該層級子節點"):
        await reg_svc.add_article(
            db_session,
            reg,
            data=RegulationArticleCreate(
                sort_index=20,
                article_type=ArticleType.CHAPTER,
                parent_id=article.id,
                title="不該存在的子章",
            ),
        )


async def test_add_article_rejects_disallowed_root_type(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="article-invalid-root@school.edu")
    reg = await _make_regulation(db_session, org, user)

    with pytest.raises(ValueError, match="根層級不允許"):
        await reg_svc.add_article(
            db_session,
            reg,
            data=RegulationArticleCreate(sort_index=10, article_type=ArticleType.PARAGRAPH),
        )


async def test_update_article_can_move_to_root_with_explicit_null_parent(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="article-move-root@school.edu")
    reg = await _make_regulation(db_session, org, user)
    chapter = RegulationArticle(
        regulation_id=reg.id, sort_index=10, article_type=ArticleType.CHAPTER, title="章"
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

    updated = await reg_svc.update_article(
        db_session, article, data=RegulationArticleUpdate(parent_id=None)
    )

    assert updated.parent_id is None


async def test_delete_article_cascades_soft_delete_to_children(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="article-cascade-delete@school.edu")
    reg = await _make_regulation(db_session, org, user)
    chapter = RegulationArticle(
        regulation_id=reg.id, sort_index=10, article_type=ArticleType.CHAPTER, title="章"
    )
    db_session.add(chapter)
    await db_session.flush()
    child = RegulationArticle(
        regulation_id=reg.id,
        sort_index=20,
        article_type=ArticleType.ARTICLE,
        legal_number="1",
        parent_id=chapter.id,
    )
    db_session.add(child)
    await db_session.flush()

    await reg_svc.delete_article(db_session, chapter, hard_delete=False)

    await db_session.refresh(chapter)
    await db_session.refresh(child)
    assert chapter.is_deleted is True
    assert child.is_deleted is True


async def test_reorder_articles_raises_for_article_not_in_regulation(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="reorder-foreign@school.edu")
    reg = await _make_regulation(db_session, org, user)
    reloaded = await reg_svc.get_regulation(db_session, reg.id)
    assert reloaded is not None

    with pytest.raises(ValueError, match="不屬於此法規"):
        await reg_svc.reorder_articles(
            db_session,
            reloaded,
            ArticleReorderRequest(items=[ArticleReorderItem(id=uuid.uuid4(), sort_index=1)]),
        )


# ── 審議流程狀態機 ───────────────────────────────────────────────────────


async def test_transition_workflow_rejects_disallowed_transition(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="transition-invalid@school.edu")
    reg = await _make_regulation(db_session, org, user)  # DRAFT

    with pytest.raises(ValueError, match="無法從"):
        await reg_svc.transition_workflow(
            db_session,
            reg,
            to_status=RegulationWorkflowStatus.PUBLISHED,
            actor_id=user.id,
        )


async def test_transition_workflow_records_log_entry(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="transition-log@school.edu")
    reg = await _make_regulation(db_session, org, user)

    await reg_svc.transition_workflow(
        db_session,
        reg,
        to_status=RegulationWorkflowStatus.UNDER_REVIEW,
        actor_id=user.id,
        note="送審",
    )

    logs = await reg_svc.list_workflow_logs(db_session, reg.id)
    assert len(logs) == 1
    assert logs[0].from_status == "draft"
    assert logs[0].to_status == "under_review"


# ── 修正對照／參照檢查 ───────────────────────────────────────────────────


async def test_compare_amendment_detects_modified_article(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="compare-modified@school.edu")
    reg = await _make_regulation(db_session, org, user)
    article = RegulationArticle(
        regulation_id=reg.id,
        sort_index=10,
        article_type=ArticleType.ARTICLE,
        legal_number="1",
        content="新內容",
    )
    db_session.add(article)
    await db_session.flush()
    db_session.add(
        RegulationRevision(
            regulation_id=reg.id,
            version=1,
            change_brief="舊版",
            content_snapshot="",
            article_snapshot=(
                f'[{{"id": "{uuid.uuid4()}", "lineage_id": "{article.lineage_id}", "article_type": "article", '
                '"legal_number": "1", "title": "", "content": "舊內容", '
                '"is_deleted": false, "sort_index": 10, "parent_id": null}]'
            ),
            amended_at=datetime.now(UTC),
            amended_by=user.id,
        )
    )
    await db_session.flush()
    reloaded = await _reload_regulation(db_session, reg)

    rows = await reg_svc.compare_amendment(db_session, reloaded)

    assert len(rows) == 1
    assert rows[0].status == "修正"


async def test_validate_references_flags_nonexistent_article_number(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="validate-references@school.edu")
    reg = await _make_regulation(db_session, org, user)
    db_session.add(
        RegulationArticle(
            regulation_id=reg.id,
            sort_index=10,
            article_type=ArticleType.ARTICLE,
            legal_number="1",
            content="準用第 5 條規定。",
        )
    )
    await db_session.flush()
    reloaded = await _reload_regulation(db_session, reg)

    warnings = await reg_svc.validate_references(db_session, reloaded)

    assert len(warnings) == 1
    assert warnings[0].referenced_legal_number == "5"


async def test_get_time_machine_snapshot_raises_when_no_snapshot_before_date(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="time-machine-missing@school.edu")
    reg = await _make_regulation(db_session, org, user)
    db_session.add(
        RegulationRevision(
            regulation_id=reg.id,
            version=1,
            change_brief="首次",
            content_snapshot="",
            article_snapshot="[]",
            amended_at=datetime.now(UTC),
            amended_by=user.id,
        )
    )
    await db_session.flush()

    with pytest.raises(ValueError, match="找不到法規快照"):
        await reg_svc.get_time_machine_snapshot(
            db_session, reg.id, as_of=datetime(2000, 1, 1, tzinfo=UTC)
        )


# ── 公開有效性 ───────────────────────────────────────────────────────────


async def test_is_publicly_effective_false_for_draft(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="effective-draft@school.edu")
    reg = await _make_regulation(db_session, org, user)

    assert await reg_svc.is_publicly_effective(db_session, reg) is False


async def test_is_publicly_effective_true_when_published_without_document(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="effective-no-doc@school.edu")
    reg = await _make_regulation(
        db_session,
        org,
        user,
        workflow_status=RegulationWorkflowStatus.PUBLISHED,
        published_at=datetime.now(UTC),
    )

    assert await reg_svc.is_publicly_effective(db_session, reg) is True


async def test_is_publicly_effective_false_when_published_document_still_draft(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="effective-doc-draft@school.edu")
    doc = Document(
        serial_number=f"DOC-EFFECT-{uuid.uuid4().hex[:8]}",
        title="尚未核定的公布令",
        org_id=org.id,
        created_by=user.id,
        category=DocumentCategory.DECREE,
    )
    db_session.add(doc)
    await db_session.flush()
    reg = await _make_regulation(
        db_session,
        org,
        user,
        workflow_status=RegulationWorkflowStatus.PUBLISHED,
        published_at=datetime.now(UTC),
        published_document_id=doc.id,
    )

    assert await reg_svc.is_publicly_effective(db_session, reg) is False


# ── 匯入既有法規發布 ─────────────────────────────────────────────────────


async def test_publish_imported_regulation_splits_legislative_history_into_revisions(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="import-publish@school.edu")
    reg = await _make_regulation(
        db_session,
        org,
        user,
        legislative_history="\n".join(
            [
                "中華民國 100 年 1 月 1 日制定",
                "中華民國 105 年 6 月 1 日修正",
            ]
        ),
    )

    published = await reg_svc.publish_imported_regulation(db_session, reg, published_by=user.id)

    assert published.workflow_status == RegulationWorkflowStatus.PUBLISHED
    assert published.version == 2
    assert len(published.revisions) == 2
    assert published.revisions[-1].is_total_amendment is True


# ── 一致性巡檢 ───────────────────────────────────────────────────────────


async def test_audit_consistency_flags_published_regulation_without_document(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="consistency-missing-doc@school.edu")
    await _make_regulation(
        db_session,
        org,
        user,
        workflow_status=RegulationWorkflowStatus.PUBLISHED,
        published_at=datetime.now(UTC),
    )

    result = await audit_regulation_document_consistency(db_session)

    assert result["problem_count"] >= 1
    assert any(p["type"] == "published_regulation_missing_document" for p in result["problems"])


async def test_audit_consistency_flags_decree_document_missing_regulation_link(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="consistency-orphan-decree@school.edu")
    doc = Document(
        serial_number=f"DOC-ORPHAN-{uuid.uuid4().hex[:8]}",
        title="孤兒公布令",
        org_id=org.id,
        created_by=user.id,
        category=DocumentCategory.DECREE,
    )
    db_session.add(doc)
    await db_session.flush()

    result = await audit_regulation_document_consistency(db_session)

    assert any(p["type"] == "decree_missing_regulation_id" for p in result["problems"])


async def test_audit_consistency_flags_document_not_decree_category(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="consistency-wrong-category@school.edu")
    doc = Document(
        serial_number=f"DOC-WRONGCAT-{uuid.uuid4().hex[:8]}",
        title="類別錯誤的公布文件",
        org_id=org.id,
        created_by=user.id,
        category=DocumentCategory.LETTER,
    )
    db_session.add(doc)
    await db_session.flush()
    reg = await _make_regulation(
        db_session,
        org,
        user,
        workflow_status=RegulationWorkflowStatus.PUBLISHED,
        published_at=datetime.now(UTC),
        published_document_id=doc.id,
    )
    doc.regulation_id = reg.id
    await db_session.flush()

    result = await audit_regulation_document_consistency(db_session)

    problem_types = {p["type"] for p in result["problems"]}
    assert "published_document_not_decree" in problem_types


async def test_audit_consistency_reports_no_problems_for_correctly_linked_regulation(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    user = await make_user(email="consistency-clean@school.edu")
    doc = Document(
        serial_number=f"DOC-CLEAN-{uuid.uuid4().hex[:8]}",
        title="正確連結的公布令",
        org_id=org.id,
        created_by=user.id,
        category=DocumentCategory.DECREE,
    )
    db_session.add(doc)
    await db_session.flush()
    reg = await _make_regulation(
        db_session,
        org,
        user,
        workflow_status=RegulationWorkflowStatus.PUBLISHED,
        published_at=datetime.now(UTC),
        published_document_id=doc.id,
    )
    doc.regulation_id = reg.id
    await db_session.flush()

    result = await audit_regulation_document_consistency(db_session)

    assert result["problem_count"] == 0
