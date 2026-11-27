"""換屆精靈路由測試（apps/api/src/api/routers/term_rollover.py）。"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import select

from api.core.clock import local_today
from api.core.permission_codes import PermissionCode
from api.models.org import Org, Permission, Position, UserPosition
from api.models.user import User


async def _seed_org_position(db_session, *, name_prefix: str = "換屆測試") -> Position:
    org = Org(name=f"{name_prefix}組織-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name=f"{name_prefix}職位")
    db_session.add(position)
    await db_session.flush()
    return position


async def test_dry_run_without_login_returns_401(client) -> None:
    resp = await client.post(
        "/admin/term-rollover/dry-run",
        json={"new_term_start": "2026-08-01", "new_assignments": []},
    )
    assert resp.status_code == 401


async def test_dry_run_by_member_returns_403(member_user, authed_client_factory) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.post(
        "/admin/term-rollover/dry-run",
        json={"new_term_start": "2026-08-01", "new_assignments": []},
    )
    assert resp.status_code == 403


async def test_delegated_rollover_cannot_grant_admin_or_end_all_tenures(
    authed_client_factory, db_session
) -> None:
    actor = User(
        email=f"rollover-{uuid.uuid4().hex[:6]}@school.edu",
        display_name="交接承辦人",
        is_active=True,
        is_verified=True,
    )
    org = Org(name=f"交接授權組織-{uuid.uuid4().hex[:6]}")
    inherited_org = Org(
        name=f"繼承特權組織-{uuid.uuid4().hex[:6]}",
        default_permission_codes=[PermissionCode.ADMIN_ALL.value],
    )
    db_session.add_all([actor, org, inherited_org])
    await db_session.flush()
    delegated = Position(org_id=org.id, name="交接承辦職位")
    privileged = Position(org_id=org.id, name="全域管理職位")
    inherited = Position(org_id=inherited_org.id, name="繼承管理職位")
    db_session.add_all([delegated, privileged, inherited])
    await db_session.flush()
    db_session.add_all(
        [
            Permission(position_id=delegated.id, code=PermissionCode.SYSTEM_TERM_ROLLOVER.value),
            Permission(position_id=privileged.id, code=PermissionCode.ADMIN_ALL.value),
            UserPosition(user_id=actor.id, position_id=delegated.id, start_date=local_today()),
        ]
    )
    await db_session.flush()
    ac = authed_client_factory(actor)

    for position in (privileged, inherited):
        denied = await ac.post(
            "/admin/term-rollover/execute",
            json={
                "new_term_start": "2027-08-01",
                "new_assignments": [
                    {
                        "user_id": str(actor.id),
                        "position_id": str(position.id),
                        "start_date": "2027-08-01",
                    }
                ],
                "terminate_active_before": False,
                "confirm_phrase": "換屆",
            },
        )
        assert denied.status_code == 403, denied.text
    assert (
        await db_session.scalar(
            select(UserPosition).where(
                UserPosition.user_id == actor.id, UserPosition.position_id == privileged.id
            )
        )
        is None
    )

    bulk_denied = await ac.post(
        "/admin/term-rollover/execute",
        json={
            "new_term_start": "2027-08-01",
            "new_assignments": [],
            "terminate_active_before": True,
            "confirm_phrase": "換屆",
        },
    )
    assert bulk_denied.status_code == 403
    rollback_denied = await ac.post(
        "/admin/term-rollover/rollback/unknown", json={"confirm_phrase": "復原"}
    )
    assert rollback_denied.status_code == 403

    allowed = await ac.post(
        "/admin/term-rollover/execute",
        json={
            "new_term_start": "2027-08-01",
            "new_assignments": [
                {
                    "user_id": str(actor.id),
                    "position_id": str(delegated.id),
                    "start_date": "2027-08-01",
                }
            ],
            "terminate_active_before": False,
            "confirm_phrase": "換屆",
        },
    )
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["created_count"] == 1


async def test_dry_run_lists_active_positions_as_terminations(
    admin_user, authed_client_factory, db_session
) -> None:
    position = await _seed_org_position(db_session)
    holder = User(email=f"holder-{uuid.uuid4().hex[:6]}@school.edu", display_name="舊任")
    db_session.add(holder)
    await db_session.flush()
    db_session.add(
        UserPosition(
            user_id=holder.id,
            position_id=position.id,
            start_date=date(2025, 8, 1),
            end_date=None,
        )
    )
    await db_session.flush()

    ac = authed_client_factory(admin_user)
    resp = await ac.post(
        "/admin/term-rollover/dry-run",
        json={
            "new_term_start": "2026-08-01",
            "new_assignments": [],
            "terminate_active_before": True,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["summary"]["terminations"] == 1
    assert body["terminations"][0]["user_id"] == str(holder.id)
    assert body["terminations"][0]["new_end_date"] == "2026-07-31"


async def test_dry_run_warns_on_unknown_user_in_new_assignment(
    admin_user, authed_client_factory
) -> None:
    ac = authed_client_factory(admin_user)
    resp = await ac.post(
        "/admin/term-rollover/dry-run",
        json={
            "new_term_start": "2026-08-01",
            "new_assignments": [
                {
                    "user_id": str(uuid.uuid4()),
                    "position_id": str(uuid.uuid4()),
                    "start_date": "2026-08-01",
                }
            ],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["summary"]["warning_assignments"] == 1
    assert body["new_assignments"][0]["warning"] is not None


async def test_execute_rejects_wrong_confirm_phrase(admin_user, authed_client_factory) -> None:
    ac = authed_client_factory(admin_user)
    resp = await ac.post(
        "/admin/term-rollover/execute",
        json={
            "new_term_start": "2026-08-01",
            "new_assignments": [],
            "confirm_phrase": "不對的字串",
        },
    )
    assert resp.status_code == 400


async def test_execute_rejects_fatal_warnings(admin_user, authed_client_factory) -> None:
    ac = authed_client_factory(admin_user)
    resp = await ac.post(
        "/admin/term-rollover/execute",
        json={
            "new_term_start": "2026-08-01",
            "new_assignments": [
                {
                    "user_id": str(uuid.uuid4()),
                    "position_id": str(uuid.uuid4()),
                    "start_date": "2026-08-01",
                }
            ],
            "confirm_phrase": "換屆",
        },
    )
    assert resp.status_code == 400


async def test_execute_and_rollback_round_trip(
    admin_user, authed_client_factory, db_session
) -> None:
    position = await _seed_org_position(db_session, name_prefix="換屆執行測試")
    old_holder = User(email=f"old-{uuid.uuid4().hex[:6]}@school.edu", display_name="舊任")
    new_holder = User(email=f"new-{uuid.uuid4().hex[:6]}@school.edu", display_name="新任")
    db_session.add_all([old_holder, new_holder])
    await db_session.flush()
    old_up = UserPosition(
        user_id=old_holder.id,
        position_id=position.id,
        start_date=date(2025, 8, 1),
        end_date=None,
    )
    db_session.add(old_up)
    await db_session.flush()

    ac = authed_client_factory(admin_user)
    executed = await ac.post(
        "/admin/term-rollover/execute",
        json={
            "new_term_start": "2026-08-01",
            "new_assignments": [
                {
                    "user_id": str(new_holder.id),
                    "position_id": str(position.id),
                    "start_date": "2026-08-01",
                }
            ],
            "confirm_phrase": "換屆",
        },
    )
    assert executed.status_code == 200
    exec_body = executed.json()
    assert exec_body["terminated_count"] == 1
    assert exec_body["created_count"] == 1
    batch_id = exec_body["batch_id"]

    await db_session.refresh(old_up)
    assert old_up.end_date == date(2026, 7, 31)

    new_up = (
        await db_session.execute(
            select(UserPosition).where(
                UserPosition.user_id == new_holder.id, UserPosition.position_id == position.id
            )
        )
    ).scalar_one()
    assert new_up.start_date == date(2026, 8, 1)

    rollback_wrong = await ac.post(
        f"/admin/term-rollover/rollback/{batch_id}", json={"confirm_phrase": "不對"}
    )
    assert rollback_wrong.status_code == 400

    rolled_back = await ac.post(
        f"/admin/term-rollover/rollback/{batch_id}", json={"confirm_phrase": "復原"}
    )
    assert rolled_back.status_code == 200
    rb_body = rolled_back.json()
    assert rb_body["restored_terminations"] == 1
    assert rb_body["deleted_new_assignments"] == 1

    await db_session.refresh(old_up)
    assert old_up.end_date is None

    remaining = (
        await db_session.execute(select(UserPosition).where(UserPosition.id == new_up.id))
    ).scalar_one_or_none()
    assert remaining is None


async def test_rollback_missing_batch_returns_404(admin_user, authed_client_factory) -> None:
    ac = authed_client_factory(admin_user)
    resp = await ac.post(
        "/admin/term-rollover/rollback/does-not-exist", json={"confirm_phrase": "復原"}
    )
    assert resp.status_code == 404
