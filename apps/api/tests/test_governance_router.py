"""事情導向治理中樞 Router 層測試 - 涵蓋 HTTP 端點的權限與流程分支。

test_governance_planning_documents.py 已涵蓋企劃書版本服務層邏輯與資源搜尋；
本檔補齊 router 層（事情/專案/案件/關聯/資源/決議/職務/流程模板/自動化規則的
HTTP CRUD、403/404 分支、指揮中心 spawn artifact）。
"""

from __future__ import annotations

import uuid
from datetime import date

from api.models.governance import (
    EntityRelation,
    GovernanceCase,
    Matter,
    MatterResource,
    Program,
)
from api.models.org import Org, Permission, Position, UserPosition
from api.models.user import User

_PNG_BYTES = b"\x89PNG\r\n\x1a\n data"

# ── 測試輔助 ──────────────────────────────────────────────────────────────────


async def _grant_permission(db, user: User, code: str) -> None:
    from api.core.cache import cache_invalidate_user_permissions

    org = Org(name=f"org-{uuid.uuid4().hex[:6]}")
    db.add(org)
    await db.flush()
    position = Position(org_id=org.id, name="測試職位")
    db.add(position)
    await db.flush()
    db.add(Permission(position_id=position.id, code=code))
    db.add(UserPosition(user_id=user.id, position_id=position.id, start_date=date.today()))
    await db.flush()
    await cache_invalidate_user_permissions(str(user.id))


