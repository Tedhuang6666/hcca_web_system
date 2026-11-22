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
    await _grant(db_session, member_user, "finance:record")
    ac = authed_client_factory(member_user)

    resp = await ac.post("/receivables", json={"title": "無指定對象", "amount": 100})

    assert resp.status_code == 422


async def test_create_receivable_with_view_permission_only_returns_403(
    db_session, member_user, authed_client_factory, make_user
) -> None:
    await _grant(db_session, member_user, "finance:view")
    payer = await make_user(email="view-only-receivable-payer@school.edu")
    ac = authed_client_factory(member_user)

    resp = await ac.post("/receivables", json=_payload(payer.id))

    assert resp.status_code == 403


async def test_create_and_list_receivable_succeeds(
    db_session, member_user, authed_client_factory, make_user
) -> None:
    await _grant(db_session, member_user, "finance:view")
    await _grant(db_session, member_user, "finance:record")
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
    await _grant(db_session, member_user, "finance:record")
    payer = await make_user(email="summary-payer@school.edu")
    ac = authed_client_factory(member_user)
    await ac.post("/receivables", json=_payload(payer.id, amount=300))

    resp = await ac.get("/receivables/summary")

    assert resp.status_code == 200
    assert resp.json()["total_amount"] >= 300


async def test_update_missing_receivable_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "finance:record")
    ac = authed_client_factory(member_user)

    resp = await ac.patch(f"/receivables/{uuid.uuid4()}", json={"title": "x"})
    assert resp.status_code == 404


async def test_update_receivable_with_record_permission_succeeds(
    db_session, member_user, authed_client_factory, make_user
) -> None:
    await _grant(db_session, member_user, "finance:record")
    payer = await make_user(email="update-record-payer@school.edu")
    ac = authed_client_factory(member_user)
    created = await ac.post("/receivables", json=_payload(payer.id))
    receivable_id = created.json()["id"]

    resp = await ac.patch(f"/receivables/{receivable_id}", json={"title": "已更新費用"})

    assert resp.status_code == 200
    assert resp.json()["title"] == "已更新費用"


async def test_view_only_user_cannot_update_receivable(
    db_session, member_user, authed_client_factory, make_user
) -> None:
    await _grant(db_session, member_user, "finance:view")
    recorder = await make_user(email="receivable-recorder@school.edu")
    await _grant(db_session, recorder, "finance:view")
    await _grant(db_session, recorder, "finance:record")
    payer = await make_user(email="update-view-only-payer@school.edu")
    recorder_client = authed_client_factory(recorder)
    viewer_client = authed_client_factory(member_user)
    created = await recorder_client.post("/receivables", json=_payload(payer.id))
    receivable_id = created.json()["id"]

    resp = await viewer_client.patch(f"/receivables/{receivable_id}", json={"title": "越權修改"})

    assert resp.status_code == 403
    listed = await viewer_client.get("/receivables", params={"user_id": str(payer.id)})
    assert next(row for row in listed.json() if row["id"] == receivable_id)["title"] == "活動費用"


async def test_mark_paid_flow(db_session, member_user, authed_client_factory, make_user) -> None:
    await _grant(db_session, member_user, "finance:record")
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
    await _grant(db_session, member_user, "finance:record")
    ac = authed_client_factory(member_user)

    resp = await ac.post(f"/receivables/{uuid.uuid4()}/mark-paid", json={"paid_amount": 100})
    assert resp.status_code == 404


async def test_view_only_user_cannot_mark_receivable_paid(
    db_session, member_user, authed_client_factory, make_user
) -> None:
    await _grant(db_session, member_user, "finance:view")
    recorder = await make_user(email="payment-recorder@school.edu")
    await _grant(db_session, recorder, "finance:view")
    await _grant(db_session, recorder, "finance:record")
    payer = await make_user(email="mark-paid-view-only-payer@school.edu")
    recorder_client = authed_client_factory(recorder)
    viewer_client = authed_client_factory(member_user)
    created = await recorder_client.post("/receivables", json=_payload(payer.id))
    receivable_id = created.json()["id"]

    resp = await viewer_client.post(
        f"/receivables/{receivable_id}/mark-paid", json={"paid_amount": 500}
    )

    assert resp.status_code == 403
    listed = await viewer_client.get("/receivables", params={"user_id": str(payer.id)})
    assert next(row for row in listed.json() if row["id"] == receivable_id)["status"] == "unpaid"


async def test_refund_flow(db_session, member_user, authed_client_factory, make_user) -> None:
    await _grant(db_session, member_user, "finance:record")
    payer = await make_user(email="refund-payer@school.edu")
    ac = authed_client_factory(member_user)
    created = await ac.post("/receivables", json=_payload(payer.id, amount=500))
    receivable_id = created.json()["id"]
    await ac.post(f"/receivables/{receivable_id}/mark-paid", json={"paid_amount": 500})

    resp = await ac.post(f"/receivables/{receivable_id}/refund", json={"refunded_amount": 500})

    assert resp.status_code == 200
    assert resp.json()["status"] == "refunded"


