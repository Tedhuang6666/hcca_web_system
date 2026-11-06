"""商品管理選人：姓名搜尋、名單核對與活動範圍。"""

from api.core.clock import local_today
from api.models.activity import Activity, ActivityConvener
from api.models.org import Org, Permission, Position, UserPosition
from api.models.person import Person
from api.models.school_class import ClassRosterEntry, SchoolClass


async def test_search_and_batch_lookup_preserve_identity_and_show_roster(
    db_session, make_user, admin_user, authed_client_factory
):
    user = await make_user(student_id="310001", display_name="登入暱稱")
    db_session.add_all(
        [
            Person(
                user_id=user.id,
                student_id="310001",
                display_name="測試同學",
                legal_name="測試本名",
                note="不應公開的備註",
            ),
            Person(student_id="310002", display_name="測試本名"),
        ]
    )
    school_class = SchoolClass(
        academic_year=115, class_code="301", grade=3, label="三年一班", created_by=admin_user.id
    )
    db_session.add(school_class)
    await db_session.flush()
    db_session.add(
        ClassRosterEntry(
            class_id=school_class.id, user_id=user.id, student_id="310001", seat_number=1
        )
    )
    await db_session.flush()
    actor = authed_client_factory(admin_user)

    response = await actor.post("/shop/target-options", json={"keyword": "測試本名"})
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    rows = response.json()
    assert [row["identifier"] for row in rows] == ["310001", "310002"]
    assert rows[0]["display_name"] == "測試本名"
    assert rows[0]["class_label"] == "三年一班"
    assert rows[0]["seat_number"] == 1
    assert rows[0]["account_active"] is True
    assert rows[1]["account_active"] is None
    assert "note" not in rows[0]

    response = await actor.post(
        "/shop/target-options",
        json={"identifiers": [user.email.upper(), "310002", "399999", "310002"]},
    )
    rows = response.json()
    assert [row["identifier"] for row in rows] == [user.email, "310002", "399999"]
    assert rows[0]["student_id"] == "310001"
    assert rows[0]["class_label"] == "三年一班"
    assert rows[1]["matched"] is True
    assert rows[2]["matched"] is False


async def test_lookup_includes_accounts_without_people_and_roster_without_accounts(
    db_session, make_user, admin_user, authed_client_factory
):
    user = await make_user(display_name="外部測試帳號", is_active=False)
    school_class = SchoolClass(
        academic_year=115, class_code="302", grade=3, created_by=admin_user.id
    )
    db_session.add(school_class)
    await db_session.flush()
    db_session.add(ClassRosterEntry(class_id=school_class.id, student_id="310003", seat_number=3))
    await db_session.flush()
    actor = authed_client_factory(admin_user)
    response = await actor.post("/shop/target-options", json={"keyword": "外部測試"})
    assert response.status_code == 200, response.text
    assert response.json()[0]["identifier"] == user.email
    assert response.json()[0]["account_active"] is False
    response = await actor.post("/shop/target-options", json={"identifiers": ["310003"]})
    assert response.json()[0]["class_label"] == "302 班"
    assert response.json()[0]["matched"] is True
    assert response.json()[0]["display_name"] is None


async def test_target_lookup_requires_permission_and_respects_activity_scope(
    client, db_session, make_user, authed_client_factory
):
    user = await make_user()
    actor = authed_client_factory(user)
    assert (await client.post("/shop/target-options", json={"keyword": "測試"})).status_code == 401
    assert (await actor.post("/shop/target-options", json={"keyword": "測試"})).status_code == 403
    activity = Activity(name="可管理活動")
    other = Activity(name="其他活動")
    db_session.add_all([activity, other])
    await db_session.flush()
    db_session.add(
        ActivityConvener(activity_id=activity.id, user_id=user.id, start_date=local_today())
    )
    await db_session.flush()
    response = await actor.post(
        "/shop/target-options", json={"activity_id": str(activity.id), "keyword": "測試"}
    )
    assert response.status_code == 200, response.text
    response = await actor.post(
        "/shop/target-options", json={"activity_id": str(other.id), "keyword": "測試"}
    )
    assert response.status_code == 403
    assert (await actor.post("/shop/target-options", json={"keyword": "測試"})).status_code == 403


async def test_empty_search_and_wildcards_do_not_list_everyone(
    admin_user, make_user, authed_client_factory
):
    await make_user(display_name="搜尋測試")
    actor = authed_client_factory(admin_user)
    for keyword in ("", "  ", "%", "_"):
        response = await actor.post("/shop/target-options", json={"keyword": keyword})
        assert response.status_code == 200, response.text
        assert response.json() == []


async def test_shop_manager_can_search_without_people_management_permission(
    db_session, make_user, authed_client_factory
):
    user = await make_user()
    org = Org(name="測試商品管理組")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="商品管理員")
    db_session.add(position)
    await db_session.flush()
    db_session.add_all(
        [
            Permission(position_id=position.id, code="shop:manage"),
            UserPosition(user_id=user.id, position_id=position.id, start_date=local_today()),
        ]
    )
    await db_session.flush()
    actor = authed_client_factory(user)
    assert (await actor.get("/people", params={"keyword": "測試"})).status_code == 403
    response = await actor.post("/shop/target-options", json={"keyword": "測試"})
    assert response.status_code == 200, response.text
