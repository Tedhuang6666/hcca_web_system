"""班級截止只限制自行訂購，全域停止連班代代訂都限制。"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from api.models.activity import Activity, ActivityStatus
from api.models.electronic_credential import ElectronicCredentialSettings
from api.models.shop import ShopOrderClose
from api.schemas.school_class import ClassStudentRangeCreate, SchoolClassCreate
from api.schemas.shop import ProductCategoryCreate, ProductCreate, ProductSeriesCreate
from api.services import school_class as class_svc
from api.services import shop as shop_svc
from api.services.shop import _orders


@pytest.fixture
async def class_deadlines(db_session, admin_user, make_user, authed_client_factory):
    db_session.add(ElectronicCredentialSettings(id=1, student_id_prefixes=["310", "311"]))
    classes = []
    for prefix in ["310", "311"]:
        classes.append(
            await class_svc.create_class(
                db_session,
                data=SchoolClassCreate(
                    academic_year=115,
                    class_code=prefix,
                    grade=1,
                    ranges=[
                        ClassStudentRangeCreate(
                            student_id_start=f"{prefix}001", student_id_end=f"{prefix}099"
                        )
                    ],
                ),
                created_by=admin_user.id,
            )
        )
    cadre = await make_user(student_id="310001", email="310001@hchs.hc.edu.tw")
    buyer = await make_user(student_id="310002", email="310002@hchs.hc.edu.tw")
    outsider = await make_user(student_id="311001", email="311001@hchs.hc.edu.tw")
    await class_svc.add_cadre(db_session, classes[0], user_id=cadre.id)
    await class_svc.add_cadre(db_session, classes[1], user_id=outsider.id)
    activity = Activity(
        name="活動收款",
        status=ActivityStatus.ACTIVE,
        order_closes_at=datetime.now(UTC) + timedelta(days=3),
    )
    db_session.add(activity)
    await db_session.flush()
    category = await shop_svc.create_category(
        db_session,
        data=ProductCategoryCreate(name="活動商品", activity_id=activity.id),
        created_by=admin_user.id,
    )
    series = await shop_svc.create_series(
        db_session, data=ProductSeriesCreate(name="系列", category_id=category.id)
    )
    product = await shop_svc.create_product(
        db_session,
        data=ProductCreate(series_id=series.id, name="商品", price=100, stock_quantity=50),
        created_by=admin_user.id,
    )
    await shop_svc.activate_product(db_session, product)
    # 舊系列商品沒有直接 category_id，也必須受同一層級的截止限制。
    product.category_id = None
    await db_session.flush()
    return {
        "class": classes[0],
        "other_class": classes[1],
        "buyer": buyer,
        "cadre": authed_client_factory(cadre),
        "student": authed_client_factory(buyer),
        "outsider": authed_client_factory(outsider),
        "manager": authed_client_factory(admin_user),
        "activity": activity,
        "category": category,
        "product": product,
    }


def close_path(setup):
    return f"/shop/categories/{setup['category'].id}/close"


def registration_path(setup):
    return f"/shop/registrations/current/products/{setup['product'].id}"


def order_payload(setup, quantity=1):
    return {
        "user_id": str(setup["buyer"].id),
        "items": [{"product_id": str(setup["product"].id), "quantity": quantity}],
    }


async def status(setup):
    response = await setup["cadre"].get(
        "/shop/close-status",
        params={"category_ids": str(setup["category"].id), "class_id": str(setup["class"].id)},
    )
    assert response.status_code == 200
    return response.json()["statuses"][str(setup["category"].id)]


async def test_schedule_permissions_timezone_and_global_upper_bound(client, class_deadlines):
    s = class_deadlines
    body = {"class_id": str(s["class"].id), "closes_at": s["activity"].order_closes_at.isoformat()}
    assert (await client.post(close_path(s), json=body)).status_code == 401
    for actor in ["student", "outsider"]:
        assert (await s[actor].post(close_path(s), json=body)).status_code == 403
    invalid = [
        (datetime.now(UTC) - timedelta(minutes=1)).isoformat(),
        (s["activity"].order_closes_at + timedelta(seconds=1)).isoformat(),
        "2030-10-27T18:00",
    ]
    for value in invalid:
        response = await s["cadre"].post(close_path(s), json={**body, "closes_at": value})
        assert response.status_code in (409, 422)
    # 截止時間等於上限可以；含 +08:00 的輸入儲存為相同瞬間。
    from datetime import timezone

    body["closes_at"] = (
        s["activity"].order_closes_at.astimezone(timezone(timedelta(hours=8))).isoformat()
    )
    response = await s["cadre"].post(close_path(s), json=body)
    assert response.status_code == 201
    assert datetime.fromisoformat(response.json()["closes_at"]) == s["activity"].order_closes_at
    assert (await status(s))["is_closed"] is False
    assert (await status(s))["is_global"] is False


async def test_schedule_takes_effect_at_boundary_and_can_be_replaced_or_cancelled(
    db_session, monkeypatch, class_deadlines
):
    s = class_deadlines
    cutoff = datetime.now(UTC) + timedelta(hours=1)
    body = {"class_id": str(s["class"].id), "closes_at": cutoff.isoformat()}
    first = await s["cadre"].post(close_path(s), json=body)
    assert first.status_code == 201
    body["closes_at"] = (cutoff + timedelta(minutes=1)).isoformat()
    updated = await s["cadre"].post(close_path(s), json=body)
    assert updated.status_code == 201
    assert updated.json()["id"] != first.json()["id"]
    cancelled = await s["cadre"].delete(close_path(s), params={"class_id": str(s["class"].id)})
    assert cancelled.status_code == 200
    assert (await status(s))["closes_at"] is None
    await s["cadre"].post(close_path(s), json={**body, "closes_at": cutoff.isoformat()})
    assert (
        await s["student"].put(registration_path(s), json={"variants": [{"quantity": 1}]})
    ).status_code == 200

    class AtCutoff(datetime):
        @classmethod
        def now(cls, tz=None):
            return cutoff

    monkeypatch.setattr(_orders, "datetime", AtCutoff)
    blocked = await s["student"].put(registration_path(s), json={"variants": []})
    assert blocked.status_code == 409
    assert "班級已結單" in blocked.json()["detail"]
    # 不需背景排程寫入 DB，時間到即由查詢判定截止。
    rows = await shop_svc.get_close_status(db_session, [s["category"].id], s["class"].id)
    assert rows[s["category"].id] is not None
    assisted = await s["cadre"].post("/shop/orders/class", json=order_payload(s))
    assert assisted.status_code == 201


async def test_class_manual_close_keeps_assisted_create_and_edit_but_blocks_students(
    class_deadlines,
):
    s = class_deadlines
    assert (
        await s["cadre"].post(close_path(s), json={"class_id": str(s["class"].id)})
    ).status_code == 201
    assert (
        await s["student"].put(registration_path(s), json={"variants": [{"quantity": 1}]})
    ).status_code == 409
    response = await s["cadre"].post("/shop/orders/class", json=order_payload(s))
    assert response.status_code == 201
    order_id = response.json()[0]["id"]
    assert (
        await s["student"].patch(f"/shop/orders/{order_id}", json=order_payload(s, 2))
    ).status_code == 409
    assert (
        await s["outsider"].post("/shop/orders/class", json=order_payload(s))
    ).status_code == 403
    assert (
        await s["cadre"].patch(f"/shop/orders/{order_id}", json=order_payload(s, 2))
    ).status_code == 200
    adjusted = await s["cadre"].put(
        f"/shop/orders/class/members/{s['buyer'].id}/products/{s['product'].id}",
        json={"variants": [{"quantity": 3}]},
    )
    assert adjusted.status_code == 200
    assert adjusted.json()[0]["items"][0]["quantity"] == 3


@pytest.mark.parametrize("scope", ["activity", "category"])
async def test_global_stop_wins_over_class_close_and_reopen(db_session, class_deadlines, scope):
    s = class_deadlines
    body = {"class_id": str(s["class"].id)}
    await s["cadre"].post(close_path(s), json=body)
    if scope == "activity":
        await s["manager"].patch(
            f"/shop/activities/{s['activity'].id}/order-closure", json={"is_closed": True}
        )
    else:
        await s["manager"].post(close_path(s), json={})
        assert (await status(s))["is_global"] is True
    s["product"].sale_end = datetime.now(UTC) + timedelta(days=5)
    await db_session.flush()
    assert (
        await s["cadre"].delete(close_path(s), params={"class_id": str(s["class"].id)})
    ).status_code == 200
    response = await s["cadre"].post("/shop/orders/class", json=order_payload(s))
    assert response.status_code == 422
    adjusted = await s["cadre"].put(
        f"/shop/orders/class/members/{s['buyer'].id}/products/{s['product'].id}",
        json={"variants": [{"quantity": 1}]},
    )
    assert adjusted.status_code == 422


async def test_manual_close_replaces_future_schedule_and_retains_history(
    db_session, class_deadlines
):
    s = class_deadlines
    await s["cadre"].post(
        close_path(s),
        json={
            "class_id": str(s["class"].id),
            "closes_at": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
        },
    )
    response = await s["cadre"].post(close_path(s), json={"class_id": str(s["class"].id)})
    assert response.status_code == 201
    assert response.json()["closes_at"] is None
    assert (await status(s))["is_closed"] is True
    rows = list(await db_session.scalars(select(ShopOrderClose)))
    assert len(rows) == 2
    assert sum(row.is_active for row in rows) == 1


async def test_class_close_blocks_family_but_keeps_other_classes_open(class_deadlines):
    s = class_deadlines
    link = await s["student"].post(
        "/shop/delegation-links", json={"name": "家人", "category_id": str(s["category"].id)}
    )
    assert link.status_code == 201
    await s["cadre"].post(close_path(s), json={"class_id": str(s["class"].id)})
    family = await s["manager"].post(
        "/shop/delegation/access", json={"token": link.json()["token"]}
    )
    assert family.status_code == 410
    # 班代從一般學生入口下單仍受班級截止限制。
    assert (
        await s["cadre"].put(registration_path(s), json={"variants": [{"quantity": 1}]})
    ).status_code == 409
    assert (
        await s["outsider"].put(registration_path(s), json={"variants": [{"quantity": 1}]})
    ).status_code == 200


async def test_assisted_order_still_respects_product_deadline_stock_and_collection(
    db_session, class_deadlines
):
    s = class_deadlines
    await s["cadre"].post(close_path(s), json={"class_id": str(s["class"].id)})
    s["product"].sale_end = datetime.now(UTC) - timedelta(minutes=1)
    await db_session.flush()
    assert (await s["cadre"].post("/shop/orders/class", json=order_payload(s))).status_code == 422
    s["product"].sale_end = None
    await db_session.flush()
    assert (
        await s["cadre"].post("/shop/orders/class", json=order_payload(s, 51))
    ).status_code == 422
    created = await s["cadre"].post("/shop/orders/class", json=order_payload(s))
    assert created.status_code == 201
    order_id = created.json()[0]["id"]
    assert (
        await s["cadre"].patch(
            f"/shop/orders/{order_id}/collection", json={"is_class_collected": True}
        )
    ).status_code == 200
    assert (await s["cadre"].post("/shop/orders/class", json=order_payload(s))).status_code == 422


async def test_schedule_rejects_global_scope_and_stopped_activity(class_deadlines):
    s = class_deadlines
    cutoff = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    assert (await s["manager"].post(close_path(s), json={"closes_at": cutoff})).status_code == 409
    await s["manager"].patch(
        f"/shop/activities/{s['activity'].id}/order-closure", json={"is_closed": True}
    )
    blocked = await s["cadre"].post(
        close_path(s), json={"class_id": str(s["class"].id), "closes_at": cutoff}
    )
    assert blocked.status_code == 409
