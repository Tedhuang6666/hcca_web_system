"""統一期限與班聯收款鎖單；班代不再控制截止。"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from api.core.clock import local_today
from api.models.electronic_credential import ElectronicCredentialSettings
from api.models.org import Org, Permission, Position, UserPosition
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
    category = await shop_svc.create_category(
        db_session,
        data=ProductCategoryCreate(name="商品"),
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


async def test_only_council_can_control_class_cutoff(client, class_deadlines, db_session):
    s = class_deadlines
    body = {"class_id": str(s["class"].id)}
    assert (await client.post(close_path(s), json=body)).status_code == 401
    assert (await client.delete(close_path(s), params=body)).status_code == 401
    for actor in ["student", "outsider", "cadre"]:
        assert (await s[actor].post(close_path(s), json=body)).status_code == 403
        assert (await s[actor].delete(close_path(s), params=body)).status_code == 403
        assert (
            await s[actor].get(f"/shop/categories/{s['category'].id}/class-deadline", params=body)
        ).status_code == 403
    assert await db_session.scalar(select(ShopOrderClose.id)) is None
    assert (await s["cadre"].post(close_path(s), json={})).status_code == 403
    body["closes_at"] = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    assert (await s["cadre"].post(close_path(s), json=body)).status_code == 403
    assert (await s["manager"].post(close_path(s), json=body)).status_code == 201
    # 班代不可取消班聯設定；權限拒絕後結單紀錄仍有效。
    assert (await s["cadre"].delete(close_path(s), params=body)).status_code == 403
    assert (await db_session.scalar(select(ShopOrderClose))).is_active is True
    assert (
        await s["manager"].delete(close_path(s), params={"class_id": body["class_id"]})
    ).status_code == 200


@pytest.mark.parametrize(
    "code", ["shop:manage", "shop:manage_orders", "admin:all", "shop:view_all"]
)
@pytest.mark.parametrize("class_scoped", [False, True])
async def test_council_cutoff_requires_write_permission(
    db_session, make_user, authed_client_factory, class_deadlines, code, class_scoped
):
    s = class_deadlines
    user = await make_user(mfa_enabled=True)
    org = Org(name="結單權限測試")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="結單測試職位")
    db_session.add(position)
    await db_session.flush()
    db_session.add(Permission(position_id=position.id, code=code))
    db_session.add(UserPosition(user_id=user.id, position_id=position.id, start_date=local_today()))
    await db_session.flush()
    actor = authed_client_factory(user)
    body = {"class_id": str(s["class"].id)} if class_scoped else {}
    if code == "shop:view_all":
        assert (await actor.post(close_path(s), json=body)).status_code == 403
        assert (await s["manager"].post(close_path(s), json=body)).status_code == 201
        assert (await actor.delete(close_path(s), params=body)).status_code == 403
        assert (await db_session.scalar(select(ShopOrderClose))).is_active is True
    else:
        assert (await actor.post(close_path(s), json=body)).status_code == 201
        assert (await actor.delete(close_path(s), params=body)).status_code == 200


@pytest.mark.parametrize("scheduled", [False, True])
async def test_class_cutoffs_lock_self_ordering_but_allow_cadre_assistance(
    db_session, class_deadlines, scheduled
):
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
    assert (await status(s))["is_closed"] is True
    assert (
        await s["student"].put(registration_path(s), json={"variants": [{"quantity": 1}]})
    ).status_code == 409
    assert (await s["cadre"].post("/shop/orders/class", json=order_payload(s))).status_code == 201


async def pay_class(s, paid=True):
    response = await s["manager"].patch(
        f"/shop/orders/classes/{s['class'].id}/payment",
        json={"is_paid": paid},
    )
    assert response.status_code == 200, response.text
    return response


async def test_council_payment_locks_self_ordering_but_allows_separate_cadre_supplements(
    db_session, class_deadlines
):
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
    supplement = await s["cadre"].post("/shop/orders/class", json=order_payload(s))
    assert supplement.status_code == 201
    assert supplement.json()[0]["class_id"] is None
    assert supplement.json()[0]["supplement_class_id"] == str(s["class"].id)
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


async def test_class_payment_locks_future_categories_but_not_other_classes(
    db_session, class_deadlines
):
    s = class_deadlines
    assert (await pay_class(s)).json()["updated_orders"] == 0
    await pay_class(s)  # 重送不產生重複班級收款紀錄。
    category = await shop_svc.create_category(
        db_session,
        data=ProductCategoryCreate(name="追加主題"),
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
    ].is_closed is True
    await pay_class(s, paid=False)
    assert (await shop_svc.get_close_status(db_session, [general.id], s["class"].id))[
        general.id
    ] is None


async def test_class_payment_revocation_reopens_registration(db_session, class_deadlines):
    s = class_deadlines
    await pay_class(s)
    await pay_class(s, False)
    assert (await status(s))["is_closed"] is False
    assert (
        await s["student"].put(registration_path(s), json={"variants": [{"quantity": 1}]})
    ).status_code == 200
    await pay_class(s)
    await pay_class(s, False)
    assert (await status(s))["is_closed"] is False
    assert (
        await s["student"].put(registration_path(s), json={"variants": [{"quantity": 1}]})
    ).status_code == 200


async def test_payment_blocks_family_and_cadre_cannot_confirm_receipt(client, class_deadlines):
    s = class_deadlines
    link = await s["student"].post(
        "/shop/delegation-links", json={"name": "家人", "category_id": str(s["category"].id)}
    )
    path = f"/shop/orders/classes/{s['class'].id}/payment"
    body = {"is_paid": True}
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
