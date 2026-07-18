"""陳情系統（petitions.py）Router 層測試 - 送件 / 查詢 / 機關工作台 / 分案轉派。"""

from __future__ import annotations

import uuid
from datetime import date

from api.models.org import Org, Permission, Position, UserPosition
from api.models.petition import PetitionType
from api.models.user import User
from api.schemas.petition import PetitionCreate, PetitionStatusUpdate
from api.services import petition as petition_svc

# ── 測試輔助 ──────────────────────────────────────────────────────────────────


async def _grant_org_permission(db, user: User, org: Org, code: str) -> None:
    """替使用者在指定機關（org）內建立具權限碼的職位（陳情分案/查看等為 org-scoped）。"""
    from api.core.cache import cache_invalidate_user_permissions

    position = Position(org_id=org.id, name=f"職位-{uuid.uuid4().hex[:6]}")
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


async def _make_org_and_type(db, *, name: str = "學生事務處") -> tuple[Org, PetitionType]:
    org = Org(name=name)
    db.add(org)
    await db.flush()
    petition_type = PetitionType(name=f"設施維修-{uuid.uuid4().hex[:6]}", responsible_org_id=org.id)
    db.add(petition_type)
    await db.flush()
    return org, petition_type


async def _create_case(db, petition_type: PetitionType, *, submitter: User | None = None):
    from api.schemas.petition import PetitionCreate

    data = PetitionCreate(
        type_id=petition_type.id,
        is_named=submitter is not None,
        contact_email=None if submitter else "guest@example.com",
        contact_name=None if submitter else "訪客",
        title="教室冷氣故障",
        content="B302 教室冷氣無法啟動，請盡快派員維修。",
    )
    case_obj, code, _share_token = await petition_svc.create_case(
        db, data=data, submitter=submitter
    )
    return case_obj, code


# ── 前台送件 ──────────────────────────────────────────────────────────────────


async def test_create_petition_as_guest_with_contact_email_succeeds(db_session, client) -> None:
    _, petition_type = await _make_org_and_type(db_session)
    resp = await client.post(
        "/petitions",
        json={
            "type_id": str(petition_type.id),
            "is_named": False,
            "contact_email": "guest@example.com",
            "contact_name": "訪客甲",
            "title": "路燈損壞",
            "content": "校門口路燈損壞多日未修。",
        },
    )
    assert resp.status_code == 201
    payload = resp.json()
    assert payload["verification_code"]
    assert len(payload["case_number"]) == 7


async def test_create_petition_as_guest_without_contact_email_returns_422(
    db_session, client
) -> None:
    _, petition_type = await _make_org_and_type(db_session)
    resp = await client.post(
        "/petitions",
        json={
            "type_id": str(petition_type.id),
            "is_named": False,
            "title": "無聯絡方式",
            "content": "測試內容測試內容",
        },
    )
    assert resp.status_code == 422


async def test_create_petition_unknown_type_returns_422(client) -> None:
    resp = await client.post(
        "/petitions",
        json={
            "type_id": str(uuid.uuid4()),
            "contact_email": "guest@example.com",
            "title": "測試",
            "content": "測試內容測試內容",
        },
    )
    assert resp.status_code == 422


async def test_list_public_types_hides_inactive(db_session, client) -> None:
    org = Org(name="總務處")
    db_session.add(org)
    await db_session.flush()
    db_session.add_all(
        [
            PetitionType(name="啟用類型", responsible_org_id=org.id, is_active=True),
            PetitionType(name="停用類型", responsible_org_id=org.id, is_active=False),
        ]
    )
    await db_session.flush()

    resp = await client.get("/petitions/types")
    assert resp.status_code == 200
    names = [t["name"] for t in resp.json()]
    assert "啟用類型" in names
    assert "停用類型" not in names


# ── 查詢 ──────────────────────────────────────────────────────────────────────


async def test_lookup_case_with_correct_code_succeeds(db_session, client) -> None:
    _, petition_type = await _make_org_and_type(db_session)
    case_obj, code = await _create_case(db_session, petition_type)

    resp = await client.get(
        "/petitions/lookup",
        params={"case_number": case_obj.case_number, "verification_code": code},
    )
    assert resp.status_code == 200
    assert resp.json()["case_number"] == case_obj.case_number


async def test_lookup_case_with_wrong_code_returns_404(db_session, client) -> None:
    _, petition_type = await _make_org_and_type(db_session)
    case_obj, _code = await _create_case(db_session, petition_type)

    resp = await client.get(
        "/petitions/lookup",
        params={"case_number": case_obj.case_number, "verification_code": "00000"},
    )
    assert resp.status_code == 404


async def test_lookup_case_by_share_token_succeeds(db_session, client) -> None:
    _, petition_type = await _make_org_and_type(db_session)
    data = PetitionCreate(
        type_id=petition_type.id,
        contact_email="guest@example.com",
        contact_name="訪客",
        title="教室冷氣故障",
        content="B302 教室冷氣無法啟動，請盡快派員維修。",
    )
    case_obj, _code, share_token = await petition_svc.create_case(
        db_session, data=data, submitter=None
    )

    resp = await client.post("/petitions/share", json={"share_token": share_token})
    assert resp.status_code == 200
    assert resp.json()["title"] == "教室冷氣故障"