async def _bare_user(db) -> User:
    user = User(
        email=f"u-{uuid.uuid4().hex[:8]}@school.edu",
        display_name="測試使用者",
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


async def _make_matter(db, creator: User, **overrides) -> Matter:
    defaults = {"title": "校慶籌辦", "created_by_id": creator.id}
    defaults.update(overrides)
    matter = Matter(**defaults)
    db.add(matter)
    await db.flush()
    return matter


# ── 儀表板 ────────────────────────────────────────────────────────────────────


async def test_get_dashboard_returns_stats_and_matters(
    db_session, member_user, authed_client_factory
) -> None:
    await _make_matter(db_session, member_user)
    ac = authed_client_factory(member_user)
    resp = await ac.get("/governance/dashboard")
    assert resp.status_code == 200
    payload = resp.json()
    assert "stats" in payload
    assert len(payload["matters"]) >= 1


# ── 事情（Matter）CRUD ────────────────────────────────────────────────────────


async def test_create_matter_without_permission_returns_403(
    member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.post("/governance/matters", json={"title": "新事情"})
    assert resp.status_code == 403


async def test_create_matter_with_permission_returns_201_and_slug(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    ac = authed_client_factory(member_user)
    resp = await ac.post("/governance/matters", json={"title": "迎新宿營"})
    assert resp.status_code == 201
    payload = resp.json()
    assert payload["title"] == "迎新宿營"
    assert payload["slug"]


async def test_get_matter_unknown_id_returns_404(member_user, authed_client_factory) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get(f"/governance/matters/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_get_matter_by_slug_returns_matching_matter(
    db_session, member_user, authed_client_factory
) -> None:
    matter = await _make_matter(db_session, member_user, slug="orientation-camp")
    ac = authed_client_factory(member_user)
    resp = await ac.get(f"/governance/matters/by-slug/{matter.slug}")
    assert resp.status_code == 200
    assert resp.json()["id"] == str(matter.id)


async def test_get_matter_by_slug_unknown_returns_404(member_user, authed_client_factory) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/governance/matters/by-slug/does-not-exist")
    assert resp.status_code == 404


async def test_update_matter_without_permission_returns_403(
    db_session, member_user, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    matter = await _make_matter(db_session, creator)
    ac = authed_client_factory(member_user)
    resp = await ac.patch(f"/governance/matters/{matter.id}", json={"title": "改標題"})
    assert resp.status_code == 403


async def test_update_matter_with_permission_records_status_change(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    matter = await _make_matter(db_session, member_user)
    ac = authed_client_factory(member_user)
    resp = await ac.patch(f"/governance/matters/{matter.id}", json={"status": "paused"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "paused"


# ── 專案（Program）────────────────────────────────────────────────────────────


async def test_create_program_requires_permission(
    db_session, member_user, authed_client_factory
) -> None:
    matter = await _make_matter(db_session, member_user)
    ac = authed_client_factory(member_user)
    resp = await ac.post(f"/governance/matters/{matter.id}/programs", json={"name": "場地組"})
    assert resp.status_code == 403


async def test_create_and_update_program_succeeds(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    matter = await _make_matter(db_session, member_user)
    ac = authed_client_factory(member_user)
    created = await ac.post(f"/governance/matters/{matter.id}/programs", json={"name": "場地組"})
    assert created.status_code == 201
    program_id = created.json()["id"]

    updated = await ac.patch(f"/governance/programs/{program_id}", json={"status": "in_progress"})
    assert updated.status_code == 200
    assert updated.json()["status"] == "in_progress"


async def test_update_inactive_program_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    matter = await _make_matter(db_session, member_user)
    program = Program(matter_id=matter.id, name="已停用組別", is_active=False)
    db_session.add(program)
    await db_session.flush()

    ac = authed_client_factory(member_user)
    resp = await ac.patch(f"/governance/programs/{program.id}", json={"name": "改名"})
    assert resp.status_code == 404


# ── 案件（Case）────────────────────────────────────────────────────────────────


async def test_create_and_update_case_succeeds(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    matter = await _make_matter(db_session, member_user)
    ac = authed_client_factory(member_user)
    created = await ac.post(f"/governance/matters/{matter.id}/cases", json={"title": "場地申請案"})
    assert created.status_code == 201
    case_id = created.json()["id"]

    updated = await ac.patch(f"/governance/cases/{case_id}", json={"status": "done"})
    assert updated.status_code == 200
    assert updated.json()["status"] == "done"
    assert updated.json()["completed_at"] is not None


async def test_update_inactive_case_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    matter = await _make_matter(db_session, member_user)
    case = GovernanceCase(matter_id=matter.id, title="停用案件", is_active=False)
    db_session.add(case)
    await db_session.flush()

    ac = authed_client_factory(member_user)
    resp = await ac.patch(f"/governance/cases/{case.id}", json={"title": "改名"})
    assert resp.status_code == 404


# ── 關聯（EntityRelation）─────────────────────────────────────────────────────


async def test_create_relation_and_list_links_for_target(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    matter = await _make_matter(db_session, member_user)
    ac = authed_client_factory(member_user)
    target_id = uuid.uuid4()
    created = await ac.post(
        f"/governance/matters/{matter.id}/relations",
        json={"target_type": "announcement", "target_id": str(target_id), "title": "公告連結"},
    )
    assert created.status_code == 201

    links = await ac.get(
        "/governance/links", params={"target_type": "announcement", "target_id": str(target_id)}
    )
    assert links.status_code == 200
    assert links.json()[0]["matter_id"] == str(matter.id)


async def test_delete_relation_unknown_id_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    ac = authed_client_factory(member_user)
    resp = await ac.delete(f"/governance/relations/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_delete_relation_succeeds(db_session, member_user, authed_client_factory) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    matter = await _make_matter(db_session, member_user)
    relation = EntityRelation(
        matter_id=matter.id,
        source_type="matter",
        source_id=matter.id,
        target_type="survey",
        target_id=uuid.uuid4(),
        title="問卷連結",
        created_by_id=member_user.id,
    )
    db_session.add(relation)
    await db_session.flush()

    ac = authed_client_factory(member_user)
    resp = await ac.delete(f"/governance/relations/{relation.id}")
    assert resp.status_code == 204


async def test_entity_relations_list_and_create_and_graph(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    matter = await _make_matter(db_session, member_user)
    doc_id = uuid.uuid4()
    ac = authed_client_factory(member_user)

    created = await ac.post(
        f"/governance/entities/matter/{matter.id}/relations",
        json={"target_type": "document", "target_id": str(doc_id), "title": "公文關聯"},
    )
    assert created.status_code == 201

    # 冪等：重複建立相同關聯應回傳既有紀錄而非重複新增
    duplicate = await ac.post(
        f"/governance/entities/matter/{matter.id}/relations",
        json={"target_type": "document", "target_id": str(doc_id), "title": "公文關聯"},
    )
    assert duplicate.status_code == 201
    assert duplicate.json()["id"] == created.json()["id"]

    listed = await ac.get(f"/governance/entities/matter/{matter.id}/relations")
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    graph = await ac.get(f"/governance/entities/matter/{matter.id}/graph")
    assert graph.status_code == 200
    assert len(graph.json()["edges"]) == 1


# ── 模組能力 / 資源搜尋 ────────────────────────────────────────────────────────


async def test_list_module_capabilities_only_requires_login(
    member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/governance/module-capabilities")
    assert resp.status_code == 200
    assert any(item["key"] == "task" for item in resp.json())


async def test_search_governance_resources_requires_permission(
    member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/governance/resources/search", params={"kind": "org"})
    assert resp.status_code == 403


async def test_search_governance_resources_with_permission_returns_matches(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    org = Org(name="學生自治會")
    db_session.add(org)
    await db_session.flush()

    ac = authed_client_factory(member_user)
    resp = await ac.get("/governance/resources/search", params={"kind": "org", "q": "自治"})
    assert resp.status_code == 200
    assert resp.json()[0]["title"] == "學生自治會"


# ── 事情協作資源（MatterResource）─────────────────────────────────────────────


async def test_matter_resource_crud_flow(db_session, member_user, authed_client_factory) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    matter = await _make_matter(db_session, member_user)
    ac = authed_client_factory(member_user)

    created = await ac.post(
        f"/governance/matters/{matter.id}/resources",
        json={"title": "共用雲端資料夾", "url": "https://drive.example.com/folder"},
    )
    assert created.status_code == 201
    resource_id = created.json()["id"]

    updated = await ac.patch(
        f"/governance/matters/{matter.id}/resources/{resource_id}",
        json={"title": "改名後的資料夾"},
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "改名後的資料夾"

    deleted = await ac.delete(f"/governance/matters/{matter.id}/resources/{resource_id}")
    assert deleted.status_code == 204


async def test_update_matter_resource_from_other_matter_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    matter_a = await _make_matter(db_session, member_user, title="事情甲")
    matter_b = await _make_matter(db_session, member_user, title="事情乙")
    resource = MatterResource(
        matter_id=matter_a.id,
        title="甲的資源",
        url="https://a.example.com",
        created_by_id=member_user.id,
    )
    db_session.add(resource)
    await db_session.flush()

    ac = authed_client_factory(member_user)
    resp = await ac.patch(
        f"/governance/matters/{matter_b.id}/resources/{resource.id}", json={"title": "亂改"}
    )
    assert resp.status_code == 404


# ── 時間軸 / 任務 ─────────────────────────────────────────────────────────────


async def test_create_timeline_event_succeeds(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    matter = await _make_matter(db_session, member_user)
    ac = authed_client_factory(member_user)
    resp = await ac.post(f"/governance/matters/{matter.id}/events", json={"title": "召開籌備會議"})
    assert resp.status_code == 201
    assert resp.json()["title"] == "召開籌備會議"


async def test_create_and_list_matter_tasks(db_session, member_user, authed_client_factory) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    matter = await _make_matter(db_session, member_user)
    ac = authed_client_factory(member_user)
    created = await ac.post(f"/governance/matters/{matter.id}/tasks", json={"title": "借場地"})
    assert created.status_code == 201

    listed = await ac.get(f"/governance/matters/{matter.id}/tasks")
    assert listed.status_code == 200
    assert len(listed.json()) == 1
    assert listed.json()[0]["title"] == "借場地"


# ── 決議 ──────────────────────────────────────────────────────────────────────


async def test_create_and_update_decision(db_session, member_user, authed_client_factory) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    matter = await _make_matter(db_session, member_user)
    ac = authed_client_factory(member_user)
    created = await ac.post(
        f"/governance/matters/{matter.id}/decisions",
        json={"title": "採購決議", "content": "同意採購舞台音響設備"},
    )
    assert created.status_code == 201
    decision_id = created.json()["id"]

    updated = await ac.patch(f"/governance/decisions/{decision_id}", json={"status": "completed"})
    assert updated.status_code == 200
    assert updated.json()["completed_at"] is not None


async def test_update_unknown_decision_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    ac = authed_client_factory(member_user)
    resp = await ac.patch(f"/governance/decisions/{uuid.uuid4()}", json={"title": "亂改"})
    assert resp.status_code == 404


# ── 企劃書 ────────────────────────────────────────────────────────────────────


async def test_create_and_update_planning_document(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    matter = await _make_matter(db_session, member_user)
    ac = authed_client_factory(member_user)
    created = await ac.post(
        f"/governance/matters/{matter.id}/planning-documents",
        json={"title": "校慶執行企劃"},
    )
    assert created.status_code == 201
    document_id = created.json()["id"]

    updated = await ac.patch(
        f"/governance/planning-documents/{document_id}", json={"status": "approved"}
    )
    assert updated.status_code == 200
    assert updated.json()["approved_at"] is not None


async def test_update_unknown_planning_document_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    ac = authed_client_factory(member_user)
    resp = await ac.patch(f"/governance/planning-documents/{uuid.uuid4()}", json={"title": "亂改"})
    assert resp.status_code == 404


async def test_create_planning_revision_unknown_document_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    ac = authed_client_factory(member_user)
    resp = await ac.post(
        f"/governance/planning-documents/{uuid.uuid4()}/revisions",
        json={"version_label": "第二版", "content": "內容"},
    )
    assert resp.status_code == 404


async def test_planning_attachment_upload_list_rename_delete_flow(
    db_session, member_user, authed_client_factory, monkeypatch, tmp_path
) -> None:
    from api.services.storage import LocalStorageBackend

    await _grant_permission(db_session, member_user, "governance:manage")
    matter = await _make_matter(db_session, member_user)
    ac = authed_client_factory(member_user)
    document_id = (
        await ac.post(
            f"/governance/matters/{matter.id}/planning-documents", json={"title": "附件企劃"}
        )
    ).json()["id"]
    monkeypatch.setattr(
        "api.routers.governance.get_storage",
        lambda: LocalStorageBackend(base_dir=str(tmp_path)),
    )

    uploaded = await ac.post(
        f"/governance/planning-documents/{document_id}/attachments",
        files={"file": ("plan.png", _PNG_BYTES, "image/png")},
    )
    assert uploaded.status_code == 201
    attachment_id = uploaded.json()["id"]

    listed = await ac.get(f"/governance/planning-documents/{document_id}/attachments")
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    renamed = await ac.patch(
        f"/governance/planning-documents/{document_id}/attachments/{attachment_id}",
        json={"display_name": "第一版計畫書"},
    )
    assert renamed.status_code == 200
    assert renamed.json()["display_name"] == "第一版計畫書"

    downloaded = await ac.get(
        f"/governance/planning-documents/{document_id}/attachments/{attachment_id}/download"
    )
    assert downloaded.status_code == 200

    deleted = await ac.delete(
        f"/governance/planning-documents/{document_id}/attachments/{attachment_id}"
    )
    assert deleted.status_code == 204


# ── 職務指派 ──────────────────────────────────────────────────────────────────


async def test_create_and_update_role_assignment(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    matter = await _make_matter(db_session, member_user)
    ac = authed_client_factory(member_user)
    created = await ac.post(f"/governance/matters/{matter.id}/roles", json={"role_name": "總召"})
    assert created.status_code == 201
    assignment_id = created.json()["id"]

    updated = await ac.patch(f"/governance/roles/{assignment_id}", json={"role_name": "副總召"})
    assert updated.status_code == 200
    assert updated.json()["role_name"] == "副總召"


async def test_update_unknown_role_assignment_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    ac = authed_client_factory(member_user)
    resp = await ac.patch(f"/governance/roles/{uuid.uuid4()}", json={"role_name": "亂改"})
    assert resp.status_code == 404


# ── 流程模板 / 自動化規則 ──────────────────────────────────────────────────────


async def test_workflow_template_create_and_list(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    ac = authed_client_factory(member_user)
    created = await ac.post(
        "/governance/workflow-templates",
        json={"name": "活動籌辦流程", "template_type": "activity"},
    )
    assert created.status_code == 201

    listed = await ac.get("/governance/workflow-templates")
    assert listed.status_code == 200
    assert any(t["name"] == "活動籌辦流程" for t in listed.json())


async def test_automation_rule_create_list_and_update(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    ac = authed_client_factory(member_user)
    created = await ac.post(
        "/governance/automation-rules",
        json={"name": "自動關單", "trigger_type": "case_status_changed"},
    )
    assert created.status_code == 201
    rule_id = created.json()["id"]

    listed = await ac.get("/governance/automation-rules")
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    updated = await ac.patch(f"/governance/automation-rules/{rule_id}", json={"status": "paused"})
    assert updated.status_code == 200
    assert updated.json()["status"] == "paused"


async def test_update_unknown_automation_rule_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    ac = authed_client_factory(member_user)
    resp = await ac.patch(f"/governance/automation-rules/{uuid.uuid4()}", json={"name": "亂改"})
    assert resp.status_code == 404


async def test_get_automation_meta_returns_option_lists(member_user, authed_client_factory) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/governance/automation-meta")
    assert resp.status_code == 200
    assert "trigger_types" in resp.json()


# ── 指揮中心：一鍵建立 artifact ────────────────────────────────────────────────


async def test_spawn_task_artifact_succeeds(db_session, member_user, authed_client_factory) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    matter = await _make_matter(db_session, member_user)
    ac = authed_client_factory(member_user)
    resp = await ac.post(
        f"/governance/matters/{matter.id}/spawn", json={"kind": "task", "title": "借舞台"}
    )
    assert resp.status_code == 201
    assert resp.json()["kind"] == "task"
    assert resp.json()["href"] == "/tasks"


async def test_spawn_announcement_artifact_creates_relation(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    matter = await _make_matter(db_session, member_user)
    ac = authed_client_factory(member_user)
    resp = await ac.post(
        f"/governance/matters/{matter.id}/spawn",
        json={"kind": "announcement", "title": "校慶公告"},
    )
    assert resp.status_code == 201
    payload = resp.json()
    assert payload["kind"] == "announcement"

    relations = await ac.get(f"/governance/entities/matter/{matter.id}/relations")
    assert any(r["target_id"] == payload["id"] for r in relations.json())


async def test_spawn_survey_without_org_returns_422(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    matter = await _make_matter(db_session, member_user)
    ac = authed_client_factory(member_user)
    resp = await ac.post(
        f"/governance/matters/{matter.id}/spawn", json={"kind": "survey", "title": "滿意度問卷"}
    )
    assert resp.status_code == 422


async def test_spawn_artifact_without_permission_returns_403(
    member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.post(
        f"/governance/matters/{uuid.uuid4()}/spawn", json={"kind": "task", "title": "測試"}
    )
    assert resp.status_code == 403  # GovernanceManagerDep 先於 matter 存在性檢查


async def test_spawn_artifact_unknown_matter_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "governance:manage")
    ac = authed_client_factory(member_user)
    resp = await ac.post(
        f"/governance/matters/{uuid.uuid4()}/spawn", json={"kind": "task", "title": "測試"}
    )
    assert resp.status_code == 404
