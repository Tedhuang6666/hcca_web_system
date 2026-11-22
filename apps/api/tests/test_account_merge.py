"""帳戶合併的資料保留、內部欄位自動處理與權限回歸。"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies.auth import get_current_active_user
from api.main import app
from api.models.announcement import Announcement, AnnouncementRead
from api.models.council_proposal import CouncilProposal
from api.models.discord_account import DiscordNotificationPreference
from api.models.school_class import ClassCorrectionRequest, SchoolClass
from api.models.shop import Cart, CartItem, Product, ProductCategory
from api.models.user import User
from api.models.web_push import WebPushSubscription
from api.services import user_registration as merge_svc
from tests.test_admin_routes import _override_user, _seed_admin_data


@pytest.mark.asyncio
async def test_merge_internal_duplicates_keeps_main_settings_and_all_cart_items(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin, primary, _, _, _ = await _seed_admin_data(db_session)
    sources = [User(email=f"auto-{i}@example.test", display_name="同一人") for i in range(2)]
    db_session.add_all(sources)
    await db_session.flush()
    users = [primary, *sources]
    announcement = Announcement(title="公告", content={}, author_id=admin.id)
    category = ProductCategory(name="測試分類", created_by=admin.id)
    db_session.add(category)
    await db_session.flush()
    product = Product(name="測試商品", price=10, category_id=category.id, created_by=admin.id)
    db_session.add_all([announcement, product])
    await db_session.flush()
    carts = []
    for i, user in enumerate(users):
        cart = Cart(user_id=user.id)
        carts.append(cart)
        db_session.add_all(
            [
                cart,
                DiscordNotificationPreference(user_id=user.id, preferences={"shop_ready": i == 0}),
                WebPushSubscription(
                    user_id=user.id,
                    endpoint="https://push.test/shared",
                    p256dh=f"key-{i}",
                    auth=f"auth-{i}",
                ),
                AnnouncementRead(user_id=user.id, announcement_id=announcement.id),
            ]
        )
    await db_session.flush()
    for i, cart in enumerate(carts):
        db_session.add(CartItem(cart_id=cart.id, product_id=product.id, quantity=i + 1))
    await db_session.flush()
    main_cart_id = carts[0].id
    _override_user(admin)
    body = {"source_user_ids": [str(source.id) for source in sources]}
    preview = await client.post(f"/admin/users/{primary.id}/merge/preview", json=body)
    assert preview.status_code == 200, preview.text
    assert preview.json()["conflicts"] == []
    # 預覽不能修改 UUID 或刪除任何資料。
    assert len((await db_session.scalars(select(Cart))).all()) == 3
    result = await client.post(f"/admin/users/{primary.id}/merge", json=body)
    assert result.status_code == 200, result.text
    assert result.json()["id"] == str(primary.id)
    preference = (
        await db_session.execute(
            select(DiscordNotificationPreference.__table__).where(
                DiscordNotificationPreference.user_id == primary.id
            )
        )
    ).one()
    assert preference.preferences == {"shop_ready": True}
    subscriptions = (
        await db_session.scalars(
            select(WebPushSubscription).where(WebPushSubscription.user_id == primary.id)
        )
    ).all()
    assert len(subscriptions) == 1
    assert subscriptions[0].p256dh == "key-0"
    assert len((await db_session.scalars(select(AnnouncementRead))).all()) == 1
    assert len((await db_session.scalars(select(Cart))).all()) == 1
    cart_items = (
        await db_session.scalars(select(CartItem).where(CartItem.cart_id == main_cart_id))
    ).all()
    assert sorted(item.quantity for item in cart_items) == [1, 2, 3]


@pytest.mark.asyncio
async def test_merge_partial_unique_index_keeps_review_history_and_other_actors(
    db_session: AsyncSession,
) -> None:
    admin, primary, _, _, _ = await _seed_admin_data(db_session)
    source = User(email="history@example.test", display_name="歷史帳號")
    db_session.add(source)
    school_class = SchoolClass(academic_year=115, class_code="101", grade=1, created_by=admin.id)
    db_session.add(school_class)
    await db_session.flush()
    requests = [
        ClassCorrectionRequest(
            user_id=user.id,
            requested_class_id=school_class.id,
            status=status,
            reviewed_by_id=admin.id,
        )
        for user, status in [(primary, "pending"), (source, "approved"), (source, "rejected")]
    ]
    proposal = CouncilProposal(
        serial_number="MERGE-HISTORY",
        submitter_id=source.id,
        contact_email="history@example.test",
        proposer_name="歷史姓名",
        title="歷史投稿",
        summary="摘要",
        proposal_text="內容",
        rationale="理由",
    )
    db_session.add_all([*requests, proposal])
    await db_session.flush()
    preview = await merge_svc.preview_merge_user_accounts(
        db_session, user=primary, source_users=[source]
    )
    assert preview == []
    await merge_svc.merge_user_accounts(db_session, user=primary, source_user=source, actor=admin)
    for request in requests:
        await db_session.refresh(request)
        assert request.user_id == primary.id
        assert request.reviewed_by_id == admin.id
    await db_session.refresh(proposal)
    assert proposal.submitter_id == primary.id
    assert proposal.proposer_name == "歷史姓名"
    assert proposal.contact_email == "history@example.test"


@pytest.mark.asyncio
async def test_pending_class_corrections_offer_choice_but_identical_content_auto_resolves(
    db_session: AsyncSession,
) -> None:
    admin, primary, _, _, _ = await _seed_admin_data(db_session)
    source = User(email="pending@example.test", display_name="待合併")
    school_class = SchoolClass(academic_year=115, class_code="102", grade=1, created_by=admin.id)
    db_session.add_all([source, school_class])
    await db_session.flush()
    requests = [
        ClassCorrectionRequest(user_id=user.id, requested_class_id=school_class.id, message=message)
        for user, message in [(primary, "請修正班級"), (source, "其他說明")]
    ]
    db_session.add_all(requests)
    await db_session.flush()
    conflicts = await merge_svc.preview_merge_user_accounts(
        db_session, user=primary, source_users=[source]
    )
    assert len(conflicts) == 1
    assert conflicts[0]["resolvable"] is True
    assert {record["fields"]["申請說明"] for record in conflicts[0]["records"]} == {
        "請修正班級",
        "其他說明",
    }
    requests[1].message = requests[0].message
    await db_session.flush()
    assert (
        await merge_svc.preview_merge_user_accounts(db_session, user=primary, source_users=[source])
        == []
    )
    await merge_svc.merge_user_accounts(db_session, user=primary, source_user=source, actor=admin)
    assert len((await db_session.scalars(select(ClassCorrectionRequest))).all()) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("authenticated", [False, True])
async def test_merge_requires_admin(
    client: AsyncClient, db_session: AsyncSession, authenticated: bool
) -> None:
    _, primary, _, _, _ = await _seed_admin_data(db_session)
    source = User(email="forbidden@example.test", display_name="無權限")
    db_session.add(source)
    await db_session.flush()
    if authenticated:
        _override_user(primary)
    else:
        app.dependency_overrides.pop(get_current_active_user, None)
    for suffix in ["/preview", ""]:
        response = await client.post(
            f"/admin/users/{primary.id}/merge{suffix}", json={"source_user_ids": [str(source.id)]}
        )
        assert response.status_code == (403 if authenticated else 401)
    await db_session.refresh(source)
    assert source.is_active is True


@pytest.mark.asyncio
async def test_merge_person_business_fields_require_choice_but_account_ids_do_not(
    db_session: AsyncSession,
) -> None:
    from api.models.person import Person

    admin, primary, _, _, _ = await _seed_admin_data(db_session)
    primary.student_id = "PRIMARY"
    source = User(email="profile@example.test", display_name="次要名稱", student_id="SOURCE")
    db_session.add(source)
    await db_session.flush()
    people = [
        Person(
            user_id=user.id,
            display_name=user.display_name,
            email=user.email,
            legal_name=name,
            note=note,
        )
        for user, name, note in [(primary, "原姓名", "原備註"), (source, "正確姓名", "新備註")]
    ]
    db_session.add_all(people)
    await db_session.flush()
    conflicts = await merge_svc.preview_merge_user_accounts(
        db_session, user=primary, source_users=[source]
    )
    assert {conflict["title"] for conflict in conflicts} == {"法定姓名衝突", "人員備註衝突"}
    resolutions = {
        conflict["key"]: next(
            record["id"] for record in conflict["records"] if record["side"] == "source"
        )
        for conflict in conflicts
    }
    await merge_svc.merge_user_accounts(
        db_session, user=primary, source_user=source, actor=admin, conflict_resolutions=resolutions
    )
    person = await db_session.scalar(select(Person).where(Person.user_id == primary.id))
    assert person is not None
    await db_session.refresh(person)
    assert person.legal_name == "正確姓名"
    assert person.note == "新備註"
    assert primary.student_id == "PRIMARY"
    assert primary.display_name == "幹部"
    assert person.email == primary.email


@pytest.mark.asyncio
async def test_google_tasks_internal_tokens_auto_resolve_but_different_accounts_need_choice(
    db_session: AsyncSession,
) -> None:
    from api.models.user_google_tasks import UserGoogleTasksConfig

    admin, primary, _, _, _ = await _seed_admin_data(db_session)
    source = User(email="tasks-source@example.test", display_name="次要帳號")
    db_session.add(source)
    await db_session.flush()
    configs = [
        UserGoogleTasksConfig(
            user_id=user.id,
            authorized_email="tasks@example.test",
            google_tasklist_id="same-list",
            _access_token_enc=f"fixture-token-{i}",
        )
        for i, user in enumerate([primary, source])
    ]
    db_session.add_all(configs)
    await db_session.flush()
    assert (
        await merge_svc.preview_merge_user_accounts(db_session, user=primary, source_users=[source])
        == []
    )
    configs[1].authorized_email = "other-tasks@example.test"
    await db_session.flush()
    conflicts = await merge_svc.preview_merge_user_accounts(
        db_session, user=primary, source_users=[source]
    )
    assert len(conflicts) == 1
    assert conflicts[0]["title"] == "Google Tasks 連結"
    assert "other-tasks@example.test" in str(conflicts[0]["records"])
    assert "fixture-token" not in str(conflicts)
    configs[1].authorized_email = configs[0].authorized_email
    await db_session.flush()
    await merge_svc.merge_user_accounts(db_session, user=primary, source_user=source, actor=admin)
    rows = (await db_session.scalars(select(UserGoogleTasksConfig))).all()
    assert len(rows) == 1
    assert rows[0].id == configs[0].id