async def test_list_my_cases_returns_only_own_cases(db_session, authed_client_factory) -> None:
    _, petition_type = await _make_org_and_type(db_session)
    owner = await _bare_user(db_session)
    other = await _bare_user(db_session)
    await _create_case(db_session, petition_type, submitter=owner)
    await _create_case(db_session, petition_type, submitter=other)

    ac = authed_client_factory(owner)
    resp = await ac.get("/petitions/my")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


# ── 類型管理 ──────────────────────────────────────────────────────────────────


async def test_admin_types_require_permission(member_user, authed_client_factory) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/petitions/admin/types")
    assert resp.status_code == 403


async def test_admin_types_crud_with_permission(
    db_session, admin_user, authed_client_factory
) -> None:
    org = Org(name="環保組")
    db_session.add(org)
    await db_session.flush()
    ac = authed_client_factory(admin_user)  # superuser 略過權限檢查

    created = await ac.post(
        "/petitions/admin/types",
        json={"name": "環境清潔", "responsible_org_id": str(org.id)},
    )
    assert created.status_code == 201
    type_id = created.json()["id"]

    updated = await ac.patch(f"/petitions/admin/types/{type_id}", json={"is_active": False})
    assert updated.status_code == 200
    assert updated.json()["is_active"] is False

    deleted = await ac.delete(f"/petitions/admin/types/{type_id}")
    assert deleted.status_code == 204


async def test_update_unknown_type_returns_404(admin_user, authed_client_factory) -> None:
    ac = authed_client_factory(admin_user)
    resp = await ac.patch(f"/petitions/admin/types/{uuid.uuid4()}", json={"name": "亂改"})
    assert resp.status_code == 404


# ── 機關工作台 ────────────────────────────────────────────────────────────────


async def test_list_manage_cases_scoped_to_org_permission(
    db_session, authed_client_factory
) -> None:
    org_a, type_a = await _make_org_and_type(db_session, name="機關甲")
    org_b, type_b = await _make_org_and_type(db_session, name="機關乙")
    await _create_case(db_session, type_a)
    await _create_case(db_session, type_b)

    handler = await _bare_user(db_session)
    await _grant_org_permission(db_session, handler, org_a, "petition:view_org")

    ac = authed_client_factory(handler)
    resp = await ac.get("/petitions/manage")
    assert resp.status_code == 200
    payload = resp.json()
    assert len(payload) == 1
    assert payload[0]["current_org_id"] == str(org_a.id)


async def test_get_stats_scoped_by_org(db_session, authed_client_factory) -> None:
    org, petition_type = await _make_org_and_type(db_session)
    await _create_case(db_session, petition_type)
    handler = await _bare_user(db_session)
    await _grant_org_permission(db_session, handler, org, "petition:view_org")

    ac = authed_client_factory(handler)
    resp = await ac.get("/petitions/stats")
    assert resp.status_code == 200
    assert resp.json()["total"] == 1


# ── 案件詳情存取控制 ──────────────────────────────────────────────────────────


async def test_get_case_forbidden_for_unrelated_user(db_session, authed_client_factory) -> None:
    _, petition_type = await _make_org_and_type(db_session)
    owner = await _bare_user(db_session)
    stranger = await _bare_user(db_session)
    case_obj, _code = await _create_case(db_session, petition_type, submitter=owner)

    ac = authed_client_factory(stranger)
    resp = await ac.get(f"/petitions/{case_obj.id}")
    assert resp.status_code == 403


