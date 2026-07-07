"""共用收款對帳路由測試（apps/api/src/api/routers/receivables.py）。"""

from __future__ import annotations

import uuid
from datetime import timedelta


async def _grant(db_session, user, code: str) -> None:
    from api.core.clock import local_today
    from api.models.org import Org, Permission, Position, UserPosition

    org = Org(name=f"recv-org-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="財務人員")
    db_session.add(position)
    await db_session.flush()
    db_session.add(Permission(position_id=position.id, code=code))
    db_session.add(
        UserPosition(
            user_id=user.id,
            position_id=position.id,
            start_date=local_today() - timedelta(days=1),
            end_date=None,
        )
    )
    await db_session.flush()


def _payload(payer_id: uuid.UUID, **overrides) -> dict:
    defaults = {"title": "活動費用", "amount": 500, "user_id": str(payer_id)}
    defaults.update(overrides)
    return defaults


async def test_list_receivables_without_permission_returns_403(
    member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/receivables")
    assert resp.status_code == 403


async def test_create_receivable_without_payer_returns_422(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "finance:view")
    ac = authed_client_factory(member_user)

    resp = await ac.post("/receivables", json={"title": "無指定對象", "amount": 100})

    assert resp.status_code == 422


async def test_create_and_list_receivable_succeeds(
    db_session, member_user, authed_client_factory, make_user
) -> None:
    await _grant(db_session, member_user, "finance:view")
    payer = await make_user(email="payer@school.edu")
    ac = authed_client_factory(member_user)

    created = await ac.post("/receivables", json=_payload(payer.id))
    assert created.status_code == 201
    receivable_id = created.json()["id"]

    listed = await ac.get("/receivables", params={"user_id": str(payer.id)})
    assert listed.status_code == 200
    assert any(row["id"] == receivable_id for row in listed.json())


async def test_receivable_summary_returns_totals(
    db_session, member_user, authed_client_factory, make_user
) -> None:
    await _grant(db_session, member_user, "finance:view")
    payer = await make_user(email="summary-payer@school.edu")
    ac = authed_client_factory(member_user)
    await ac.post("/receivables", json=_payload(payer.id, amount=300))

    resp = await ac.get("/receivables/summary")

    assert resp.status_code == 200
    assert resp.json()["total_amount"] >= 300


async def test_update_missing_receivable_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "finance:view")
    ac = authed_client_factory(member_user)

    resp = await ac.patch(f"/receivables/{uuid.uuid4()}", json={"title": "x"})
    assert resp.status_code == 404


async def test_mark_paid_flow(db_session, member_user, authed_client_factory, make_user) -> None:
    await _grant(db_session, member_user, "finance:view")
    payer = await make_user(email="mark-paid-payer@school.edu")
    ac = authed_client_factory(member_user)
    created = await ac.post("/receivables", json=_payload(payer.id, amount=500))
    receivable_id = created.json()["id"]

    resp = await ac.post(f"/receivables/{receivable_id}/mark-paid", json={"paid_amount": 500})

    assert resp.status_code == 200
    assert resp.json()["status"] == "paid"


async def test_mark_paid_missing_receivable_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "finance:view")
    ac = authed_client_factory(member_user)

    resp = await ac.post(f"/receivables/{uuid.uuid4()}/mark-paid", json={"paid_amount": 100})
    assert resp.status_code == 404


async def test_refund_flow(db_session, member_user, authed_client_factory, make_user) -> None:
    await _grant(db_session, member_user, "finance:view")
    payer = await make_user(email="refund-payer@school.edu")
    ac = authed_client_factory(member_user)
    created = await ac.post("/receivables", json=_payload(payer.id, amount=500))
    receivable_id = created.json()["id"]
    await ac.post(f"/receivables/{receivable_id}/mark-paid", json={"paid_amount": 500})

    resp = await ac.post(f"/receivables/{receivable_id}/refund", json={"refunded_amount": 500})

    assert resp.status_code == 200
    assert resp.json()["status"] == "refunded"


async def test_export_receivables_csv_returns_csv_content_type(
    db_session, member_user, authed_client_factory, make_user
) -> None:
    await _grant(db_session, member_user, "finance:view")
    payer = await make_user(email="csv-payer@school.edu")
    ac = authed_client_factory(member_user)
    await ac.post("/receivables", json=_payload(payer.id))

    resp = await ac.get("/receivables/export.csv")

    assert resp.status_code == 200
    assert "text/csv" in resp.headers["content-type"]
