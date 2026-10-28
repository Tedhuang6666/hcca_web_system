"""統一期限與班聯收款鎖單；班代不再控制截止。"""

from datetime import UTC, datetime, timedelta

import pytest

from api.models.activity import Activity, ActivityStatus
from api.models.electronic_credential import ElectronicCredentialSettings
from api.models.shop import ShopOrderClose
from api.schemas.school_class import ClassStudentRangeCreate, SchoolClassCreate
from api.schemas.shop import (
    CartItemCreate,
    ProductCategoryCreate,
    ProductCreate,
    ProductSeriesCreate,
)
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


async def test_cadre_cannot_control_class_cutoff(client, class_deadlines):
    s = class_deadlines
    body = {"class_id": str(s["class"].id)}
    assert (await client.post(close_path(s), json=body)).status_code == 401
    for actor in ["cadre", "student", "outsider", "manager"]:
        assert (await s[actor].post(close_path(s), json=body)).status_code == 422
        assert (await s[actor].delete(close_path(s), params=body)).status_code == 403
    assert (await s["cadre"].post(close_path(s), json={})).status_code == 403
    body["closes_at"] = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    assert (await s["cadre"].post(close_path(s), json=body)).status_code == 422


@pytest.mark.parametrize("scheduled", [False, True])
async def test_legacy_class_cutoffs_no_longer_lock_orders(db_session, class_deadlines, scheduled):
    s = class_deadlines
    db_session.add(
        ShopOrderClose(
            category_id=s["category"].id,
            class_id=s["class"].id,
            closed_by_id=s["buyer"].id,
            is_active=True,
            closes_at=datetime.now(UTC) - timedelta(seconds=1) if scheduled else None,
        )
    )
    await db_session.flush()
    assert (await status(s))["is_closed"] is False
    assert (
        await s["student"].put(registration_path(s), json={"variants": [{"quantity": 1}]})
    ).status_code == 200
    assert (await s["cadre"].post("/shop/orders/class", json=order_payload(s))).status_code == 201


async def pay_class(s, paid=True, activity_id="current"):
    response = await s["manager"].patch(
        f"/shop/orders/classes/{s['class'].id}/payment",
        json={
            "is_paid": paid,
            "activity_id": str(s["activity"].id) if activity_id == "current" else activity_id,
        },
    )
    assert response.status_code == 200, response.text
    return response


async def test_unified_cutoff_locks_student_family_and_assisted_orders(
    db_session, monkeypatch, class_deadlines
):
    s = class_deadlines
    link = await s["student"].post(
        "/shop/delegation-links", json={"name": "家人", "category_id": str(s["category"].id)}
    )
    created = await s["student"].put(registration_path(s), json={"variants": [{"quantity": 1}]})
    assert created.status_code == 200
    cutoff = s["activity"].order_closes_at
    s["product"].sale_end = cutoff + timedelta(days=5)
    await db_session.flush()
    assert s["product"].effective_sale_end == cutoff

    class AtCutoff(datetime):
        @classmethod
        def now(cls, tz=None):
            return cutoff

    monkeypatch.setattr(_orders, "datetime", AtCutoff)
    assert (await s["student"].put(registration_path(s), json={"variants": []})).status_code == 409
    assert (await s["cadre"].post("/shop/orders/class", json=order_payload(s))).status_code == 422
    assert (
        await s["cadre"].put(
            f"/shop/orders/class/members/{s['buyer'].id}/products/{s['product'].id}",
            json={"variants": [{"quantity": 2}]},
        )
    ).status_code == 422
    assert (
        await s["student"].put(
            "/shop/registrations/current/promotion",
            json={"code": None, "activity_id": str(s["activity"].id)},
        )
    ).status_code == 422
    assert (
        await s["manager"].post("/shop/delegation/access", json={"token": link.json()["token"]})
    ).status_code == 410
    assert (await status(s))["is_closed"] is True


