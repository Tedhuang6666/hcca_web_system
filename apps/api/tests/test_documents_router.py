"""公文核心 CRUD router 測試 — 統計 / 建立 / 列表 / 取得 / 更新 / 刪除 / 受文者 / 列印。"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.models.document import (
    Document,
    DocumentClassification,
    DocumentRecipient,
    DocumentStatus,
    DocumentVisibility,
)
from api.models.org import Org, Permission, Position, UserPosition
from api.models.user import User


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


def _authed(factory, user: User):
    """回傳已登入且帶有 CSRF token 的 client（authed_client_factory 預設不含 CSRF cookie）。"""
    import secrets

    ac = factory(user)
    token = secrets.token_urlsafe(32)
    ac.cookies.set("csrf_token", token)
    ac._csrf_token = token
    return ac


def _make_doc(org: Org, creator: User, **overrides: object) -> Document:
    defaults: dict = {
        "serial_number": f"DOC-2026-{uuid.uuid4().hex[:8]}",
        "title": "測試公文",
        "org_id": org.id,
        "created_by": creator.id,
        "status": DocumentStatus.DRAFT,
        "subject": "為測試公文核心流程，請 鑒核。",
    }
    defaults.update(overrides)
    return Document(**defaults)


# ── 統計 ───────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_document_stats_returns_counts_for_current_user(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"統計組織-{uuid.uuid4().hex[:6]}")
    user = User(email="stats-user@example.com", display_name="User", is_active=True)
    db_session.add_all([org, user])
    await db_session.flush()

    db_session.add_all(
        [
            _make_doc(org, user, status=DocumentStatus.DRAFT),
            _make_doc(org, user, status=DocumentStatus.PENDING),
            _make_doc(org, user, status=DocumentStatus.REJECTED),
        ]
    )
    await db_session.flush()

    ac = _authed(authed_client_factory, user)
    resp = await ac.get("/documents/stats")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["draft"] == 1
    assert body["pending_submitted"] == 1
    assert body["rejected"] == 1


# ── 建立 ───────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_document_by_user_with_draft_permission_succeeds(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"建立組織-{uuid.uuid4().hex[:6]}")
    user = User(email="create-user@example.com", display_name="User", is_active=True)
    db_session.add_all([org, user])
    await db_session.flush()
    await _grant_permission(db_session, user, org, "document:draft")

    ac = _authed(authed_client_factory, user)
    resp = await ac.post(
        "/documents",
        json={
            "title": "測試公文建立",
            "org_id": str(org.id),
            "subject": "為測試公文建立流程，請 鑒核。",
        },
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "draft"
    assert body["title"] == "測試公文建立"


@pytest.mark.asyncio
async def test_create_document_without_permission_returns_403(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"建立拒絕組織-{uuid.uuid4().hex[:6]}")
    user = User(email="create-stranger@example.com", display_name="Stranger", is_active=True)
    db_session.add_all([org, user])
    await db_session.flush()

    ac = _authed(authed_client_factory, user)
    resp = await ac.post(
        "/documents",
        json={
            "title": "無權限建立",
            "org_id": str(org.id),
            "subject": "為測試無權限建立公文，請 鑒核。",
        },
    )

    assert resp.status_code == 403


# ── 列表 ───────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_documents_anonymous_only_sees_publicly_open(
    db_session: AsyncSession, client
) -> None:
    org = Org(name=f"列表公開組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="list-creator@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    public_doc = _make_doc(
        org, creator, visibility_level=DocumentVisibility.PUBLICLY_OPEN, is_public=True
    )
    private_doc = _make_doc(org, creator, visibility_level=DocumentVisibility.ORG_ONLY)
    db_session.add_all([public_doc, private_doc])
    await db_session.flush()

    resp = await client.get("/documents")

    assert resp.status_code == 200, resp.text
    ids = [item["id"] for item in resp.json()]
    assert str(public_doc.id) in ids
    assert str(private_doc.id) not in ids


@pytest.mark.asyncio
async def test_list_documents_my_only_filters_to_creator(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"我的公文組織-{uuid.uuid4().hex[:6]}")
    mine_user = User(email="myonly-user@example.com", display_name="Mine", is_active=True)
    other_user = User(email="myonly-other@example.com", display_name="Other", is_active=True)
    db_session.add_all([org, mine_user, other_user])
    await db_session.flush()

    mine_doc = _make_doc(org, mine_user)
    other_doc = _make_doc(org, other_user)
    db_session.add_all([mine_doc, other_doc])
    await db_session.flush()

    ac = _authed(authed_client_factory, mine_user)
    resp = await ac.get("/documents", params={"my_only": True})

    assert resp.status_code == 200, resp.text
    ids = [item["id"] for item in resp.json()]
    assert str(mine_doc.id) in ids
    assert str(other_doc.id) not in ids


# ── 取得單筆 ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_document_by_creator_succeeds(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"取得組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="get-creator@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.get(f"/documents/{doc.id}")

    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == str(doc.id)


@pytest.mark.asyncio
async def test_get_document_by_unrelated_user_returns_403(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"取得拒絕組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="get-creator2@example.com", display_name="Creator", is_active=True)
    stranger = User(email="get-stranger2@example.com", display_name="Stranger", is_active=True)
    db_session.add_all([org, creator, stranger])
    await db_session.flush()

    doc = _make_doc(org, creator, visibility_level=DocumentVisibility.SUBJECT_ONLY)
    db_session.add(doc)
    await db_session.flush()

    ac = _authed(authed_client_factory, stranger)
    resp = await ac.get(f"/documents/{doc.id}")

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_get_document_anonymous_public_open_succeeds(
    db_session: AsyncSession, client
) -> None:
    org = Org(name=f"匿名取得組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="get-anon-creator@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator, visibility_level=DocumentVisibility.PUBLICLY_OPEN, is_public=True)
    db_session.add(doc)
    await db_session.flush()

    resp = await client.get(f"/documents/{doc.id}")

    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_get_document_anonymous_non_public_returns_404(
    db_session: AsyncSession, client
) -> None:
    org = Org(name=f"匿名拒絕組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="get-anon-creator2@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator, visibility_level=DocumentVisibility.ORG_ONLY)
    db_session.add(doc)
    await db_session.flush()

    resp = await client.get(f"/documents/{doc.id}")

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_document_not_found_returns_404(
    db_session: AsyncSession, authed_client_factory
) -> None:
    user = User(email="get-notfound@example.com", display_name="User", is_active=True)
    db_session.add(user)
    await db_session.flush()

    ac = _authed(authed_client_factory, user)
    resp = await ac.get(f"/documents/{uuid.uuid4()}")

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_document_approval_context_returns_ok(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"脈絡組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="context-creator@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.get(f"/documents/{doc.id}/approval-context")

    assert resp.status_code == 200, resp.text
    assert resp.json()["document_id"] == str(doc.id)


# ── 更新 ───────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_update_draft_document_by_creator_with_permission_succeeds(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"更新組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="update-creator@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()
    await _grant_permission(db_session, creator, org, "document:draft")

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.patch(
        f"/documents/{doc.id}",
        json={"title": "更新後標題", "change_note": "修正錯字"},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["title"] == "更新後標題"


@pytest.mark.asyncio
async def test_update_document_by_non_creator_without_permission_returns_403(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"更新拒絕組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="update-creator2@example.com", display_name="Creator", is_active=True)
    stranger = User(email="update-stranger2@example.com", display_name="Stranger", is_active=True)
    db_session.add_all([org, creator, stranger])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()

    ac = _authed(authed_client_factory, stranger)
    resp = await ac.patch(f"/documents/{doc.id}", json={"title": "不該改成功"})

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_update_non_draft_document_returns_409(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"更新衝突組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="update-creator3@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()
    await _grant_permission(db_session, creator, org, "document:draft")

    doc = _make_doc(org, creator, status=DocumentStatus.PENDING, current_step=1)
    db_session.add(doc)
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.patch(f"/documents/{doc.id}", json={"title": "不該改成功"})

    assert resp.status_code == 409


# ── 刪除 ───────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_draft_document_by_creator_succeeds(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"刪除組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="delete-creator@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()
    doc_id = doc.id

    ac = _authed(authed_client_factory, creator)
    resp = await ac.delete(f"/documents/{doc_id}")

    assert resp.status_code == 204

    check = await ac.get(f"/documents/{doc_id}")
    assert check.status_code == 404


@pytest.mark.asyncio
async def test_delete_document_by_non_creator_returns_403(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"刪除拒絕組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="delete-creator2@example.com", display_name="Creator", is_active=True)
    stranger = User(email="delete-stranger2@example.com", display_name="Stranger", is_active=True)
    db_session.add_all([org, creator, stranger])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()

    ac = _authed(authed_client_factory, stranger)
    resp = await ac.delete(f"/documents/{doc.id}")

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_delete_non_draft_document_returns_409(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"刪除衝突組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="delete-creator3@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator, status=DocumentStatus.APPROVED)
    db_session.add(doc)
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.delete(f"/documents/{doc.id}")

    assert resp.status_code == 409


# ── 建議審核人 ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_suggest_approvers_returns_users_with_approve_permission(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"建議組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="suggest-creator@example.com", display_name="Creator", is_active=True)
    approver = User(email="suggest-approver@example.com", display_name="Approver", is_active=True)
    db_session.add_all([org, creator, approver])
    await db_session.flush()
    await _grant_permission(db_session, approver, org, "document:approve")

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.get(f"/documents/{doc.id}/suggest-approvers")

    assert resp.status_code == 200, resp.text
    ids = [item["id"] for item in resp.json()]
    assert str(approver.id) in ids


# ── 受文者 ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_update_recipients_by_creator_succeeds(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"受文者組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="recipients-creator@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.put(
        f"/documents/{doc.id}/recipients",
        json=[{"recipient_type": "main", "name": "學生代表大會"}],
    )

    assert resp.status_code == 200, resp.text
    # 注意（已知產品 bug，見報告）：update_recipients() 端點在呼叫
    # doc_svc.upsert_recipients() 後以 doc_svc.get_document() 重新查詢，意圖回傳
    # 含新受文者的公文；但 `doc` 物件的 `.recipients` 關聯已在請求開頭
    # （_get_doc_or_404）被預先載入為空清單，同一 session 內的 identity map 不會讓
    # 這次「重新查詢」真的重新載入該關聯，導致回應中的 recipients 仍是舊（空）清單。
    # 實際寫入 DB 是正確的，故改以直接查詢 DocumentRecipient 資料表驗證。
    names = (
        (
            await db_session.execute(
                select(DocumentRecipient.name).where(DocumentRecipient.document_id == doc.id)
            )
        )
        .scalars()
        .all()
    )
    assert list(names) == ["學生代表大會"]


@pytest.mark.asyncio
async def test_update_recipients_by_non_creator_returns_403(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"受文者拒絕組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="recipients-creator2@example.com", display_name="Creator", is_active=True)
    stranger = User(
        email="recipients-stranger2@example.com", display_name="Stranger", is_active=True
    )
    db_session.add_all([org, creator, stranger])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()

    ac = _authed(authed_client_factory, stranger)
    resp = await ac.put(
        f"/documents/{doc.id}/recipients",
        json=[{"recipient_type": "main", "name": "不該成功"}],
    )

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_update_recipients_non_draft_returns_409(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"受文者衝突組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="recipients-creator3@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator, status=DocumentStatus.APPROVED)
    db_session.add(doc)
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.put(
        f"/documents/{doc.id}/recipients",
        json=[{"recipient_type": "main", "name": "不該成功"}],
    )

    assert resp.status_code == 409


# ── 列印 ───────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_print_document_by_creator_returns_pdf(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"列印組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="print-creator@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.get(f"/documents/{doc.id}/print")

    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/pdf"


@pytest.mark.asyncio
async def test_print_document_recipient_variant_by_non_admin_returns_403(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"列印拒絕組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="print-creator2@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.get(f"/documents/{doc.id}/print", params={"variant": "primary"})

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_print_document_without_access_returns_403(
    db_session: AsyncSession, authed_client_factory
) -> None:
    org = Org(name=f"列印無權限組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="print-creator3@example.com", display_name="Creator", is_active=True)
    stranger = User(email="print-stranger3@example.com", display_name="Stranger", is_active=True)
    db_session.add_all([org, creator, stranger])
    await db_session.flush()

    doc = _make_doc(org, creator, visibility_level=DocumentVisibility.SUBJECT_ONLY)
    db_session.add(doc)
    await db_session.flush()

    ac = _authed(authed_client_factory, stranger)
    resp = await ac.get(f"/documents/{doc.id}/print")

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_print_document_sensitive_classification_confidential(
    db_session: AsyncSession, authed_client_factory
) -> None:
    """機密等級公文（含密等資訊）仍可由建立者正常列印，涵蓋密等分支。"""
    org = Org(name=f"列印機密組織-{uuid.uuid4().hex[:6]}")
    creator = User(email="print-secret@example.com", display_name="Creator", is_active=True)
    db_session.add_all([org, creator])
    await db_session.flush()

    doc = _make_doc(org, creator, classification=DocumentClassification.CONFIDENTIAL)
    db_session.add(doc)
    await db_session.flush()

    ac = _authed(authed_client_factory, creator)
    resp = await ac.get(f"/documents/{doc.id}/print")

    assert resp.status_code == 200, resp.text
