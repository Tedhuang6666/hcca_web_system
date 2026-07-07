"""政策版本與同意路由測試（apps/api/src/api/routers/policies.py，ADR-003）。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from api.models.policy import PolicyDocument, PolicyKind, PrivacyRequestStatus, PrivacyRequestType


async def _make_policy(db_session, **overrides) -> PolicyDocument:
    defaults = {
        "kind": PolicyKind.PRIVACY,
        "version": f"v{uuid.uuid4().hex[:6]}",
        "title": "隱私權政策",
        "content_md": "# 隱私權政策\n內容",
        "summary_md": "摘要",
        "effective_at": datetime.now(UTC) - timedelta(days=1),
        "is_active": True,
        "requires_explicit_consent": True,
    }
    defaults.update(overrides)
    doc = PolicyDocument(**defaults)
    db_session.add(doc)
    await db_session.flush()
    return doc


async def _grant(db_session, user, code: str) -> None:
    from datetime import timedelta as _td

    from api.core.clock import local_today
    from api.models.org import Org, Permission, Position, UserPosition

    org = Org(name=f"policy-org-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="管理職")
    db_session.add(position)
    await db_session.flush()
    db_session.add(Permission(position_id=position.id, code=code))
    db_session.add(
        UserPosition(
            user_id=user.id,
            position_id=position.id,
            start_date=local_today() - _td(days=1),
            end_date=None,
        )
    )
    await db_session.flush()


# ---------------------------------------------------------------------------
# 公開端點
# ---------------------------------------------------------------------------


async def test_get_active_policy_public_returns_current_version(db_session, client) -> None:
    await _make_policy(db_session, kind=PolicyKind.TERMS)

    resp = await client.get("/policies/public/terms")

    assert resp.status_code == 200
    assert resp.json()["is_active"] is True


async def test_get_active_policy_public_missing_returns_404(client) -> None:
    resp = await client.get("/policies/public/cookie")
    assert resp.status_code == 404


async def test_get_policy_version_public_returns_matching_version(db_session, client) -> None:
    doc = await _make_policy(db_session, kind=PolicyKind.ACCESSIBILITY, version="v1.2.3")

    resp = await client.get(f"/policies/public/accessibility/{doc.version}")

    assert resp.status_code == 200
    assert resp.json()["version"] == "v1.2.3"


async def test_get_policy_version_public_unknown_version_returns_404(db_session, client) -> None:
    await _make_policy(db_session, kind=PolicyKind.SECURITY)

    resp = await client.get("/policies/public/security/does-not-exist")

    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# 已登入：me
# ---------------------------------------------------------------------------


async def test_my_pending_consents_lists_unagreed_active_policies(
    db_session, member_user, authed_client_factory
) -> None:
    await _make_policy(db_session, kind=PolicyKind.PRIVACY)
    ac = authed_client_factory(member_user)

    resp = await ac.get("/policies/me/pending")

    assert resp.status_code == 200
    assert len(resp.json()) == 1


async def test_submit_my_consent_records_and_removes_from_pending(
    db_session, member_user, authed_client_factory
) -> None:
    doc = await _make_policy(db_session, kind=PolicyKind.TERMS)
    ac = authed_client_factory(member_user)

    resp = await ac.post("/policies/me/consents", json={"policy_document_id": str(doc.id)})

    assert resp.status_code == 201
    assert resp.json()["policy_kind"] == "terms"

    pending = await ac.get("/policies/me/pending")
    assert pending.json() == []

    history = await ac.get("/policies/me/consents")
    assert len(history.json()) == 1


async def test_submit_my_consent_for_inactive_policy_returns_400(
    db_session, member_user, authed_client_factory
) -> None:
    doc = await _make_policy(db_session, kind=PolicyKind.COOKIE, is_active=False)
    ac = authed_client_factory(member_user)

    resp = await ac.post("/policies/me/consents", json={"policy_document_id": str(doc.id)})

    assert resp.status_code == 400


async def test_my_pending_consents_without_login_returns_401(client) -> None:
    resp = await client.get("/policies/me/pending")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# 已登入：個資權利請求
# ---------------------------------------------------------------------------


async def test_create_and_list_my_privacy_request(member_user, authed_client_factory) -> None:
    ac = authed_client_factory(member_user)

    resp = await ac.post(
        "/policies/me/privacy-requests",
        json={
            "request_type": PrivacyRequestType.EXPORT.value,
            "subject": "請求匯出我的個資",
            "description": "希望能取得帳號建立以來所有紀錄的完整匯出檔案。",
        },
    )

    assert resp.status_code == 201
    assert resp.json()["status"] == PrivacyRequestStatus.SUBMITTED.value

    listed = await ac.get("/policies/me/privacy-requests")
    assert len(listed.json()) == 1


async def test_cancel_my_privacy_request_succeeds(member_user, authed_client_factory) -> None:
    ac = authed_client_factory(member_user)
    created = await ac.post(
        "/policies/me/privacy-requests",
        json={
            "request_type": PrivacyRequestType.DELETION.value,
            "subject": "請求刪除我的帳號資料",
            "description": "本人已畢業離校，希望依規定刪除個人資料。",
        },
    )
    request_id = created.json()["id"]

    resp = await ac.post(
        f"/policies/me/privacy-requests/{request_id}/cancel",
        json={"reason": "改變主意了"},
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == PrivacyRequestStatus.CANCELLED.value


async def test_cancel_other_users_privacy_request_returns_400(
    member_user, make_user, authed_client_factory
) -> None:
    owner = await make_user(email="privacy-owner@school.edu")
    owner_client = authed_client_factory(owner)
    created = await owner_client.post(
        "/policies/me/privacy-requests",
        json={
            "request_type": PrivacyRequestType.ACCESS.value,
            "subject": "查看我的個資使用紀錄",
            "description": "想確認學校保存了哪些關於我的資料。",
        },
    )
    request_id = created.json()["id"]

    intruder_client = authed_client_factory(member_user)
    resp = await intruder_client.post(
        f"/policies/me/privacy-requests/{request_id}/cancel",
        json={"reason": "不是我的"},
    )

    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# 管理員：政策版本管理
# ---------------------------------------------------------------------------


async def test_admin_list_policies_without_permission_returns_403(
    member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/policies")
    assert resp.status_code == 403


async def test_admin_create_policy_succeeds(db_session, member_user, authed_client_factory) -> None:
    await _grant(db_session, member_user, "policy:admin")
    ac = authed_client_factory(member_user)

    resp = await ac.post(
        "/policies",
        json={
            "kind": PolicyKind.PRIVACY.value,
            "version": "2026.1",
            "title": "隱私權政策 2026",
            "content_md": "# 隱私權政策 2026\n內容",
            "summary_md": "年度更新",
            "effective_at": datetime.now(UTC).isoformat(),
            "requires_explicit_consent": True,
        },
    )

    assert resp.status_code == 201
    assert resp.json()["version"] == "2026.1"


async def test_admin_create_duplicate_kind_version_returns_409(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "policy:admin")
    await _make_policy(db_session, kind=PolicyKind.PRIVACY, version="dup-1")
    ac = authed_client_factory(member_user)

    resp = await ac.post(
        "/policies",
        json={
            "kind": PolicyKind.PRIVACY.value,
            "version": "dup-1",
            "title": "重複版本",
            "content_md": "內容",
            "effective_at": datetime.now(UTC).isoformat(),
        },
    )

    assert resp.status_code == 409


async def test_admin_update_policy_succeeds(db_session, member_user, authed_client_factory) -> None:
    await _grant(db_session, member_user, "policy:admin")
    # 只有未啟用版本可編輯（見 policies.py 頂部文件註解「編輯（僅未啟用版本）」）。
    doc = await _make_policy(db_session, kind=PolicyKind.TERMS, is_active=False)
    ac = authed_client_factory(member_user)

    resp = await ac.patch(f"/policies/{doc.id}", json={"title": "服務條款（修訂）"})

    assert resp.status_code == 200
    assert resp.json()["title"] == "服務條款（修訂）"


async def test_admin_update_nonexistent_policy_returns_400(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "policy:admin")
    ac = authed_client_factory(member_user)

    resp = await ac.patch(f"/policies/{uuid.uuid4()}", json={"title": "x"})

    assert resp.status_code == 400


async def test_admin_activate_policy_deactivates_others_of_same_kind(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "policy:admin")
    old = await _make_policy(db_session, kind=PolicyKind.SECURITY, version="old", is_active=True)
    new = await _make_policy(db_session, kind=PolicyKind.SECURITY, version="new", is_active=False)
    ac = authed_client_factory(member_user)

    resp = await ac.post(f"/policies/{new.id}/activate")

    assert resp.status_code == 200
    assert resp.json()["is_active"] is True

    await db_session.refresh(old)
    assert old.is_active is False


async def test_admin_activate_nonexistent_policy_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "policy:admin")
    ac = authed_client_factory(member_user)

    resp = await ac.post(f"/policies/{uuid.uuid4()}/activate")

    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# 管理員：個資權利請求
# ---------------------------------------------------------------------------


async def test_admin_list_privacy_requests_without_permission_returns_403(
    member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/policies/privacy-requests")
    assert resp.status_code == 403


async def test_admin_update_privacy_request_succeeds(
    db_session, member_user, make_user, authed_client_factory
) -> None:
    requester = await make_user(email="privacy-requester@school.edu")
    requester_client = authed_client_factory(requester)
    created = await requester_client.post(
        "/policies/me/privacy-requests",
        json={
            "request_type": PrivacyRequestType.CORRECTION.value,
            "subject": "更正我的出生年月日",
            "description": "系統上的出生年月日登記錯誤，需要更正為正確資料。",
        },
    )
    request_id = created.json()["id"]

    await _grant(db_session, member_user, "system:privacy")
    admin_client = authed_client_factory(member_user)

    resp = await admin_client.patch(
        f"/policies/privacy-requests/{request_id}",
        json={"status": PrivacyRequestStatus.COMPLETED.value, "response_message": "已更正完成"},
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == PrivacyRequestStatus.COMPLETED.value


async def test_admin_update_nonexistent_privacy_request_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "system:privacy")
    ac = authed_client_factory(member_user)

    resp = await ac.patch(
        f"/policies/privacy-requests/{uuid.uuid4()}",
        json={"status": PrivacyRequestStatus.REJECTED.value},
    )

    assert resp.status_code == 404
