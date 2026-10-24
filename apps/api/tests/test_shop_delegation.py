"""家人代訂的真實資料庫／HTTP 授權與來源隔離回歸。"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from api.core.security import redis_client
from api.models.activity import Activity, ActivityStatus
from api.models.shop import ShopDelegationLink
from api.models.user_identity import UserIdentity
from api.schemas.shop import ProductCategoryCreate, ProductCreate, ShopPromotionCreate
from api.services import shop as shop_svc
from api.services.shop import _delegation, _delegation_codes


@pytest.fixture(autouse=True)
def isolate_code_namespace(monkeypatch):
    import uuid

    monkeypatch.setattr(_delegation_codes, "_PREFIX", f"test:delegation-code:{uuid.uuid4()}:")


@pytest.fixture
async def delegation_setup(db_session, make_user, admin_user, authed_client_factory):
    student = await make_user(student_id="310001", display_name="學生")
    parent = await make_user(email="parent@example.test", display_name="媽媽")
    other = await make_user(email="other@example.test", display_name="其他人")
    activity = Activity(name="校慶", status=ActivityStatus.ACTIVE, is_active=True)
    db_session.add(activity)
    await db_session.flush()
    category = await shop_svc.create_category(
        db_session,
        data=ProductCategoryCreate(name="校慶商品", activity_id=activity.id),
        created_by=admin_user.id,
    )
    product = await shop_svc.create_product(
        db_session,
        data=ProductCreate(
            category_id=category.id,
            name="紀念袋",
            price=100,
            stock_quantity=10,
            max_quantity_per_user=5,
            sale_end=datetime.now(UTC) + timedelta(days=1),
        ),
        created_by=admin_user.id,
    )
    await shop_svc.activate_product(db_session, product)
    sc, pc, oc = [authed_client_factory(user) for user in (student, parent, other)]
    response = await sc.post(
        "/shop/delegation-links",
        json={
            "name": "給媽媽代訂",
            "category_id": str(category.id),
        },
    )
    assert response.status_code == 201
    link = response.json()
    return student, parent, category, product, sc, pc, oc, link


async def _claim(client, link):
    result = await client.post(
        "/shop/delegation/access", json={"token": link["token"], "claim": True}
    )
    assert result.status_code == 200
    return result.json()


@pytest.mark.parametrize("email", ["parent@example.test", "g0210002@hchs.hc.edu.tw"])
async def test_external_account_can_order_only_through_current_students_delegation(
    delegation_setup, db_session, email
):
    student, parent, category, product, sc, pc, oc, link = delegation_setup
    parent.email = email
    await db_session.flush()
    direct = await pc.put(
        f"/shop/registrations/current/products/{product.id}",
        json={"variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert direct.status_code == 403
    await _claim(pc, link)
    delegated = await pc.post(
        f"/shop/delegation/products/{product.id}",
        json={"token": link["token"], "variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert delegated.status_code == 200
    assert delegated.json()["user_id"] == str(student.id)
    assert delegated.json()["items"][0]["ordered_by_id"] == str(parent.id)


async def test_expired_student_id_cannot_keep_using_delegation(delegation_setup, db_session):
    student, parent, category, product, sc, pc, oc, link = delegation_setup
    await _claim(pc, link)
    student.student_id = "210001"
    await db_session.flush()
    created = await sc.post(
        "/shop/delegation-links", json={"name": "失效學生", "category_id": str(category.id)}
    )
    assert created.status_code == 403
    delegated = await pc.post(
        f"/shop/delegation/products/{product.id}",
        json={"token": link["token"], "variants": [{"option_ids": [], "quantity": 1}]},
    )
    assert delegated.status_code == 410


async def test_seven_digit_code_exchanges_for_same_scoped_link(delegation_setup):
    student, parent, category, product, sc, pc, oc, link = delegation_setup
    code = link["authorization_code"]
    assert len(code) == 7 and code.isascii() and code.isdecimal()
    expires_at = datetime.fromisoformat(link["authorization_code_expires_at"])
    remaining = expires_at - datetime.now(UTC)
    assert timedelta(days=6, hours=23) < remaining <= timedelta(days=7)
    key = f"{_delegation_codes._PREFIX}value:{_delegation_codes._digest(code)}"
    assert 0 < await redis_client.ttl(key) <= _delegation_codes.CODE_TTL_SECONDS
    listed = (await sc.get("/shop/delegation-links")).json()
    assert listed[0]["authorization_code"] is None
    assert listed[0]["token"] is None
    exchanged = await pc.post("/shop/delegation/code", json={"code": code})
    assert exchanged.status_code == 200
    assert exchanged.json()["token"] == link["token"]
    preview = await pc.post("/shop/delegation/access", json=exchanged.json())
    assert preview.status_code == 200
    assert preview.json()["can_claim"] is True
    assert preview.json()["registration"] is None
    assert preview.json()["link"]["category_id"] == str(category.id)
    await _claim(pc, exchanged.json())
    denied = await oc.post("/shop/delegation/code", json={"code": code})
    assert denied.status_code == 403
    assert "token" not in denied.json()


async def test_code_requires_login_and_does_not_allow_parent_to_create_authorization(
    delegation_setup, client
):
    student, parent, category, product, sc, pc, oc, link = delegation_setup
    assert (
        await client.post("/shop/delegation/code", json={"code": link["authorization_code"]})
    ).status_code == 401
    assert (
        await pc.post(
            "/shop/delegation-links", json={"name": "家長", "category_id": str(category.id)}
        )
    ).status_code == 403


async def test_alumni_school_account_cannot_create_shop_delegation(
    make_user, authed_client_factory
):
    alumnus = await make_user(
        email="g0110001@hchs.hc.edu.tw", student_id="110001", display_name="校友"
    )
    ac = authed_client_factory(alumnus)

    profile = await ac.get("/auth/me")
    response = await ac.post(
        "/shop/delegation-links",
        json={"name": "校友代訂", "category_id": str(uuid.uuid4())},
    )

    assert profile.json()["can_create_shop_delegation"] is False
    assert response.status_code == 403


@pytest.mark.parametrize("private_primary", [False, True])
async def test_school_identity_can_create_and_use_links_without_stored_student_id(
    delegation_setup, db_session, private_primary
):
    student, parent, category, product, sc, pc, oc, old_link = delegation_setup
    student.student_id = None
    school_email = "g0510001@hchs.hc.edu.tw"
    student.email = "private@example.test" if private_primary else school_email
    if private_primary:
        db_session.add(
            UserIdentity(
                user_id=student.id,
                provider="email",
                external_id=school_email,
                email=school_email,
                linked_at=datetime.now(UTC),
            )
        )
    await db_session.flush()
    profile = await sc.get("/auth/me")
    assert profile.json()["can_create_shop_delegation"] is True
    created = await sc.post(
        "/shop/delegation-links",
        json={"name": "綁定後的邀請", "category_id": str(category.id)},
    )
    assert created.status_code == 201
    claimed = await pc.post(
        "/shop/delegation/access", json={"token": created.json()["token"], "claim": True}
    )
    assert claimed.status_code == 200
    assert claimed.json()["can_edit"] is True
    assert claimed.json()["student_name"] == student.display_name
    assert (
        await oc.post(
            "/shop/delegation/access", json={"token": created.json()["token"], "claim": True}
        )
    ).status_code == 403


@pytest.mark.parametrize("code", ["123456", "12345678", "abcdefg", "１２３４５６７", 1234567])
async def test_code_requires_exactly_seven_ascii_digits(delegation_setup, code):
    student, parent, category, product, sc, pc, oc, link = delegation_setup
    response = await pc.post("/shop/delegation/code", json={"code": code})
    assert response.status_code == 422


async def test_expired_code_does_not_invalidate_share_link(delegation_setup):
    student, parent, category, product, sc, pc, oc, link = delegation_setup
    key = (
        f"{_delegation_codes._PREFIX}value:{_delegation_codes._digest(link['authorization_code'])}"
    )
    await redis_client.expire(key, 0)
    expired = await pc.post("/shop/delegation/code", json={"code": link["authorization_code"]})
    assert expired.status_code == 404
    assert "過期" in expired.json()["detail"]
    assert (
        await pc.post("/shop/delegation/access", json={"token": link["token"]})
    ).status_code == 200


async def test_renewal_and_revocation_disable_old_codes(delegation_setup):
    student, parent, category, product, sc, pc, oc, link = delegation_setup
    new_link = (await sc.post(f"/shop/delegation-links/{link['id']}/renew")).json()
    assert (
        await pc.post("/shop/delegation/code", json={"code": link["authorization_code"]})
    ).status_code == 410
    assert (
        await pc.post("/shop/delegation/code", json={"code": new_link["authorization_code"]})
    ).status_code == 200
    assert (await sc.delete(f"/shop/delegation-links/{new_link['id']}")).status_code == 204
    assert (
        await pc.post("/shop/delegation/code", json={"code": new_link["authorization_code"]})
    ).status_code == 410


async def test_code_rejects_deactivated_student(delegation_setup, db_session):
    student, parent, category, product, sc, pc, oc, link = delegation_setup
    student.is_active = False
    await db_session.flush()
    response = await pc.post("/shop/delegation/code", json={"code": link["authorization_code"]})
    assert response.status_code == 410
    assert "token" not in response.json()


async def test_code_account_attempt_limit_always_applies(delegation_setup):
    student, parent, category, product, sc, pc, oc, link = delegation_setup
    wrong = "0000000" if link["authorization_code"] != "0000000" else "0000001"
    for _ in range(5):
        assert (await pc.post("/shop/delegation/code", json={"code": wrong})).status_code == 404
    limited = await pc.post("/shop/delegation/code", json={"code": link["authorization_code"]})
    assert limited.status_code == 429
    assert "10 分鐘" in limited.json()["detail"]


async def test_code_ip_limit_applies_across_accounts():
    for index in range(30):
        with pytest.raises(_delegation_codes.DelegationCodeError) as error:
            await _delegation_codes.exchange_code(
                "0000000", actor_id=str(index), client_ip="test-ip"
            )
        assert error.value.status_code == 404
    with pytest.raises(_delegation_codes.DelegationCodeError) as error:
        await _delegation_codes.exchange_code("0000000", actor_id="31", client_ip="test-ip")
    assert error.value.status_code == 429


async def test_code_exchange_fails_closed_when_redis_is_unavailable(delegation_setup, monkeypatch):
    from redis.exceptions import ConnectionError

    student, parent, category, product, sc, pc, oc, link = delegation_setup

    async def unavailable(*args, **kwargs):
        raise ConnectionError("synthetic test outage")

    monkeypatch.setattr(redis_client, "get", unavailable)
    response = await pc.post("/shop/delegation/code", json={"code": link["authorization_code"]})
    assert response.status_code == 503
    assert "token" not in response.json()


async def test_code_collision_never_overwrites_previous_authorization(monkeypatch):
    values = iter([1234567, 1234567, 1234568])
    monkeypatch.setattr(_delegation_codes.secrets, "randbelow", lambda maximum: next(values))
    first, _ = await _delegation_codes.issue_code("synthetic-first-token")
    second, _ = await _delegation_codes.issue_code("synthetic-second-token")
    assert first != second
    assert (
        await _delegation_codes.exchange_code(first, actor_id="parent-a", client_ip="ip-a")
        == "synthetic-first-token"
    )
    assert (
        await _delegation_codes.exchange_code(second, actor_id="parent-b", client_ip="ip-b")
        == "synthetic-second-token"
    )


async def _set(client, product, quantity, token=None):
    variants = [{"option_ids": [], "quantity": quantity}] if quantity else []
    if token:
        return await client.post(
            f"/shop/delegation/products/{product.id}",
            json={
                "token": token,
                "variants": variants,
            },
        )
    return await client.put(
        f"/shop/registrations/current/products/{product.id}",
        json={
            "variants": variants,
        },
    )


async def test_unbound_privacy_and_link_ownership(delegation_setup, db_session, client):
    student, parent, category, product, sc, pc, oc, link = delegation_setup
    assert (await _set(sc, product, 1)).status_code == 200
    preview = await pc.post("/shop/delegation/access", json={"token": link["token"]})
    assert preview.status_code == 200
    assert preview.json()["can_claim"] is True
    assert preview.json()["registration"] is None
    assert preview.json()["promotions"] == []
    assert (await _set(pc, product, 1, link["token"])).status_code == 403
    assert (
        await oc.patch(f"/shop/delegation-links/{link['id']}", json={"name": "偷改"})
    ).status_code == 404
    assert (await oc.delete(f"/shop/delegation-links/{link['id']}")).status_code == 404
    assert (
        await pc.post(
            "/shop/delegation-links",
            json={
                "name": "非法",
                "category_id": str(category.id),
            },
        )
    ).status_code == 403
    assert (await client.get("/shop/delegation-links")).status_code == 401
    saved = await db_session.get(ShopDelegationLink, link["id"])
    assert saved.token_hash == _delegation.token_hash(link["token"])
    assert saved.token_hash != link["token"]
    listed = (await sc.get("/shop/delegation-links")).json()
    assert listed[0]["token"] is None


async def test_parent_can_view_student_order_and_edit_only_own_delegated_items(
    delegation_setup, client
):
    student, _, _, product, sc, pc, oc, link = delegation_setup
    student_order = await _set(sc, product, 2)
    await _claim(pc, link)
    parent_order = await _set(pc, product, 1, link["token"])
    assert parent_order.status_code == 200
    order_id = parent_order.json()["id"]
    own_item = next(
        item for item in parent_order.json()["items"] if item["delegation_link_id"] == link["id"]
    )
    student_item = next(
        item for item in parent_order.json()["items"] if item["delegation_link_id"] is None
    )

    assert (await client.get("/shop/orders/delegated")).status_code == 401
    delegated_orders = await pc.get("/shop/orders/delegated")
    assert delegated_orders.status_code == 200
    assert [entry["order"]["id"] for entry in delegated_orders.json()] == [order_id]
    assert delegated_orders.json()[0]["editable_item_ids"] == [own_item["id"]]
    assert (await oc.get("/shop/orders/delegated")).json() == []

    detail = await pc.get(f"/shop/orders/{order_id}")
    assert detail.status_code == 200
    assert {item["id"] for item in detail.json()["items"]} == {own_item["id"], student_item["id"]}
    assert (await oc.get(f"/shop/orders/{order_id}")).status_code == 404
    assert (
        await pc.patch(
            f"/shop/orders/{order_id}",
            json={
                "user_id": str(student.id),
                "items": [{"product_id": str(product.id), "quantity": 1}],
            },
        )
    ).status_code == 403

    changed = await pc.patch(
        f"/shop/orders/{order_id}/items/{own_item['id']}", json={"quantity": 2}
    )
    assert changed.status_code == 200
    changed_item = next(item for item in changed.json()["items"] if item["id"] == own_item["id"])
    assert changed_item["quantity"] == 2
    assert (
        await pc.patch(f"/shop/orders/{order_id}/items/{student_item['id']}", json={"quantity": 1})
    ).status_code == 404
    assert (
        await oc.patch(f"/shop/orders/{order_id}/items/{own_item['id']}", json={"quantity": 1})
    ).status_code == 404
    assert student_order.json()["id"] == order_id


async def test_self_and_delegated_previews_use_the_same_student_registration(
    delegation_setup, db_session
):
    student, parent, category, product, sc, pc, oc, link = delegation_setup
    await shop_svc.create_promotion(
        db_session,
        data=ShopPromotionCreate(
            name="共同登記優惠",
            activity_id=category.activity_id,
            target_identifiers=[student.email],
            code="SHARED",
            discount_type="fixed",
            discount_value=50,
            min_order_price=300,
        ),
        created_by=student.id,
    )
    await _set(sc, product, 1)
    await _claim(pc, link)
    await _set(pc, product, 2, link["token"])

    own = await sc.post(
        "/shop/registrations/current/promotion/preview",
        json={"activity_id": str(category.activity_id), "code": "SHARED"},
    )
    delegated = await pc.post(
        "/shop/delegation/promotion/preview",
        json={"token": link["token"], "code": "SHARED"},
    )
    assert own.status_code == delegated.status_code == 200
    assert own.json() == delegated.json()
    assert delegated.json()["eligible"] is True
    assert delegated.json()["subtotal_price"] == 300
    assert delegated.json()["total_price"] == 250


async def test_reusable_link_combines_coupon_using_student_identity(delegation_setup, db_session):
    student, parent, category, product, sc, pc, oc, link = delegation_setup
    await shop_svc.create_promotion(
        db_session,
        data=ShopPromotionCreate(
            name="學生專屬合計優惠",
            activity_id=category.activity_id,
            target_identifiers=[student.email],
            code="FAMILY",
            discount_type="fixed",
            discount_value=50,
            min_order_price=300,
        ),
        created_by=student.id,
    )
    assert (await _set(sc, product, 1)).status_code == 200
    context = await _claim(pc, link)
    assert context["student_name"] == student.display_name
    assert [p["code"] for p in context["promotions"]] == ["FAMILY"]
    first = await _set(pc, product, 1, link["token"])
    assert first.status_code == 200
    second = await _set(pc, product, 2, link["token"])
    assert second.status_code == 200
    order = second.json()
    assert order["user_id"] == str(student.id)
    assert order["subtotal_price"] == 300
    assert len(order["items"]) == 2
    own = next(i for i in order["items"] if i["delegation_link_id"] is None)
    delegated = next(i for i in order["items"] if i["delegation_link_id"])
    assert own["quantity"] == 1
    assert delegated["quantity"] == 2
    assert delegated["ordered_by_id"] == str(parent.id)
    assert delegated["ordered_by_name"] == "媽媽"
    assert delegated["delegation_name"] == "給媽媽代訂"
    preview = await pc.post(
        "/shop/delegation/promotion/preview", json={"token": link["token"], "code": "FAMILY"}
    )
    assert preview.status_code == 200
    assert preview.json()["eligible"] is True
    assert preview.json()["subtotal_price"] == 300
    applied = await pc.post(
        "/shop/delegation/promotion", json={"token": link["token"], "code": "FAMILY"}
    )
    assert applied.status_code == 200
    assert applied.json()["total_price"] == 250
    # 本人更新只改本人來源，家人兩件仍保留，優惠因合計不足自动撤下。
    updated = await _set(sc, product, 0)
    assert updated.status_code == 200
    assert updated.json()["subtotal_price"] == 200
    assert len(updated.json()["items"]) == 1
    assert updated.json()["discount_amount"] == 0
    delegated_detail = await pc.get(f"/shop/orders/{order['id']}")
    assert delegated_detail.status_code == 200
    assert len(delegated_detail.json()["items"]) == 1
    assert delegated_detail.json()["items"][0]["delegation_link_id"] == link["id"]
    assert (await pc.get("/shop/registrations")).json() == []


async def test_bound_account_scope_and_student_limits(delegation_setup, db_session):
    student, parent, category, product, sc, pc, oc, link = delegation_setup
    await _claim(pc, link)
    assert (
        await oc.post("/shop/delegation/access", json={"token": link["token"], "claim": True})
    ).status_code == 403
    assert (await _set(oc, product, 1, link["token"])).status_code == 403
    assert (await _set(sc, product, 4)).status_code == 200
    limited = await _set(pc, product, 2, link["token"])
    assert limited.status_code == 422
    assert (await _set(pc, product, 1, link["token"])).status_code == 200
    # 其他活動／未綁活動分類不可透過 token 指定商品跨越授權。
    foreign_category = await shop_svc.create_category(
        db_session, data=ProductCategoryCreate(name="其他主題"), created_by=student.id
    )
    foreign = await shop_svc.create_product(
        db_session,
        data=ProductCreate(
            category_id=foreign_category.id, name="其他商品", price=10, is_unlimited=True
        ),
        created_by=student.id,
    )
    await shop_svc.activate_product(db_session, foreign)
    assert (await _set(pc, foreign, 1, link["token"])).status_code == 404
    assert (
        await pc.post(f"/shop/delegation/products/{foreign.id}/read", json={"token": link["token"]})
    ).status_code == 404
    assert (await pc.post("/shop/delegation/access", json={"token": "x" * 43})).status_code == 404
    read = await pc.post(
        f"/shop/delegation/products/{product.id}/read", json={"token": link["token"]}
    )
    assert read.status_code == 200
    assert read.json()["remaining_quantity_for_user"] == 0


async def test_rename_revoke_and_renew_keep_historical_sources(delegation_setup):
    student, parent, category, product, sc, pc, oc, link = delegation_setup
    await _claim(pc, link)
    result = await _set(pc, product, 1, link["token"])
    old_item = result.json()["items"][0]
    rename = await sc.patch(f"/shop/delegation-links/{link['id']}", json={"name": "給家人代訂"})
    assert rename.status_code == 200
    assert (await _set(pc, product, 2, link["token"])).json()["items"][0][
        "delegation_name"
    ] == "給媽媽代訂"
    renewed = await sc.post(f"/shop/delegation-links/{link['id']}/renew")
    assert renewed.status_code == 201
    new_link = renewed.json()
    assert new_link["id"] != link["id"]
    assert new_link["token"] != link["token"]
    assert (await _set(pc, product, 1, link["token"])).status_code == 410
    await _claim(oc, new_link)
    new_order = (await _set(oc, product, 1, new_link["token"])).json()
    assert len(new_order["items"]) == 2
    assert next(i for i in new_order["items"] if i["id"] == old_item["id"])["quantity"] == 2
    assert (await sc.delete(f"/shop/delegation-links/{new_link['id']}")).status_code == 204
    assert (
        await oc.post(
            "/shop/delegation/promotion/preview", json={"token": new_link["token"], "code": None}
        )
    ).status_code == 410


@pytest.mark.parametrize("lock", ["deadline", "paid", "collected", "closed", "inactive"])
async def test_cutoff_and_collection_prevent_changes(delegation_setup, db_session, lock):
    student, parent, category, product, sc, pc, oc, link = delegation_setup
    await _claim(pc, link)
    result = await _set(pc, product, 1, link["token"])
    order = await shop_svc.get_order(db_session, result.json()["id"])
    if lock == "deadline":
        product.sale_end = datetime.now(UTC) - timedelta(seconds=1)
    elif lock == "paid":
        order.is_paid = True
    elif lock == "collected":
        order.is_class_collected = True
    elif lock == "inactive":
        student.is_active = False
    else:
        await shop_svc.close_category_for_class(
            db_session,
            category_id=category.id,
            class_id=None,
            closed_by_id=student.id,
        )
    await db_session.flush()
    response = await _set(pc, product, 2, link["token"])
    assert response.status_code in (409, 410)
    coupon = await pc.post(
        "/shop/delegation/promotion", json={"token": link["token"], "code": None}
    )
    assert coupon.status_code in (409, 410)


async def test_owner_can_adjust_delegated_source_after_revocation(delegation_setup):
    student, parent, category, product, sc, pc, oc, link = delegation_setup
    await _claim(pc, link)
    order = (await _set(pc, product, 2, link["token"])).json()
    item = order["items"][0]
    path = f"/shop/orders/{order['id']}/items/{item['id']}"
    bulk_update = await sc.patch(
        f"/shop/orders/{order['id']}",
        json={
            "user_id": str(student.id),
            "items": [{"product_id": str(product.id), "quantity": 1, "option_ids": []}],
        },
    )
    assert bulk_update.status_code == 409
    unchanged = (await sc.get(f"/shop/orders/{order['id']}")).json()["items"][0]
    assert unchanged["quantity"] == 2
    assert unchanged["delegation_link_id"] == link["id"]
    assert (await oc.patch(path, json={"quantity": 1})).status_code == 404
    assert (await pc.patch(path, json={"quantity": 1})).status_code == 200
    assert (await sc.delete(f"/shop/delegation-links/{link['id']}")).status_code == 204
    assert (await pc.patch(path, json={"quantity": 1})).status_code == 404
    assert (await pc.get("/shop/orders/delegated")).json() == []
    assert (await pc.get(f"/shop/orders/{order['id']}")).status_code == 404
    edited = await sc.patch(path, json={"quantity": 1})
    assert edited.status_code == 200
    assert edited.json()["items"][0]["ordered_by_id"] == str(parent.id)
    assert edited.json()["items"][0]["delegation_name"] == "給媽媽代訂"
    removed = await sc.patch(path, json={"quantity": 0})
    assert removed.status_code == 200
    assert removed.json()["status"] == "cancelled"
    assert (await sc.patch(path, json={"quantity": 101})).status_code == 422


async def test_two_links_never_overwrite_each_other_and_stock_is_shared(
    delegation_setup, db_session
):
    student, parent, category, product, sc, pc, oc, link = delegation_setup
    product.max_quantity_per_user = None
    product.stock_quantity = 3
    await db_session.flush()
    new_link = (
        await sc.post(
            "/shop/delegation-links",
            json={
                "name": "給爸爸代訂",
                "category_id": str(category.id),
            },
        )
    ).json()
    await _claim(pc, link)
    await _claim(oc, new_link)
    assert (await _set(pc, product, 2, link["token"])).status_code == 200
    assert (await _set(oc, product, 2, new_link["token"])).status_code == 409
    assert (await _set(oc, product, 1, new_link["token"])).status_code == 200
    # 已售完仍可減量，僅釋放本來源庫存。
    result = await _set(pc, product, 0, link["token"])
    assert result.status_code == 200
    assert len(result.json()["items"]) == 1
    assert result.json()["items"][0]["delegation_link_id"] == new_link["id"]
    assert product.stock_quantity == 2


async def test_concurrent_claim_and_revocation_use_real_postgres_locks(db_session):
    import asyncio
    import uuid

    from sqlalchemy import delete
    from sqlalchemy.ext.asyncio import AsyncConnection, async_sessionmaker

    from api.models.shop import Product, ProductCategory, ProductStatus
    from api.models.user import User
    from api.schemas.shop import CurrentRegistrationUpdate, ShopDelegationCreate

    bind = db_session.bind
    assert isinstance(bind, AsyncConnection)
    if bind.dialect.name != "postgresql":
        pytest.skip("需要 PostgreSQL row locks")
    factory = async_sessionmaker(bind.engine, expire_on_commit=False)
    ids = [uuid.uuid4() for _ in range(3)]
    async with factory() as session:
        users = [
            User(
                id=uid,
                email=f"{uid}@example.test",
                display_name=f"帳號{index}",
                is_active=True,
                is_verified=True,
                student_id="310001" if index == 0 else None,
            )
            for index, uid in enumerate(ids)
        ]
        session.add_all(users)
        await session.flush()
        category = ProductCategory(name="並發測試", created_by=ids[0])
        session.add(category)
        await session.flush()
        product = Product(
            name="並發商品",
            price=100,
            is_unlimited=True,
            category_id=category.id,
            created_by=ids[0],
            status=ProductStatus.ACTIVE,
        )
        session.add(product)
        await session.flush()
        link = await _delegation.create_link(
            session,
            users[0],
            ShopDelegationCreate(
                name="並發連結",
                category_id=category.id,
            ),
        )
        await session.commit()
        category_id, product_id = category.id, product.id
    try:

        async def claim(actor_id):
            async with factory() as session:
                actor = await session.get(User, actor_id)
                try:
                    await _delegation.resolve_link(session, actor, link.token, claim=True)
                    await session.commit()
                    return 200, actor_id
                except _delegation.DelegationError as error:
                    await session.rollback()
                    return error.status_code, actor_id

        results = await asyncio.wait_for(asyncio.gather(claim(ids[1]), claim(ids[2])), timeout=5)
        assert sorted(code for code, _ in results) == [200, 403]
        winner = next(actor_id for code, actor_id in results if code == 200)
        # 撤銷尚未 commit 時，代訂會等候學生鎖；取得鎖後必須重新檢查撤銷狀態。
        async with factory() as revoker:
            owner = await revoker.get(User, ids[0])
            await _delegation.revoke_link(revoker, owner, link.id)

            async def write():
                async with factory() as session:
                    actor = await session.get(User, winner)
                    try:
                        await _delegation.set_product(
                            session,
                            actor,
                            link.token,
                            product_id,
                            CurrentRegistrationUpdate(variants=[]),
                        )
                        return 200
                    except _delegation.DelegationError as error:
                        return error.status_code

            pending = asyncio.create_task(write())
            await asyncio.sleep(0.05)
            assert not pending.done()
            await revoker.commit()
            assert await asyncio.wait_for(pending, timeout=5) == 410
    finally:
        async with factory() as session:
            await session.execute(
                delete(ShopDelegationLink).where(ShopDelegationLink.id == link.id)
            )
            await session.execute(delete(Product).where(Product.id == product_id))
            await session.execute(delete(ProductCategory).where(ProductCategory.id == category_id))
            await session.execute(delete(User).where(User.id.in_(ids)))
            await session.commit()


async def test_delegate_uses_students_class_for_closure_and_order(delegation_setup, db_session):
    from api.schemas.school_class import ClassManualMemberCreate, SchoolClassCreate
    from api.services import school_class as class_svc

    student, parent, category, product, sc, pc, oc, link = delegation_setup
    student_class = await class_svc.create_class(
        db_session,
        data=SchoolClassCreate(
            academic_year=115,
            class_code="101",
            grade=1,
        ),
        created_by=student.id,
    )
    parent_class = await class_svc.create_class(
        db_session,
        data=SchoolClassCreate(
            academic_year=115,
            class_code="102",
            grade=1,
        ),
        created_by=student.id,
    )
    await class_svc.add_manual_member(
        db_session, student_class, data=ClassManualMemberCreate(user_id=student.id)
    )
    await class_svc.add_manual_member(
        db_session, parent_class, data=ClassManualMemberCreate(user_id=parent.id)
    )
    await _claim(pc, link)
    result = await _set(pc, product, 1, link["token"])
    assert result.status_code == 200
    assert result.json()["class_id"] == str(student_class.id)
    await shop_svc.close_category_for_class(
        db_session, category_id=category.id, class_id=parent_class.id, closed_by_id=student.id
    )
    assert (await _set(pc, product, 2, link["token"])).status_code == 200
    await shop_svc.close_category_for_class(
        db_session, category_id=category.id, class_id=student_class.id, closed_by_id=student.id
    )
    assert (await _set(pc, product, 3, link["token"])).status_code == 410