async def test_view_only_user_cannot_refund_receivable(
    db_session, member_user, authed_client_factory, make_user
) -> None:
    await _grant(db_session, member_user, "finance:view")
    recorder = await make_user(email="refund-recorder@school.edu")
    await _grant(db_session, recorder, "finance:view")
    await _grant(db_session, recorder, "finance:record")
    payer = await make_user(email="refund-view-only-payer@school.edu")
    recorder_client = authed_client_factory(recorder)
    viewer_client = authed_client_factory(member_user)
    created = await recorder_client.post("/receivables", json=_payload(payer.id))
    receivable_id = created.json()["id"]
    paid = await recorder_client.post(
        f"/receivables/{receivable_id}/mark-paid", json={"paid_amount": 500}
    )
    assert paid.status_code == 200

    resp = await viewer_client.post(
        f"/receivables/{receivable_id}/refund", json={"refunded_amount": 500}
    )

    assert resp.status_code == 403
    listed = await viewer_client.get("/receivables", params={"user_id": str(payer.id)})
    assert next(row for row in listed.json() if row["id"] == receivable_id)["status"] == "paid"


async def test_export_receivables_csv_returns_csv_content_type(
    db_session, member_user, authed_client_factory, make_user
) -> None:
    await _grant(db_session, member_user, "finance:view")
    await _grant(db_session, member_user, "finance:record")
    payer = await make_user(email="csv-payer@school.edu")
    ac = authed_client_factory(member_user)
    await ac.post("/receivables", json=_payload(payer.id))

    resp = await ac.get("/receivables/export.csv")

    assert resp.status_code == 200
    assert "text/csv" in resp.headers["content-type"]


async def _manual(ac, payer_id, **overrides) -> str:
    created = await ac.post("/receivables", json=_payload(payer_id, **overrides))
    assert created.status_code == 201, created.text
    return created.json()["id"]


async def test_mark_paid_rejects_overpayment(
    db_session, member_user, authed_client_factory, make_user
) -> None:
    await _grant(db_session, member_user, "finance:record")
    payer = await make_user(email="overpay-payer@school.edu")
    ac = authed_client_factory(member_user)
    receivable_id = await _manual(ac, payer.id, amount=500)

    resp = await ac.post(f"/receivables/{receivable_id}/mark-paid", json={"paid_amount": 501})

    assert resp.status_code == 422


async def test_refund_cannot_exceed_paid_amount(
    db_session, member_user, authed_client_factory, make_user
) -> None:
    await _grant(db_session, member_user, "finance:record")
    payer = await make_user(email="over-refund-payer@school.edu")
    ac = authed_client_factory(member_user)
    receivable_id = await _manual(ac, payer.id, amount=500)
    await ac.post(f"/receivables/{receivable_id}/mark-paid", json={"paid_amount": 300})

    resp = await ac.post(f"/receivables/{receivable_id}/refund", json={"refunded_amount": 301})

    assert resp.status_code == 422


async def test_refund_requires_collected_money(
    db_session, member_user, authed_client_factory, make_user
) -> None:
    await _grant(db_session, member_user, "finance:record")
    payer = await make_user(email="unpaid-refund-payer@school.edu")
    ac = authed_client_factory(member_user)
    receivable_id = await _manual(ac, payer.id, amount=500)

    resp = await ac.post(f"/receivables/{receivable_id}/refund", json={})

    assert resp.status_code == 409


async def test_cancelled_or_refunded_receivable_cannot_be_marked_paid(
    db_session, member_user, authed_client_factory, make_user
) -> None:
    await _grant(db_session, member_user, "finance:record")
    payer = await make_user(email="cancelled-pay-payer@school.edu")
    ac = authed_client_factory(member_user)
    cancelled_id = await _manual(ac, payer.id, amount=500)
    assert (
        await ac.patch(f"/receivables/{cancelled_id}", json={"status": "canceled"})
    ).status_code == 200
    refunded_id = await _manual(ac, payer.id, amount=200)
    await ac.post(f"/receivables/{refunded_id}/mark-paid", json={})
    assert (await ac.post(f"/receivables/{refunded_id}/refund", json={})).status_code == 200

    for receivable_id in (cancelled_id, refunded_id):
        resp = await ac.post(f"/receivables/{receivable_id}/mark-paid", json={})
        assert resp.status_code == 409


async def test_manual_status_is_derived_from_amounts(
    db_session, member_user, authed_client_factory, make_user
) -> None:
    await _grant(db_session, member_user, "finance:record")
    payer = await make_user(email="derived-status-payer@school.edu")
    ac = authed_client_factory(member_user)
    receivable_id = await _manual(ac, payer.id, amount=500)

    forged = await ac.patch(f"/receivables/{receivable_id}", json={"status": "paid"})
    inconsistent = await ac.patch(
        f"/receivables/{receivable_id}", json={"paid_amount": 100, "refunded_amount": 200}
    )
    partial = await ac.patch(f"/receivables/{receivable_id}", json={"paid_amount": 100})

    assert forged.status_code == 422
    assert inconsistent.status_code == 422
    assert partial.status_code == 200
    assert partial.json()["status"] == "partial"


async def test_order_linked_receivable_amounts_cannot_be_patched(
    db_session, member_user, authed_client_factory, make_user
) -> None:
    from api.models.receivable import Receivable, ReceivableSource

    await _grant(db_session, member_user, "finance:record")
    payer = await make_user(email="linked-payer@school.edu")
    linked = Receivable(
        source_type=ReceivableSource.SHOP_ORDER.value,
        source_id=uuid.uuid4(),
        user_id=payer.id,
        title="商品訂單 X",
        amount=300,
    )
    db_session.add(linked)
    await db_session.flush()
    ac = authed_client_factory(member_user)

    status_resp = await ac.patch(f"/receivables/{linked.id}", json={"status": "paid"})
    amount_resp = await ac.patch(f"/receivables/{linked.id}", json={"amount": 0})
    note_resp = await ac.patch(f"/receivables/{linked.id}", json={"note": "已電話聯繫"})

    assert status_resp.status_code == 409
    assert amount_resp.status_code == 409
    assert note_resp.status_code == 200