async def test_get_case_visible_to_submitter(db_session, authed_client_factory) -> None:
    _, petition_type = await _make_org_and_type(db_session)
    owner = await _bare_user(db_session)
    case_obj, _code = await _create_case(db_session, petition_type, submitter=owner)

    ac = authed_client_factory(owner)
    resp = await ac.get(f"/petitions/{case_obj.id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == str(case_obj.id)
    assert resp.json()["latest_internal_note"] is None  # 陳情人不可見內部備註


async def test_list_assignable_users_returns_org_members(db_session, authed_client_factory) -> None:
    org, petition_type = await _make_org_and_type(db_session)
    handler = await _bare_user(db_session)
    await _grant_org_permission(db_session, handler, org, "petition:view_org")
    case_obj, _code = await _create_case(db_session, petition_type)

    ac = authed_client_factory(handler)
    resp = await ac.get(f"/petitions/{case_obj.id}/assignable-users")
    assert resp.status_code == 200
    assert any(u["id"] == str(handler.id) for u in resp.json())


# ── 分案 / 轉派 / 回覆 / 狀態 / 備註 ───────────────────────────────────────────


async def test_assign_case_requires_permission(
    db_session, member_user, authed_client_factory
) -> None:
    _, petition_type = await _make_org_and_type(db_session)
    case_obj, _code = await _create_case(db_session, petition_type)
    ac = authed_client_factory(member_user)
    resp = await ac.patch(
        f"/petitions/{case_obj.id}/assign", json={"assigned_to_id": str(member_user.id)}
    )
    assert resp.status_code == 403


async def test_assign_case_rejects_user_outside_org(db_session, authed_client_factory) -> None:
    org, petition_type = await _make_org_and_type(db_session)
    handler = await _bare_user(db_session)
    await _grant_org_permission(db_session, handler, org, "petition:assign")
    outsider = await _bare_user(db_session)
    case_obj, _code = await _create_case(db_session, petition_type)

    ac = authed_client_factory(handler)
    resp = await ac.patch(
        f"/petitions/{case_obj.id}/assign", json={"assigned_to_id": str(outsider.id)}
    )
    assert resp.status_code == 422


async def test_assign_case_succeeds_for_org_member(db_session, authed_client_factory) -> None:
    org, petition_type = await _make_org_and_type(db_session)
    handler = await _bare_user(db_session)
    await _grant_org_permission(db_session, handler, org, "petition:assign")
    case_obj, _code = await _create_case(db_session, petition_type)

    ac = authed_client_factory(handler)
    resp = await ac.patch(
        f"/petitions/{case_obj.id}/assign", json={"assigned_to_id": str(handler.id)}
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "assigned"


async def test_transfer_case_moves_to_new_org(db_session, authed_client_factory) -> None:
    org, petition_type = await _make_org_and_type(db_session)
    target_org = Org(name="新負責機關")
    db_session.add(target_org)
    await db_session.flush()
    handler = await _bare_user(db_session)
    await _grant_org_permission(db_session, handler, org, "petition:transfer")
    case_obj, _code = await _create_case(db_session, petition_type)

    ac = authed_client_factory(handler)
    resp = await ac.patch(
        f"/petitions/{case_obj.id}/transfer",
        json={"to_org_id": str(target_org.id), "reason": "非本機關業務範圍"},
    )
    assert resp.status_code == 200
    assert resp.json()["current_org_id"] == str(target_org.id)
    assert resp.json()["status"] == "transferred"


async def test_reply_case_marks_resolved_when_requested(db_session, authed_client_factory) -> None:
    org, petition_type = await _make_org_and_type(db_session)
    handler = await _bare_user(db_session)
    await _grant_org_permission(db_session, handler, org, "petition:handle")
    case_obj, _code = await _create_case(db_session, petition_type)

    ac = authed_client_factory(handler)
    resp = await ac.post(
        f"/petitions/{case_obj.id}/reply",
        json={"public_content": "已派員修復完畢", "resolve": True},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "resolved"
    assert resp.json()["public_reply"] == "已派員修復完畢"


async def test_update_status_needs_info_requires_message(db_session, authed_client_factory) -> None:
    org, petition_type = await _make_org_and_type(db_session)
    handler = await _bare_user(db_session)
    await _grant_org_permission(db_session, handler, org, "petition:handle")
    case_obj, _code = await _create_case(db_session, petition_type)

    ac = authed_client_factory(handler)
    missing_message = await ac.patch(
        f"/petitions/{case_obj.id}/status", json={"status": "needs_info"}
    )
    assert missing_message.status_code == 422

    ok = await ac.patch(
        f"/petitions/{case_obj.id}/status",
        json={"status": "needs_info", "public_message": "請補充現場照片"},
    )
    assert ok.status_code == 200
    assert ok.json()["supplement_request"] == "請補充現場照片"


async def test_add_internal_note_succeeds(db_session, authed_client_factory) -> None:
    org, petition_type = await _make_org_and_type(db_session)
    handler = await _bare_user(db_session)
    await _grant_org_permission(db_session, handler, org, "petition:handle")
    case_obj, _code = await _create_case(db_session, petition_type)

    ac = authed_client_factory(handler)
    resp = await ac.post(f"/petitions/{case_obj.id}/notes", json={"content": "已電話聯繫陳情人"})
    assert resp.status_code == 200
    assert resp.json()["latest_internal_note"] == "已電話聯繫陳情人"


# ── 補件 ──────────────────────────────────────────────────────────────────────


async def test_supplement_case_requires_auth_or_verification_code(db_session, client) -> None:
    org, petition_type = await _make_org_and_type(db_session)
    handler = await _bare_user(db_session)
    await _grant_org_permission(db_session, handler, org, "petition:handle")
    case_obj, code = await _create_case(db_session, petition_type)
    await petition_svc.update_status(
        db_session,
        case_obj,
        data=PetitionStatusUpdate(status="needs_info", public_message="請補件"),
        actor_id=handler.id,
    )

    forbidden = await client.post(
        f"/petitions/{case_obj.id}/supplement", json={"content": "補充內容"}
    )
    assert forbidden.status_code == 403

    ok = await client.post(
        f"/petitions/{case_obj.id}/supplement",
        json={"content": "補充內容", "verification_code": code},
    )
    assert ok.status_code == 200
    assert ok.json()["status"] == "in_progress"
