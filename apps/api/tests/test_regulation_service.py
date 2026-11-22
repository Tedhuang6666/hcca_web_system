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


# ── 更新 ─────────────────────────────────────────────────────────────────


# ── 結構化條文 ───────────────────────────────────────────────────────────


# ── 分支草案 ─────────────────────────────────────────────────────────────


# ── 停用／廢止／刪除 ─────────────────────────────────────────────────────


# ── 條文管理 ─────────────────────────────────────────────────────────────


# ── 審議流程狀態機 ───────────────────────────────────────────────────────


# ── 修正對照／參照檢查 ───────────────────────────────────────────────────


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
    assert published.published_at == datetime(2011, 1, 1, tzinfo=UTC)
    assert published.updated_at == datetime(2016, 6, 1, tzinfo=UTC)


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
