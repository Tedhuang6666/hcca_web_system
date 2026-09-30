"""行事曆（calendar.py）Router 層測試 - 事件 CRUD / 可見性 / Google Calendar 同步邊界。

Google Calendar 是真正的外部邊界（OAuth + Google API），一律 mock 掉服務層函式，
不對外發送真實請求；`_trigger_google_push` 在沒有 OrgGoogleCalendarConfig 時本來
就是 no-op，一般 CRUD 測試不需要額外 mock。
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

from api.models.calendar import CalendarEvent, CalendarVisibility
from api.models.document import (
    Document,
    DocumentClassification,
    DocumentStatus,
    DocumentVisibility,
)
from api.models.google_calendar import OrgGoogleCalendarConfig
from api.models.org import Org, Permission, Position, UserPosition
from api.models.user import User

# ── 測試輔助 ──────────────────────────────────────────────────────────────────


async def _grant_permission(db, user: User, code: str) -> None:
    from api.core.cache import cache_invalidate_user_permissions

    org = Org(name=f"org-{uuid.uuid4().hex[:6]}")
    db.add(org)
    await db.flush()
    position = Position(org_id=org.id, name="測試職位")
    db.add(position)
    await db.flush()
    db.add(Permission(position_id=position.id, code=code))
    db.add(UserPosition(user_id=user.id, position_id=position.id, start_date=date.today()))
    await db.flush()
    await cache_invalidate_user_permissions(str(user.id))


async def _bare_user(db) -> User:
    user = User(
        email=f"u-{uuid.uuid4().hex[:8]}@school.edu",
        display_name="測試使用者",
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _make_projection_document(
    org: Org,
    creator: User,
    *,
    title: str,
    due_at: datetime,
    visibility: DocumentVisibility = DocumentVisibility.ORG_ONLY,
    classification: DocumentClassification = DocumentClassification.NORMAL,
    status: DocumentStatus = DocumentStatus.APPROVED,
    is_public: bool = False,
) -> Document:
    return Document(
        serial_number=f"DOC-{uuid.uuid4().hex[:10]}",
        title=title,
        org_id=org.id,
        created_by=creator.id,
        status=status,
        classification=classification,
        subject=f"{title} 的內文主旨",
        due_date=due_at,
        visibility_level=visibility,
        is_public=is_public,
    )


def _make_legacy_document_projection(doc: Document, creator: User) -> CalendarEvent:
    assert doc.due_date is not None
    return CalendarEvent(
        org_id=doc.org_id,
        title=doc.title,
        description=doc.subject,
        visibility=CalendarVisibility.PUBLIC,
        starts_at=doc.due_date,
        source_module="document",
        source_id=doc.id,
        source_key="due_date",
        href=f"/documents/{doc.serial_number}",
        created_by=creator.id,
    )


_NOW = datetime.now(UTC).replace(microsecond=0)


# ── 事件 CRUD ─────────────────────────────────────────────────────────────────


async def test_create_event_without_permission_returns_403(
    member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.post(
        "/calendar/events",
        json={
            "org_id": str(uuid.uuid4()),
            "title": "無權限事件",
            "starts_at": _iso(_NOW),
        },
    )
    assert resp.status_code == 403


async def test_create_event_with_permission_succeeds(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "calendar:create")
    org = Org(name="測試組織")
    db_session.add(org)
    await db_session.flush()

    ac = authed_client_factory(member_user)
    resp = await ac.post(
        "/calendar/events",
        json={
            "org_id": str(org.id),
            "title": "期初大會",
            "starts_at": _iso(_NOW),
            "ends_at": _iso(_NOW + timedelta(hours=2)),
        },
    )
    assert resp.status_code == 201
    assert resp.json()["title"] == "期初大會"


async def test_get_event_hidden_for_user_outside_org_returns_403(
    db_session, member_user, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    org = Org(name="外部組織")
    db_session.add(org)
    await db_session.flush()
    event = CalendarEvent(
        org_id=org.id,
        title="組織內部活動",
        visibility=CalendarVisibility.ORG,
        starts_at=_NOW,
        created_by=creator.id,
    )
    db_session.add(event)
    await db_session.flush()

    ac = authed_client_factory(member_user)
    resp = await ac.get(f"/calendar/events/{event.id}")
    assert resp.status_code == 403


async def test_get_event_visible_to_logged_in_visibility(
    db_session, member_user, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    event = CalendarEvent(
        org_id=None,
        title="全校公開活動",
        visibility=CalendarVisibility.LOGGED_IN,
        starts_at=_NOW,
        created_by=creator.id,
    )
    db_session.add(event)
    await db_session.flush()

    ac = authed_client_factory(member_user)
    resp = await ac.get(f"/calendar/events/{event.id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == str(event.id)


async def test_list_events_preserves_document_visibility_and_hides_restricted_projections(
    db_session, member_user, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    outsider = await _bare_user(db_session)
    org = Org(name=f"文件投影-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()

    position = Position(org_id=org.id, name="文件讀者")
    db_session.add(position)
    await db_session.flush()
    db_session.add(
        UserPosition(user_id=member_user.id, position_id=position.id, start_date=date.today())
    )

    due_at = datetime.now(UTC).replace(microsecond=0) + timedelta(days=3)
    org_doc = _make_projection_document(org, creator, title="機關內部公文", due_at=due_at)
    login_doc = _make_projection_document(
        org,
        creator,
        title="登入後可見公文",
        due_at=due_at,
        visibility=DocumentVisibility.PUBLIC,
    )
    public_doc = _make_projection_document(
        org,
        creator,
        title="匿名可見公文",
        due_at=due_at,
        visibility=DocumentVisibility.PUBLICLY_OPEN,
    )
    legacy_public_doc = _make_projection_document(
        org,
        creator,
        title="舊版公開旗標公文",
        due_at=due_at,
        visibility=DocumentVisibility.SUBJECT_ONLY,
        is_public=True,
    )
    secret_doc = _make_projection_document(
        org,
        creator,
        title="密等公文不得出現在日曆",
        due_at=due_at,
        visibility=DocumentVisibility.PUBLICLY_OPEN,
        classification=DocumentClassification.SECRET,
    )
    subject_only_doc = _make_projection_document(
        org,
        creator,
        title="限定對象公文不得出現在日曆",
        due_at=due_at,
        visibility=DocumentVisibility.SUBJECT_ONLY,
    )
    draft_doc = _make_projection_document(
        org,
        creator,
        title="未核准公文不得出現在日曆",
        due_at=due_at,
        visibility=DocumentVisibility.PUBLICLY_OPEN,
        status=DocumentStatus.DRAFT,
    )
    db_session.add_all(
        [org_doc, login_doc, public_doc, legacy_public_doc, secret_doc, subject_only_doc, draft_doc]
    )
    await db_session.flush()

    stale_events = [
        _make_legacy_document_projection(doc, creator)
        for doc in (secret_doc, subject_only_doc, draft_doc)
    ]
    previously_public_org_event = _make_legacy_document_projection(org_doc, creator)
    db_session.add_all([*stale_events, previously_public_org_event])
    await db_session.flush()

    params = {
        "start": _iso(due_at - timedelta(hours=1)),
        "end": _iso(due_at + timedelta(hours=1)),
    }
    org_reader = authed_client_factory(member_user)
    org_response = await org_reader.get("/calendar/events", params=params)
    assert org_response.status_code == 200, org_response.text
    org_events = {event["title"]: event for event in org_response.json()}

    assert org_events["公文期限：機關內部公文"]["visibility"] == "org"
    assert org_events["公文期限：登入後可見公文"]["visibility"] == "logged_in"
    assert org_events["公文期限：匿名可見公文"]["visibility"] == "public"
    assert org_events["公文期限：舊版公開旗標公文"]["visibility"] == "public"
    for hidden_title in (
        secret_doc.title,
        subject_only_doc.title,
        draft_doc.title,
    ):
        assert f"公文期限：{hidden_title}" not in org_events
        assert hidden_title not in org_response.text

    outside_reader = authed_client_factory(outsider)
    outside_response = await outside_reader.get("/calendar/events", params=params)
    assert outside_response.status_code == 200, outside_response.text
    outside_titles = {event["title"] for event in outside_response.json()}
    assert "公文期限：機關內部公文" not in outside_titles
    assert "公文期限：登入後可見公文" in outside_titles
    assert "公文期限：匿名可見公文" in outside_titles

    for event in stale_events:
        await db_session.refresh(event)
        assert not event.is_active
    await db_session.refresh(previously_public_org_event)
    assert previously_public_org_event.is_active
    assert previously_public_org_event.visibility == CalendarVisibility.ORG


async def test_update_event_by_unrelated_user_returns_403(
    db_session, member_user, authed_client_factory
) -> None:
    creator = await _bare_user(db_session)
    event = CalendarEvent(
        org_id=None,
        title="公開活動",
        visibility=CalendarVisibility.LOGGED_IN,
        starts_at=_NOW,
        created_by=creator.id,
    )
    db_session.add(event)
    await db_session.flush()

    ac = authed_client_factory(member_user)
    resp = await ac.patch(f"/calendar/events/{event.id}", json={"title": "亂改"})
    assert resp.status_code == 403


async def test_update_and_delete_event_by_creator_succeeds(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "calendar:create")
    org = Org(name="幹部組織")
    db_session.add(org)
    await db_session.flush()
    ac = authed_client_factory(member_user)
    created = await ac.post(
        "/calendar/events",
        json={"org_id": str(org.id), "title": "幹部會議", "starts_at": _iso(_NOW)},
    )
    event_id = created.json()["id"]

    updated = await ac.patch(f"/calendar/events/{event_id}", json={"title": "幹部會議（改期）"})
    assert updated.status_code == 200
    assert updated.json()["title"] == "幹部會議（改期）"

    deleted = await ac.delete(f"/calendar/events/{event_id}")
    assert deleted.status_code == 204


async def test_delete_meeting_linked_event_returns_409(
    db_session, member_user, authed_client_factory
) -> None:
    from api.models.meeting import Meeting

    await _grant_permission(db_session, member_user, "calendar:admin")
    org = Org(name="會議組織")
    db_session.add(org)
    await db_session.flush()
    meeting = Meeting(
        org_id=org.id,
        title="第一次會議",
        screen_token=uuid.uuid4().hex,
        checkin_token=uuid.uuid4().hex,
        created_by=member_user.id,
    )
    db_session.add(meeting)
    await db_session.flush()
    event = CalendarEvent(
        org_id=None,
        title="正式會議投影",
        visibility=CalendarVisibility.LOGGED_IN,
        starts_at=_NOW,
        created_by=member_user.id,
        source_meeting_id=meeting.id,
    )
    db_session.add(event)
    await db_session.flush()

    ac = authed_client_factory(member_user)
    resp = await ac.delete(f"/calendar/events/{event.id}")
    assert resp.status_code == 409


async def test_mutate_projection_event_participants_returns_409(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "calendar:admin")
    event = CalendarEvent(
        org_id=None,
        title="投影事件（非會議）",
        visibility=CalendarVisibility.LOGGED_IN,
        starts_at=_NOW,
        created_by=member_user.id,
        source_module="activity",
    )
    db_session.add(event)
    await db_session.flush()

    ac = authed_client_factory(member_user)
    resp = await ac.post(
        f"/calendar/events/{event.id}/participants",
        json={"user_id": str(member_user.id)},
    )
    assert resp.status_code == 409


# ── 參與者 ────────────────────────────────────────────────────────────────────


async def test_participant_upsert_update_and_delete_flow(
    db_session, member_user, authed_client_factory
) -> None:
    invitee = await _bare_user(db_session)
    event = CalendarEvent(
        org_id=None,
        title="說明會",
        visibility=CalendarVisibility.LOGGED_IN,
        starts_at=_NOW,
        created_by=member_user.id,
    )
    db_session.add(event)
    await db_session.flush()
    ac = authed_client_factory(member_user)

    created = await ac.post(
        f"/calendar/events/{event.id}/participants",
        json={"user_id": str(invitee.id), "role": "required"},
    )
    assert created.status_code == 201
    participant_id = created.json()["id"]

    updated = await ac.patch(
        f"/calendar/events/{event.id}/participants/{participant_id}",
        json={"response": "accepted"},
    )
    assert updated.status_code == 200
    assert updated.json()["response"] == "accepted"

    deleted = await ac.delete(f"/calendar/events/{event.id}/participants/{participant_id}")
    assert deleted.status_code == 204


async def test_update_participant_unknown_id_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    event = CalendarEvent(
        org_id=None,
        title="說明會",
        visibility=CalendarVisibility.LOGGED_IN,
        starts_at=_NOW,
        created_by=member_user.id,
    )
    db_session.add(event)
    await db_session.flush()
    ac = authed_client_factory(member_user)
    resp = await ac.patch(
        f"/calendar/events/{event.id}/participants/{uuid.uuid4()}",
        json={"response": "declined"},
    )
    assert resp.status_code == 404


# ── 準備事項 ──────────────────────────────────────────────────────────────────


async def test_checklist_create_update_delete_flow(
    db_session, member_user, authed_client_factory
) -> None:
    event = CalendarEvent(
        org_id=None,
        title="迎新宿營",
        visibility=CalendarVisibility.LOGGED_IN,
        starts_at=_NOW,
        created_by=member_user.id,
    )
    db_session.add(event)
    await db_session.flush()
    ac = authed_client_factory(member_user)

    created = await ac.post(f"/calendar/events/{event.id}/checklist", json={"title": "借用場地"})
    assert created.status_code == 201
    item_id = created.json()["id"]

    updated = await ac.patch(
        f"/calendar/events/{event.id}/checklist/{item_id}", json={"is_done": True}
    )
    assert updated.status_code == 200
    assert updated.json()["is_done"] is True

    deleted = await ac.delete(f"/calendar/events/{event.id}/checklist/{item_id}")
    assert deleted.status_code == 204


# ── 關聯連結 ──────────────────────────────────────────────────────────────────


async def test_link_create_and_delete_flow(db_session, member_user, authed_client_factory) -> None:
    event = CalendarEvent(
        org_id=None,
        title="活動關聯",
        visibility=CalendarVisibility.LOGGED_IN,
        starts_at=_NOW,
        created_by=member_user.id,
    )
    db_session.add(event)
    await db_session.flush()
    ac = authed_client_factory(member_user)

    created = await ac.post(
        f"/calendar/events/{event.id}/links",
        json={"link_type": "external", "title": "報名表單", "url": "https://forms.example.com/a"},
    )
    assert created.status_code == 201
    link_id = created.json()["id"]

    deleted = await ac.delete(f"/calendar/events/{event.id}/links/{link_id}")
    assert deleted.status_code == 204


async def test_delete_link_unknown_id_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    event = CalendarEvent(
        org_id=None,
        title="活動關聯",
        visibility=CalendarVisibility.LOGGED_IN,
        starts_at=_NOW,
        created_by=member_user.id,
    )
    db_session.add(event)
    await db_session.flush()
    ac = authed_client_factory(member_user)
    resp = await ac.delete(f"/calendar/events/{event.id}/links/{uuid.uuid4()}")
    assert resp.status_code == 404


# ── Google Calendar 同步（外部邊界一律 mock）──────────────────────────────────


async def test_google_status_requires_calendar_admin(member_user, authed_client_factory) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get(f"/calendar/google/status/{uuid.uuid4()}")
    assert resp.status_code == 403


async def test_google_status_not_connected_when_no_config(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "calendar:admin")
    ac = authed_client_factory(member_user)
    resp = await ac.get(f"/calendar/google/status/{uuid.uuid4()}")
    assert resp.status_code == 200
    assert resp.json()["is_connected"] is False


async def test_google_disconnect_without_config_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "calendar:admin")
    ac = authed_client_factory(member_user)
    resp = await ac.delete(f"/calendar/google/disconnect/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_google_disconnect_with_config_succeeds(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "calendar:admin")
    org = Org(name="已連結組織")
    db_session.add(org)
    await db_session.flush()
    config = OrgGoogleCalendarConfig(org_id=org.id, is_active=True, sync_enabled=True)
    db_session.add(config)
    await db_session.flush()

    ac = authed_client_factory(member_user)
    resp = await ac.delete(f"/calendar/google/disconnect/{org.id}")
    assert resp.status_code == 204


async def test_list_google_calendars_success_mocks_external_api(
    db_session, member_user, authed_client_factory, monkeypatch
) -> None:
    await _grant_permission(db_session, member_user, "calendar:admin")
    org = Org(name="已連結組織2")
    db_session.add(org)
    await db_session.flush()
    config = OrgGoogleCalendarConfig(org_id=org.id, is_active=True)
    db_session.add(config)
    await db_session.flush()

    async def _fake_list_calendars(_session, _config):
        return [{"id": "primary", "summary": "主要行事曆", "primary": True}]

    monkeypatch.setattr("api.services.google_calendar_service.list_calendars", _fake_list_calendars)

    ac = authed_client_factory(member_user)
    resp = await ac.get(f"/calendar/google/calendars/{org.id}")
    assert resp.status_code == 200
    assert resp.json()[0]["id"] == "primary"


async def test_list_google_calendars_auth_error_returns_401(
    db_session, member_user, authed_client_factory, monkeypatch
) -> None:
    from api.services.google_calendar_service import GoogleCalendarAuthError

    await _grant_permission(db_session, member_user, "calendar:admin")
    org = Org(name="已連結組織3")
    db_session.add(org)
    await db_session.flush()
    config = OrgGoogleCalendarConfig(org_id=org.id, is_active=True)
    db_session.add(config)
    await db_session.flush()

    async def _fake_list_calendars(_session, _config):
        raise GoogleCalendarAuthError("token 已失效")

    monkeypatch.setattr("api.services.google_calendar_service.list_calendars", _fake_list_calendars)

    ac = authed_client_factory(member_user)
    resp = await ac.get(f"/calendar/google/calendars/{org.id}")
    assert resp.status_code == 401


async def test_list_google_calendars_generic_error_returns_502(
    db_session, member_user, authed_client_factory, monkeypatch
) -> None:
    await _grant_permission(db_session, member_user, "calendar:admin")
    org = Org(name="已連結組織4")
    db_session.add(org)
    await db_session.flush()
    config = OrgGoogleCalendarConfig(org_id=org.id, is_active=True)
    db_session.add(config)
    await db_session.flush()

    async def _fake_list_calendars(_session, _config):
        raise RuntimeError("network down")

    monkeypatch.setattr("api.services.google_calendar_service.list_calendars", _fake_list_calendars)

    ac = authed_client_factory(member_user)
    resp = await ac.get(f"/calendar/google/calendars/{org.id}")
    assert resp.status_code == 502


async def test_update_google_config_changes_calendar_id(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "calendar:admin")
    org = Org(name="已連結組織5")
    db_session.add(org)
    await db_session.flush()
    config = OrgGoogleCalendarConfig(org_id=org.id, is_active=True, google_calendar_id="primary")
    db_session.add(config)
    await db_session.flush()

    ac = authed_client_factory(member_user)
    resp = await ac.patch(
        f"/calendar/google/config/{org.id}", json={"google_calendar_id": "secondary-cal-id"}
    )
    assert resp.status_code == 200
    assert resp.json()["google_calendar_id"] == "secondary-cal-id"


async def test_trigger_pull_without_config_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_permission(db_session, member_user, "calendar:admin")
    ac = authed_client_factory(member_user)
    resp = await ac.post(f"/calendar/google/trigger-pull/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_trigger_pull_with_config_queues_task(
    db_session, member_user, authed_client_factory, monkeypatch
) -> None:
    await _grant_permission(db_session, member_user, "calendar:admin")
    org = Org(name="已連結組織6")
    db_session.add(org)
    await db_session.flush()
    config = OrgGoogleCalendarConfig(org_id=org.id, is_active=True)
    db_session.add(config)
    await db_session.flush()

    from api.services import google_calendar_tasks

    monkeypatch.setattr(google_calendar_tasks.pull_all_orgs, "delay", lambda: None)

    ac = authed_client_factory(member_user)
    resp = await ac.post(f"/calendar/google/trigger-pull/{org.id}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "queued"
