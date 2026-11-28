"""自治機關專頁路由測試（apps/api/src/api/routers/agencies.py）。"""

from __future__ import annotations

import uuid
from datetime import timedelta

from api.core.clock import local_today
from api.models.agency import AgencyEntry, AgencyProfile
from api.models.council_proposal import CouncilProposal
from api.models.judicial_petition import JudicialPetition
from api.models.org import Org, Permission, Position, UserPosition


async def _org_member(db_session, user, *codes: str) -> Org:
    org = Org(name=f"機關-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="秘書")
    db_session.add(position)
    await db_session.flush()
    for code in codes:
        db_session.add(Permission(position_id=position.id, code=code))
    db_session.add(
        UserPosition(
            user_id=user.id,
            position_id=position.id,
            start_date=local_today() - timedelta(days=1),
        )
    )
    await db_session.flush()
    return org


async def _agency(db_session, org: Org | None, **overrides) -> AgencyProfile:
    values = {
        "slug": f"agency-{uuid.uuid4().hex[:6]}",
        "branch": "legislative",
        "name": "學生議會",
        "org_id": org.id if org else None,
        "is_published": True,
    }
    values.update(overrides)
    agency = AgencyProfile(**values)
    db_session.add(agency)
    await db_session.flush()
    return agency


async def test_public_lists_only_published_agencies_and_entries(client, db_session) -> None:
    agency = await _agency(db_session, None, slug="council")
    await _agency(db_session, None, slug="draft-agency", is_published=False)
    db_session.add_all(
        [
            AgencyEntry(agency_id=agency.id, kind="session", title="第一次大會", is_published=True),
            AgencyEntry(agency_id=agency.id, kind="session", title="草稿紀錄"),
        ]
    )
    await db_session.flush()

    listed = await client.get("/agencies")
    assert listed.status_code == 200
    assert [item["slug"] for item in listed.json()] == ["council"]

    page = await client.get("/agencies/council")
    assert page.status_code == 200
    assert [entry["title"] for entry in page.json()["entries"]] == ["第一次大會"]
    assert (await client.get("/agencies/draft-agency")).status_code == 404


async def test_public_members_come_from_bound_org(client, db_session, make_user) -> None:
    member = await make_user(display_name="議長")
    outsider = await make_user(display_name="路人")
    org = await _org_member(db_session, member)
    await _org_member(db_session, outsider)
    await _agency(db_session, org, slug="council")

    page = await client.get("/agencies/council")
    assert [m["display_name"] for m in page.json()["members"]] == ["議長"]


async def test_legislative_tracks_accepted_proposals_without_contact(client, db_session) -> None:
    await _agency(db_session, None, slug="council")
    for status in ("submitted", "committee_review", "withdrawn"):
        db_session.add(
            CouncilProposal(
                serial_number=f"P-{status}",
                contact_email="private@example.test",
                proposer_name=f"提案人-{status}",
                title=f"議案-{status}",
                summary="摘要",
                proposal_text="內容",
                rationale="理由",
                status=status,
            )
        )
    await db_session.flush()

    body = (await client.get("/agencies/council")).json()
    assert [r["reference_no"] for r in body["linked_records"]] == ["P-committee_review"]
    assert body["linked_records"][0]["proposer_name"] == "提案人-committee_review"
    assert "private@example.test" not in str(body)


async def test_judicial_shows_only_published_decisions_without_petitioner(
    client, db_session
) -> None:
    await _agency(db_session, None, slug="judiciary", branch="judicial", name="評議委員會")
    for status in ("in_review", "published"):
        db_session.add(
            JudicialPetition(
                docket_number=f"J-{status}",
                petitioner_name="聲請人甲",
                petitioner_email="petitioner@example.test",
                petition_type="other",
                title=f"評議-{status}",
                challenged_norm="規範",
                constitutional_provisions="條文",
                petition_claim="聲明",
                facts_and_reasons="理由",
                status=status,
                decision_summary="主文",
            )
        )
    await db_session.flush()

    body = (await client.get("/agencies/judiciary")).json()
    assert [r["reference_no"] for r in body["linked_records"]] == ["J-published"]
    assert "聲請人甲" not in str(body)
    assert "petitioner@example.test" not in str(body)


async def test_manage_requires_login(client) -> None:
    assert (await client.get("/agencies/manage")).status_code == 401


async def test_org_maintainer_can_edit_own_agency_only(
    db_session, make_user, authed_client_factory
) -> None:
    user = await make_user()
    own_org = await _org_member(db_session, user, "agency:manage")
    own = await _agency(db_session, own_org, slug="own")
    other_org = Org(name="他組織")
    db_session.add(other_org)
    await db_session.flush()
    other = await _agency(db_session, other_org, slug="other")
    ac = authed_client_factory(user)

    listed = await ac.get("/agencies/manage")
    assert [item["slug"] for item in listed.json()] == ["own"]
    assert listed.json()[0]["can_admin"] is False

    updated = await ac.patch(f"/agencies/manage/{own.id}", json={"tagline": "為學生發聲"})
    assert updated.status_code == 200
    assert updated.json()["tagline"] == "為學生發聲"

    assert (
        await ac.patch(f"/agencies/manage/{other.id}", json={"tagline": "x"})
    ).status_code == 403
    created = await ac.post(
        f"/agencies/manage/{other.id}/entries", json={"kind": "session", "title": "x"}
    )
    assert created.status_code == 403
    # 維護者不能改結構欄位或建立機關
    assert (
        await ac.patch(f"/agencies/manage/{own.id}/admin", json={"org_id": str(other_org.id)})
    ).status_code == 403
    assert (
        await ac.post("/agencies/manage", json={"slug": "new", "branch": "judicial", "name": "x"})
    ).status_code == 403


async def test_member_without_permission_gets_403(
    db_session, make_user, authed_client_factory
) -> None:
    user = await make_user()
    org = await _org_member(db_session, user)
    agency = await _agency(db_session, org)
    ac = authed_client_factory(user)
    assert (await ac.get("/agencies/manage")).json() == []
    assert (await ac.get(f"/agencies/manage/{agency.id}/entries")).status_code == 403


async def test_entry_crud_and_kind_validation(db_session, make_user, authed_client_factory) -> None:
    user = await make_user()
    org = await _org_member(db_session, user, "agency:manage")
    agency = await _agency(db_session, org, branch="judicial", name="評議委員會")
    ac = authed_client_factory(user)
    base = f"/agencies/manage/{agency.id}/entries"

    wrong_kind = await ac.post(base, json={"kind": "bill", "title": "法案"})
    assert wrong_kind.status_code == 422

    bad_link = await ac.post(
        base, json={"kind": "template", "title": "範本", "link_url": "javascript:alert(1)"}
    )
    assert bad_link.status_code == 422

    created = await ac.post(
        base,
        json={
            "kind": "template",
            "title": "評議聲請書範本",
            "link_url": "https://docs.google.com/document/d/abc/edit",
        },
    )
    assert created.status_code == 201
    entry_id = created.json()["id"]

    patched = await ac.patch(f"{base}/{entry_id}", json={"is_published": True})
    assert patched.status_code == 200 and patched.json()["is_published"] is True
    assert len((await ac.get(base)).json()) == 1

    other = await _agency(db_session, org, branch="judicial")
    assert (
        await ac.patch(f"/agencies/manage/{other.id}/entries/{entry_id}", json={"title": "x"})
    ).status_code == 404

    assert (await ac.delete(f"{base}/{entry_id}")).status_code == 204
    assert (await ac.get(base)).json() == []


async def test_site_admin_can_delete_agency(db_session, make_user, authed_client_factory) -> None:
    admin = await make_user()
    await _org_member(db_session, admin, "site:manage")
    agency = await _agency(db_session, None)
    db_session.add(AgencyEntry(agency_id=agency.id, kind="session", title="紀錄"))
    await db_session.flush()
    ac = authed_client_factory(admin)
    assert (await ac.delete(f"/agencies/manage/{agency.id}")).status_code == 204
    assert (await ac.get("/agencies/manage")).json() == []


async def test_site_admin_creates_and_rebinds_agency(
    db_session, make_user, authed_client_factory
) -> None:
    admin = await make_user()
    await _org_member(db_session, admin, "site:manage")
    target = Org(name="學生代表團")
    db_session.add(target)
    await db_session.flush()
    ac = authed_client_factory(admin)

    payload = {"slug": "delegation", "branch": "delegation", "name": "學生代表團"}
    created = await ac.post("/agencies/manage", json=payload)
    assert created.status_code == 201
    agency_id = created.json()["id"]
    reserved = await ac.post("/agencies/manage", json={**payload, "slug": "manage"})
    assert reserved.status_code == 422

    missing_org = await ac.patch(
        f"/agencies/manage/{agency_id}/admin", json={"org_id": str(uuid.uuid4())}
    )
    assert missing_org.status_code == 422
    rebound = await ac.patch(f"/agencies/manage/{agency_id}/admin", json={"org_id": str(target.id)})
    assert rebound.status_code == 200 and rebound.json()["org_id"] == str(target.id)

    listed = (await ac.get("/agencies/manage")).json()
    assert listed[0]["org_name"] == "學生代表團" and listed[0]["can_admin"] is True
    # 409 會 rollback 共用的測試 session，放最後
    assert (await ac.post("/agencies/manage", json=payload)).status_code == 409
