"""Admin RBAC management routes."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.dependencies.auth import get_current_active_user
from api.main import app
from api.models.council_proposal import CouncilProposal
from api.models.org import Org, Permission, Position, UserPosition
from api.models.person import (
    Person,
    PersonAffiliation,
    PersonAffiliationKind,
    PersonAffiliationSource,
    PersonAffiliationStatus,
)
from api.models.school_class import ClassCadre, ClassMembership, SchoolClass
from api.models.user import User
from api.models.user_identity import UserIdentity
from api.routers import auth as auth_router


async def _seed_admin_data(db: AsyncSession) -> tuple[User, User, Org, Position, UserPosition]:
    admin = User(
        email="admin@school.edu",
        display_name="管理員",
        is_active=True,
        is_verified=True,
        is_superuser=True,
        mfa_enabled=True,
    )
    member = User(
        email="member@school.edu",
        display_name="幹部",
        is_active=True,
        is_verified=True,
    )
    org = Org(name="學生代表大會")
    db.add_all([admin, member, org])
    await db.flush()

    position = Position(org_id=org.id, name="議長", weight=10)
    db.add(position)
    await db.flush()

    assignment = UserPosition(
        user_id=member.id,
        position_id=position.id,
        start_date=local_today(),
        end_date=None,
    )
    db.add(assignment)
    await db.flush()
    return admin, member, org, position, assignment


def _override_user(user: User) -> None:
    async def override() -> User:
        return user

    app.dependency_overrides[get_current_active_user] = override


@pytest.mark.asyncio
async def test_admin_can_update_position_weight(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin, _, _, position, _ = await _seed_admin_data(db_session)
    _override_user(admin)

    response = await client.patch(f"/admin/positions/{position.id}", json={"weight": 42})

    assert response.status_code == 200, response.text
    assert response.json()["weight"] == 42


@pytest.mark.asyncio
async def test_admin_route_does_not_require_mfa(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin, _, _, position, _ = await _seed_admin_data(db_session)
    admin.mfa_enabled = False
    _override_user(admin)

    response = await client.patch(f"/admin/positions/{position.id}", json={"weight": 42})

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_admin_can_update_user_position_dates(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admin, member, _, _, assignment = await _seed_admin_data(db_session)
    _override_user(admin)
    invalidate = AsyncMock()
    monkeypatch.setattr("api.routers.admin.cache_invalidate_user_permissions", invalidate)
    start = date.today() - timedelta(days=7)
    end = date.today() + timedelta(days=30)

    response = await client.patch(
        f"/admin/users/{member.id}/positions/{assignment.id}",
        json={"start_date": start.isoformat(), "end_date": end.isoformat()},
    )

    assert response.status_code == 200
    updated = response.json()["positions"][0]
    assert updated["user_position_id"] == str(assignment.id)
    invalidate.assert_awaited_once_with(str(member.id))


@pytest.mark.asyncio
async def test_replacing_position_permissions_invalidates_holder_caches(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admin, member, _, position, _ = await _seed_admin_data(db_session)
    _override_user(admin)
    invalidate = AsyncMock()
    monkeypatch.setattr("api.routers.admin.cache_invalidate_user_permissions", invalidate)

    response = await client.put(
        f"/admin/positions/{position.id}/permissions",
        json=["document:create"],
    )

    assert response.status_code == 200
    assert response.json()["permission_codes"] == ["document:create"]
    assert (
        await db_session.scalar(
            select(Permission.code).where(Permission.position_id == position.id)
        )
        == "document:create"
    )
    invalidate.assert_awaited_once_with(str(member.id))


@pytest.mark.asyncio
async def test_copying_position_permissions_replaces_target_permissions(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admin, member, org, target, _ = await _seed_admin_data(db_session)
    source = Position(org_id=org.id, name="副議長")
    db_session.add(source)
    await db_session.flush()
    db_session.add_all(
        [
            Permission(position_id=target.id, code="document:create"),
            Permission(position_id=source.id, code="document:approve"),
            Permission(position_id=source.id, code="finance:view"),
        ]
    )
    await db_session.flush()
    _override_user(admin)
    invalidate = AsyncMock()
    monkeypatch.setattr("api.routers.admin.cache_invalidate_user_permissions", invalidate)

    response = await client.post(
        f"/admin/positions/{target.id}/permissions/copy",
        json={"source_position_id": str(source.id)},
    )

    assert response.status_code == 200
    assert response.json()["permission_codes"] == ["document:approve", "finance:view"]
    codes = (
        await db_session.scalars(
            select(Permission.code)
            .where(Permission.position_id == target.id)
            .order_by(Permission.code)
        )
    ).all()
    assert codes == ["document:approve", "finance:view"]
    invalidate.assert_awaited_once_with(str(member.id))


@pytest.mark.asyncio
async def test_admin_delete_position_ends_affiliation_and_removes_assignments(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admin, member, org, position, assignment = await _seed_admin_data(db_session)
    person = Person(
        user_id=member.id,
        student_id="SDELETEPOSITION",
        display_name=member.display_name,
    )
    db_session.add(person)
    await db_session.flush()
    affiliation = PersonAffiliation(
        person_id=person.id,
        kind=PersonAffiliationKind.ORG_POSITION,
        org_id=org.id,
        position_id=position.id,
        title=position.name,
        start_date=assignment.start_date,
        status=PersonAffiliationStatus.ACTIVE,
        source=PersonAffiliationSource.RBAC_SYNC,
        synced_user_position_id=assignment.id,
    )
    db_session.add(affiliation)
    await db_session.flush()
    _override_user(admin)
    invalidate = AsyncMock()
    role_sync = AsyncMock()
    monkeypatch.setattr("api.routers.admin.cache_invalidate_user_permissions", invalidate)
    monkeypatch.setattr("api.routers.admin.enqueue_role_sync", role_sync)

    response = await client.delete(f"/admin/positions/{position.id}")

    assert response.status_code == 204
    assert await db_session.get(Position, position.id) is None
    assert await db_session.get(UserPosition, assignment.id) is None
    await db_session.refresh(affiliation)
    assert affiliation.status == PersonAffiliationStatus.ENDED
    assert affiliation.end_date == assignment.start_date
    assert affiliation.position_id is None
    assert affiliation.synced_user_position_id is None
    invalidate.assert_awaited_once_with(str(member.id))
    role_sync.assert_awaited_once_with(db_session, member.id)


@pytest.mark.asyncio
async def test_admin_route_without_admin_permission_returns_403(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    _, member, _, position, _ = await _seed_admin_data(db_session)
    _override_user(member)

    response = await client.patch(f"/admin/positions/{position.id}", json={"weight": 20})

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_admin_can_clear_user_mfa(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin, member, _, _, _ = await _seed_admin_data(db_session)
    member.mfa_enabled = True
    member.mfa_secret = "enc:v1:secret"
    member.mfa_pending_secret = "enc:v1:pending"
    member.mfa_backup_code_hashes = {"codes": ["argon2:hash"]}
    member.mfa_pending_backup_code_hashes = {"codes": ["argon2:pending-hash"]}
    await db_session.flush()
    _override_user(admin)

    response = await client.delete(f"/admin/users/{member.id}/mfa")

    assert response.status_code == 200
    assert response.json()["mfa_enabled"] is False
    await db_session.refresh(member)
    assert member.mfa_secret is None
    assert member.mfa_pending_secret is None
    assert member.mfa_backup_code_hashes == {}
    assert member.mfa_pending_backup_code_hashes == {}


@pytest.mark.asyncio
async def test_member_cannot_clear_user_mfa(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    _, member, _, _, _ = await _seed_admin_data(db_session)
    _override_user(member)

    response = await client.delete(f"/admin/users/{member.id}/mfa")

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_admin_can_update_user_settings(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin, member, _, _, _ = await _seed_admin_data(db_session)
    _override_user(admin)

    response = await client.patch(
        f"/admin/users/{member.id}",
        json={
            "display_name": "新任幹部",
            "student_id": "S2026001",
            "is_verified": False,
            "show_email": False,
            "ui_theme": "dark",
            "notification_preferences": {
                "document_pending": {
                    "inapp": False,
                    "email": True,
                    "line": False,
                    "discord": False,
                }
            },
            "notification_digest_frequency": "daily",
            "muted_notification_modules": ["meeting"],
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["display_name"] == "新任幹部"
    assert payload["student_id"] == "S2026001"
    assert payload["is_verified"] is False
    assert payload["show_email"] is False
    assert payload["ui_theme"] == "dark"
    assert payload["notification_preferences"]["document_pending"]["email"] is True
    assert payload["notification_digest_frequency"] == "daily"
    assert payload["muted_notification_modules"] == ["meeting"]

    await db_session.refresh(member)
    assert member.student_id == "S2026001"
    assert member.notification_preferences["__digest_frequency"] == "daily"


@pytest.mark.asyncio
async def test_admin_can_revoke_user_sessions(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admin, member, _, _, _ = await _seed_admin_data(db_session)
    _override_user(admin)
    revoke = AsyncMock(return_value=4)
    monkeypatch.setattr("api.routers.admin.revoke_user", revoke)

    response = await client.post(f"/admin/users/{member.id}/sessions/revoke")

    assert response.status_code == 200, response.text
    assert response.json() == {"user_id": str(member.id), "revoked_count": 4}
    revoke.assert_awaited_once_with(str(member.id))


@pytest.mark.asyncio
async def test_update_missing_user_position_returns_404(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin, member, _, _, _ = await _seed_admin_data(db_session)
    _override_user(admin)

    response = await client.patch(
        f"/admin/users/{member.id}/positions/00000000-0000-0000-0000-000000000000",
        json={"start_date": date.today().isoformat()},
    )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_admin_can_pre_register_external_email_with_login_permission(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin, _, org, position, _ = await _seed_admin_data(db_session)
    _override_user(admin)

    response = await client.post(
        "/admin/users/pre-register",
        json={
            "display_name": "外部顧問",
            "email": "advisor@gmail.com",
            "position_ids": [str(position.id)],
            "custom_permission_org_id": str(org.id),
            "custom_permission_codes": [],
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["email"] == "advisor@gmail.com"
    assert payload["positions"][0]["id"] == str(position.id)


@pytest.mark.asyncio
async def test_pre_register_school_email_extracts_student_id_and_links_aliases(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin, _, _, _, _ = await _seed_admin_data(db_session)
    _override_user(admin)

    response = await client.post(
        "/admin/users/pre-register",
        json={
            "display_name": "多信箱學生",
            "email": "g0112040103@hchs.hc.edu.tw",
            "linked_emails": ["student.private@gmail.com"],
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["student_id"] == "112040103"
    assert payload["linked_emails"] == [
        "g0112040103@hchs.hc.edu.tw",
        "student.private@gmail.com",
    ]


@pytest.mark.asyncio
async def test_google_login_with_linked_email_uses_existing_user(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = User(
        email="g0112040104@hchs.hc.edu.tw",
        display_name="別名登入學生",
        student_id="112040104",
        is_active=True,
        is_verified=False,
    )
    db_session.add(user)
    await db_session.flush()
    db_session.add(
        UserIdentity(
            user_id=user.id,
            provider="email",
            external_id="linked.private@gmail.com",
            email="linked.private@gmail.com",
            display_name=user.display_name,
            linked_at=datetime.now(UTC),
        )
    )
    await db_session.flush()

    async def not_suspicious(*_args: object) -> tuple[bool, None]:
        return False, None

    async def no_op(*_args: object) -> None:
        return None

    monkeypatch.setattr(auth_router, "check_suspicious_login", not_suspicious)
    monkeypatch.setattr(auth_router, "record_login", no_op)

    logged_in = await auth_router._upsert_google_user(
        db_session,
        google_sub="google-linked-sub",
        email="linked.private@gmail.com",
        display_name="別名登入學生",
        avatar_url=None,
        client_ip="127.0.0.1",
        user_agent="pytest",
    )

    assert logged_in.id == user.id
    assert (
        await db_session.scalar(select(User).where(User.email == "linked.private@gmail.com"))
        is None
    )
    identity = await db_session.scalar(
        select(UserIdentity).where(
            UserIdentity.provider == "google",
            UserIdentity.external_id == "google-linked-sub",
        )
    )
    assert identity is not None
    assert identity.user_id == user.id


@pytest.mark.asyncio
async def test_admin_can_link_school_email_to_existing_user_and_extract_student_id(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin, member, _, _, _ = await _seed_admin_data(db_session)
    _override_user(admin)

    response = await client.post(
        f"/admin/users/{member.id}/emails",
        json={"emails": ["g0112040105@hchs.hc.edu.tw", "member.private@gmail.com"]},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["student_id"] == "112040105"
    assert set(payload["linked_emails"]) == {
        "g0112040105@hchs.hc.edu.tw",
        "member@school.edu",
        "member.private@gmail.com",
    }


@pytest.mark.asyncio
async def test_admin_can_merge_previously_logged_in_secondary_account(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admin, member, _, _, _ = await _seed_admin_data(db_session)
    member.student_id = "PRIMARY-001"
    await db_session.flush()
    secondary = User(
        email="secondary.private@gmail.com",
        display_name="次要帳號",
        student_id="SECONDARY-001",
        google_sub="secondary-google-sub",
        is_active=True,
        is_verified=True,
    )
    secondary_email = secondary.email
    db_session.add(secondary)
    await db_session.flush()
    db_session.add(
        UserIdentity(
            user_id=secondary.id,
            provider="google",
            external_id=secondary.google_sub,
            email=secondary.email,
            display_name=secondary.display_name,
            linked_at=datetime.now(UTC),
        )
    )
    await db_session.flush()
    _override_user(admin)

    preview_response = await client.post(
        f"/admin/users/{member.id}/merge/preview",
        json={"source_user_ids": [str(secondary.id)]},
    )
    assert preview_response.status_code == 200
    preview = preview_response.json()
    resolutions = {
        conflict["key"]: next(
            record["id"] for record in conflict["records"] if record["side"] == "target"
        )
        for conflict in preview["conflicts"]
    }

    response = await client.post(
        f"/admin/users/{member.id}/merge",
        json={
            "source_user_ids": [str(secondary.id)],
            "conflict_resolutions": resolutions,
        },
    )

    assert response.status_code == 200
    assert response.json()["display_name"] == member.display_name
    assert response.json()["student_id"] == "PRIMARY-001"
    assert secondary_email in response.json()["linked_emails"]
    await db_session.refresh(secondary)
    assert secondary.is_active is False
    assert secondary.student_id is None
    assert secondary.email.endswith("@deleted.local")
    identity = await db_session.scalar(
        select(UserIdentity).where(
            UserIdentity.provider == "google",
            UserIdentity.external_id == "secondary-google-sub",
        )
    )
    assert identity is not None
    assert identity.user_id == member.id

    async def not_suspicious(*_args: object) -> tuple[bool, None]:
        return False, None

    async def no_op(*_args: object) -> None:
        return None

    monkeypatch.setattr(auth_router, "check_suspicious_login", not_suspicious)
    monkeypatch.setattr(auth_router, "record_login", no_op)
    logged_in = await auth_router._upsert_google_user(
        db_session,
        google_sub="secondary-google-sub",
        email=secondary_email,
        display_name="次要帳號",
        avatar_url=None,
        client_ip="127.0.0.1",
        user_agent="pytest",
    )
    assert logged_in.id == member.id


@pytest.mark.asyncio
async def test_admin_account_merge_reparents_profile_roles_classes_and_history(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin, member, org, _, _ = await _seed_admin_data(db_session)
    school_student_id = "112040106"
    source = User(
        email="school-account@gmail.com",
        display_name="校務帳號姓名",
        student_id=school_student_id,
        is_active=True,
        is_verified=True,
    )
    db_session.add(source)
    await db_session.flush()

    source_position = Position(org_id=org.id, name="校務職位")
    db_session.add(source_position)
    await db_session.flush()
    db_session.add_all(
        [
            Permission(position_id=source_position.id, code="finance:view"),
            UserPosition(
                user_id=source.id,
                position_id=source_position.id,
                start_date=local_today(),
            ),
            Person(
                user_id=member.id,
                display_name="平台檔案",
                email=member.email,
            ),
            Person(
                user_id=source.id,
                student_id=school_student_id,
                display_name=source.display_name,
                legal_name="校務正式姓名",
                email=source.email,
            ),
        ]
    )
    school_class = SchoolClass(
        academic_year=115,
        class_code="106",
        grade=1,
        created_by=admin.id,
    )
    db_session.add(school_class)
    await db_session.flush()
    school_class_id = school_class.id
    db_session.add(ClassCadre(class_id=school_class.id, user_id=member.id))
    await db_session.flush()
    db_session.add_all(
        [
            ClassMembership(
                class_id=school_class.id,
                user_id=source.id,
                academic_year=115,
            ),
            ClassCadre(class_id=school_class.id, user_id=source.id),
            CouncilProposal(
                serial_number="CP-MERGE-001",
                submitter_id=source.id,
                contact_email=source.email,
                proposer_name=source.display_name,
                title="合併前的歷史投稿",
                summary="測試摘要",
                proposal_text="測試內容",
                rationale="測試理由",
            ),
        ]
    )
    await db_session.flush()
    _override_user(admin)

    preview_response = await client.post(
        f"/admin/users/{member.id}/merge/preview",
        json={"source_user_ids": [str(source.id)]},
    )
    assert preview_response.status_code == 200
    preview = preview_response.json()
    assert any(conflict["title"] == "議案投稿資料衝突" for conflict in preview["conflicts"])
    response = await client.post(
        f"/admin/users/{member.id}/merge",
        json={
            "source_user_ids": [str(source.id)],
        },
    )

    assert response.status_code == 409, response.text
    assert "業務資料衝突" in response.json()["detail"]["message"]

    await db_session.refresh(source)
    assert source.is_active is True
    assert source.email == "school-account@gmail.com"
    assert (
        await db_session.scalar(
            select(CouncilProposal.submitter_id).where(
                CouncilProposal.serial_number == "CP-MERGE-001"
            )
        )
        == source.id
    )
    assert (
        await db_session.scalar(
            select(ClassMembership.user_id).where(ClassMembership.class_id == school_class_id)
        )
        == source.id
    )
    assert (
        await db_session.scalar(
            select(ClassCadre.user_id).where(
                ClassCadre.class_id == school_class_id,
                ClassCadre.user_id == source.id,
            )
        )
        == source.id
    )
    people = (
        await db_session.scalars(select(Person).where(Person.student_id == school_student_id))
    ).all()
    assert len(people) == 1
    assert people[0].user_id == source.id
    assert people[0].legal_name == "校務正式姓名"


@pytest.mark.asyncio
async def test_admin_can_merge_multiple_secondary_accounts_into_one_primary(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin, member, _, _, _ = await _seed_admin_data(db_session)
    secondary_users = [
        User(
            email=f"secondary-{index}@gmail.com",
            display_name=member.display_name,
            google_sub=f"secondary-google-sub-{index}",
            is_active=True,
            is_verified=True,
        )
        for index in (1, 2)
    ]
    secondary_google_subs = [secondary.google_sub for secondary in secondary_users]
    db_session.add_all(secondary_users)
    await db_session.flush()
    for secondary in secondary_users:
        db_session.add(
            UserIdentity(
                user_id=secondary.id,
                provider="google",
                external_id=secondary.google_sub,
                email=secondary.email,
                display_name=secondary.display_name,
                linked_at=datetime.now(UTC),
            )
        )
    await db_session.flush()
    _override_user(admin)

    response = await client.post(
        f"/admin/users/{member.id}/merge",
        json={"source_user_ids": [str(secondary.id) for secondary in secondary_users]},
    )

    assert response.status_code == 200
    for secondary, google_sub in zip(secondary_users, secondary_google_subs, strict=True):
        await db_session.refresh(secondary)
        assert secondary.is_active is False
        identity = await db_session.scalar(
            select(UserIdentity).where(UserIdentity.external_id == google_sub)
        )
        assert identity is not None
        assert identity.user_id == member.id


@pytest.mark.asyncio
async def test_admin_can_batch_pre_register_with_partial_failure(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin, member, _, position, _ = await _seed_admin_data(db_session)
    _override_user(admin)

    response = await client.post(
        "/admin/users/pre-register/batch",
        json={
            "users": [
                {
                    "display_name": "批次學生",
                    "student_id": "112040101",
                    "position_ids": [str(position.id)],
                },
                {
                    "display_name": "重複帳號",
                    "email": member.email,
                    "position_ids": [str(position.id)],
                },
            ]
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["created"] == 1
    assert payload["failed"] == 1
    assert payload["results"][0]["email"] == "g0112040101@hchs.hc.edu.tw"
    assert payload["results"][1]["error"] == "學號或 Email 已存在"
