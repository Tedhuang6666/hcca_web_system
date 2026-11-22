"""學生由預購明細直接修改規格與數量，保留原單及來源。"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from api.models.receivable import Receivable
from api.models.shop import ShopDelegationLink
from api.schemas.shop import (
    CurrentRegistrationUpdate,
    ProductCategoryCreate,
    ProductCreate,
    ProductVariantGroupCreate,
    ProductVariantOptionCreate,
    RegistrationVariantCreate,
    ShopPromotionCreate,
)
from api.services import shop as shop_svc


@pytest.fixture
async def item_edit(db_session, make_user, admin_user, authed_client_factory):
    student = await make_user(student_id="310001", display_name="學生")
    other = await make_user(student_id="310002")
    category = await shop_svc.create_category(
        db_session, data=ProductCategoryCreate(name="服飾"), created_by=admin_user.id
    )
    product = await shop_svc.create_product(
        db_session,
        data=ProductCreate(
            category_id=category.id,
            name="紀念衫",
            price=100,
            stock_quantity=20,
            max_quantity_per_user=5,
            sale_end=datetime.now(UTC) + timedelta(days=1),
        ),
        created_by=admin_user.id,
    )
    size = await shop_svc.add_variant_group(
        db_session,
        product,
        data=ProductVariantGroupCreate(
            name="尺寸",
            options=[
                ProductVariantOptionCreate(value="M"),
                ProductVariantOptionCreate(value="L", price_delta=20),
            ],
        ),
    )
    color = await shop_svc.add_variant_group(
        db_session,
        product,
        data=ProductVariantGroupCreate(
            name="顏色",
            options=[
                ProductVariantOptionCreate(value="紅"),
                ProductVariantOptionCreate(value="藍", price_delta=5),
            ],
        ),
    )
    await shop_svc.activate_product(db_session, product)
    m, large = [option.id for option in size.options]
    red, blue = [option.id for option in color.options]
    await shop_svc.create_promotion(
        db_session,
        data=ShopPromotionCreate(
            name="滿額折抵", discount_type="fixed", discount_value=25, min_order_price=300
        ),
        created_by=admin_user.id,
    )
    order = await shop_svc.set_current_registration_product(
        db_session,
        student,
        product.id,
        data=CurrentRegistrationUpdate(
            variants=[
                RegistrationVariantCreate(option_ids=[m, red], quantity=2),
                RegistrationVariantCreate(option_ids=[large, blue], quantity=1),
            ]
        ),
    )
    item, untouched = order.items
    path = f"/shop/orders/{order.id}/items/{item.id}"
    return {
        "student": student,
        "other": other,
        "product": product,
        "order": order,
        "item": item,
        "untouched": untouched,
        "path": path,
        "m": m,
        "large": large,
        "red": red,
        "blue": blue,
        "category": category,
        "client": authed_client_factory(student),
        "other_client": authed_client_factory(other),
        "admin": authed_client_factory(admin_user),
    }


@pytest.mark.parametrize("quantity", [2, 3])
async def test_student_edits_size_and_quantity_in_place(item_edit, db_session, quantity):
    f = item_edit
    item_id, untouched_id = str(f["item"].id), str(f["untouched"].id)
    response = await f["client"].patch(
        f["path"],
        json={
            "quantity": quantity,
            "option_ids": [str(f["large"]), str(f["red"])],
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["id"] == str(f["order"].id)
    assert result["serial_number"] == f["order"].serial_number
    items = {item["id"]: item for item in result["items"]}
    assert items[item_id]["quantity"] == quantity
    assert items[item_id]["unit_price"] == 120
    assert items[item_id]["ordered_by_id"] == str(f["student"].id)
    assert items[untouched_id]["quantity"] == 1
    assert items[untouched_id]["unit_price"] == 125
    assert result["subtotal_price"] == 120 * quantity + 125
    assert result["discount_amount"] == 25
    assert result["total_price"] == 120 * quantity + 100
    assert f["product"].stock_quantity == 19 - quantity
    receivable = await db_session.scalar(
        select(Receivable).where(Receivable.source_id == f["order"].id)
    )
    assert receivable.amount == result["total_price"]


async def test_size_change_works_without_spare_stock(item_edit, db_session):
    f = item_edit
    f["product"].stock_quantity = 0
    await db_session.flush()
    response = await f["client"].patch(
        f["path"],
        json={
            "quantity": 2,
            "option_ids": [str(f["large"]), str(f["red"])],
        },
    )
    assert response.status_code == 200, response.text
    assert f["product"].stock_quantity == 0


@pytest.mark.parametrize("lock", ["paid", "collected", "deadline", "closed"])
async def test_size_edits_respect_order_locks(item_edit, db_session, lock):
    f = item_edit
    if lock == "paid":
        f["order"].is_paid = True
    elif lock == "collected":
        f["order"].is_class_collected = True
    elif lock == "deadline":
        f["product"].sale_end = datetime.now(UTC) - timedelta(seconds=1)
    else:
        await shop_svc.close_category_for_class(
            db_session, category_id=f["category"].id, class_id=None, closed_by_id=f["student"].id
        )
    await db_session.flush()
    response = await f["client"].patch(
        f["path"],
        json={
            "quantity": 2,
            "option_ids": [str(f["large"]), str(f["red"])],
        },
    )
    assert response.status_code == 409
    assert f["item"].unit_price == 100
    assert f["product"].stock_quantity == 17


@pytest.mark.parametrize("invalid", ["missing", "foreign", "duplicate", "inactive", "null"])
async def test_invalid_size_is_rejected_without_mutating_order(item_edit, db_session, invalid):
    f = item_edit
    options = [str(f["large"]), str(f["red"])]
    if invalid == "missing":
        options = []
    elif invalid == "foreign":
        options[0] = str(uuid.uuid4())
    elif invalid == "duplicate":
        options.append(options[0])
    elif invalid == "null":
        options = None
    else:
        from api.models.shop import ProductVariantOption

        option = await db_session.get(ProductVariantOption, f["large"])
        option.is_active = False
        await db_session.flush()
    response = await f["client"].patch(f["path"], json={"quantity": 2, "option_ids": options})
    assert response.status_code == (422 if invalid == "null" else 409)
    assert f["item"].unit_price == 100
    assert f["product"].stock_quantity == 17


async def test_edit_requires_login_and_item_ownership(item_edit, client):
    f = item_edit
    body = {"quantity": 2, "option_ids": [str(f["large"]), str(f["red"])]}
    assert (await client.patch(f["path"], json=body)).status_code == 401
    assert (await f["other_client"].patch(f["path"], json=body)).status_code == 404
    assert f["item"].unit_price == 100


async def test_omitted_options_keep_existing_variant(item_edit):
    f = item_edit
    response = await f["client"].patch(f["path"], json={"quantity": 1})
    assert response.status_code == 200
    item = next(item for item in response.json()["items"] if item["id"] == str(f["item"].id))
    assert {option["option_id"] for option in item["selected_options"]} == {
        str(f["m"]),
        str(f["red"]),
    }


@pytest.mark.parametrize("actor", ["client", "other_client"])
async def test_authorized_actor_edits_delegated_size_without_changing_source(
    item_edit, db_session, actor
):
    f = item_edit
    link = ShopDelegationLink(
        user_id=f["student"].id,
        bound_user_id=f["other"].id,
        category_id=f["category"].id,
        name="家人代訂",
        token_hash=uuid.uuid4().hex,
    )
    db_session.add(link)
    await db_session.flush()
    f["item"].delegation_link_id = link.id
    f["item"].delegation_name = link.name
    f["item"].ordered_by_id = f["other"].id
    f["item"].ordered_by_name = "家人"
    await db_session.flush()
    response = await f[actor].patch(
        f["path"],
        json={
            "quantity": 2,
            "option_ids": [str(f["large"]), str(f["red"])],
        },
    )
    assert response.status_code == 200, response.text
    changed = next(item for item in response.json()["items"] if item["id"] == str(f["item"].id))
    assert changed["delegation_link_id"] == str(link.id)
    assert changed["ordered_by_id"] == str(f["other"].id)
    assert changed["ordered_by_name"] == "家人"


async def test_order_manager_can_update_size_through_the_same_contract(item_edit):
    f = item_edit
    response = await f["admin"].patch(
        f["path"],
        json={
            "quantity": 2,
            "option_ids": [str(f["large"]), str(f["red"])],
        },
    )
    assert response.status_code == 200, response.text
    changed = next(item for item in response.json()["items"] if item["id"] == str(f["item"].id))
    assert changed["unit_price"] == 120
    assert f["product"].stock_quantity == 17