async def test_council_payment_locks_supplements_and_every_order_entry(db_session, class_deadlines):
    s = class_deadlines
    created = await s["student"].put(registration_path(s), json={"variants": [{"quantity": 1}]})
    order_id = created.json()["id"]
    assert (
        await s["cadre"].patch(
            f"/shop/orders/{order_id}/collection", json={"is_class_collected": True}
        )
    ).status_code == 200
    # 班代收款只保護舊品項，尚未交班聯前仍可加購。
    assert (
        await s["student"].put(registration_path(s), json={"variants": [{"quantity": 2}]})
    ).status_code == 200
    await pay_class(s)
    assert (await status(s))["is_closed"] is True
    assert (await status(s))["is_global"] is False
    assert (
        await s["student"].put(registration_path(s), json={"variants": [{"quantity": 3}]})
    ).status_code == 409
    assert (await s["cadre"].post("/shop/orders/class", json=order_payload(s))).status_code == 422
    assert (
        await s["cadre"].put(
            f"/shop/orders/class/members/{s['buyer'].id}/products/{s['product'].id}",
            json={"variants": [{"quantity": 3}]},
        )
    ).status_code == 422
    assert (
        await s["cadre"].patch(f"/shop/orders/{order_id}", json=order_payload(s, 3))
    ).status_code == 409
    await shop_svc.add_cart_item(
        db_session,
        s["buyer"].id,
        data=CartItemCreate(product_id=s["product"].id, quantity=1),
    )
    with pytest.raises(ValueError, match="班級已結單"):
        await shop_svc.checkout(db_session, s["buyer"])


async def test_payment_locks_empty_class_and_future_categories_but_not_other_scopes(
    db_session, class_deadlines
):
    s = class_deadlines
    assert (await pay_class(s)).json()["updated_orders"] == 0
    await pay_class(s)  # 重送不產生重複班級收款紀錄。
    category = await shop_svc.create_category(
        db_session,
        data=ProductCategoryCreate(name="追加主題", activity_id=s["activity"].id),
        created_by=s["buyer"].id,
    )
    closes = await shop_svc.get_close_status(db_session, [category.id], s["class"].id)
    assert closes[category.id].is_closed is True
    assert (
        await s["student"].put(registration_path(s), json={"variants": [{"quantity": 1}]})
    ).status_code == 409
    assert (
        await s["outsider"].put(registration_path(s), json={"variants": [{"quantity": 1}]})
    ).status_code == 200
    general = await shop_svc.create_category(
        db_session, data=ProductCategoryCreate(name="一般商品"), created_by=s["buyer"].id
    )
    assert (await shop_svc.get_close_status(db_session, [general.id], s["class"].id))[
        general.id
    ] is None
    await pay_class(s, activity_id=None)
    assert (await shop_svc.get_close_status(db_session, [general.id], s["class"].id))[
        general.id
    ].is_closed


async def test_payment_revocation_obeys_unified_cutoff(db_session, class_deadlines):
    s = class_deadlines
    await pay_class(s)
    await pay_class(s, False)
    assert (await status(s))["is_closed"] is False
    assert (
        await s["student"].put(registration_path(s), json={"variants": [{"quantity": 1}]})
    ).status_code == 200
    await pay_class(s)
    s["activity"].order_closes_at = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.flush()
    await pay_class(s, False)
    assert (await status(s))["is_closed"] is True
    assert (await s["student"].put(registration_path(s), json={"variants": []})).status_code == 409


async def test_payment_blocks_family_and_cadre_cannot_confirm_receipt(client, class_deadlines):
    s = class_deadlines
    link = await s["student"].post(
        "/shop/delegation-links", json={"name": "家人", "category_id": str(s["category"].id)}
    )
    path = f"/shop/orders/classes/{s['class'].id}/payment"
    body = {"is_paid": True, "activity_id": str(s["activity"].id)}
    assert (await client.patch(path, json=body)).status_code == 401
    for actor in ["cadre", "student", "outsider"]:
        assert (await s[actor].patch(path, json=body)).status_code == 403
    await pay_class(s)
    assert (
        await s["manager"].post("/shop/delegation/access", json={"token": link.json()["token"]})
    ).status_code == 410


async def test_assisted_order_respects_stock_and_preserves_collection(class_deadlines):
    s = class_deadlines
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
    supplement = await s["cadre"].post("/shop/orders/class", json=order_payload(s))
    assert supplement.status_code == 201
    assert supplement.json()[0]["id"] != order_id


async def test_payment_rejects_missing_activity(class_deadlines):
    s = class_deadlines
    response = await s["manager"].patch(
        f"/shop/orders/classes/{s['class'].id}/payment",
        json={"is_paid": True, "activity_id": "00000000-0000-0000-0000-000000000001"},
    )
    assert response.status_code == 404
