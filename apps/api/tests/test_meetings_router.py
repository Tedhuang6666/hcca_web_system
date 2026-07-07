"""議事系統 Router HTTP 層測試 — 會議生命週期 / 議程 / 出列席 / 表決 / 動議 / 決議 / 發言 / 大屏。

既有 test_meeting_policy.py／test_meeting_simple_mode.py 已涵蓋服務層純函式（狀態機守護、
計票公式），本檔專注在透過真實 HTTP client 打 meetings.py router，涵蓋權限依賴
（require_permission）、序列化（response_model）與跨層串接（router → service → model）。
"""

from __future__ import annotations

import io
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.meeting import (
    AttendanceRole,
    AttendanceStatus,
    Meeting,
    MeetingAgendaItem,
    MeetingAttendance,
    MeetingBillStage,
    MeetingMode,
    MeetingScreenState,
    MeetingStatus,
    MeetingTimerState,
    MeetingVote,
    VoteStatus,
)
from api.models.org import Org
from api.models.regulation import Regulation, RegulationCategory, RegulationWorkflowStatus
from api.models.user import User

_PNG_MAGIC = b"\x89PNG\r\n\x1a\n data"


# ── 共用建構 helper（直接以 ORM 建立前置資料，避免每個測試重跑完整狀態機） ──────


async def _make_org(db_session: AsyncSession, **overrides: object) -> Org:
    defaults: dict = {"name": f"議事測試組織-{uuid.uuid4().hex[:6]}"}
    defaults.update(overrides)
    org = Org(**defaults)
    db_session.add(org)
    await db_session.flush()
    return org


async def _make_meeting(
    db_session: AsyncSession, org: Org, creator: User, **overrides: object
) -> Meeting:
    defaults: dict = {
        "org_id": org.id,
        "title": "第一次定期會",
        "mode": MeetingMode.FULL,
        "status": MeetingStatus.DRAFT,
        "screen_token": uuid.uuid4().hex,
        "checkin_token": uuid.uuid4().hex,
        "created_by": creator.id,
    }
    defaults.update(overrides)
    meeting = Meeting(**defaults)
    db_session.add(meeting)
    await db_session.flush()
    # 真實建立流程（create_meeting service）一律連帶建立這兩張 1:1 側表；
    # 若省略，get_or_create_screen_state/timer_state 會在同一請求內因
    # SQLAlchemy identity map 對已載入（None）關聯不重新整理而重複 INSERT 撞
    # primary key（screen_payload / update_screen_state 等多處都會觸發）。
    db_session.add(MeetingScreenState(meeting_id=meeting.id))
    db_session.add(MeetingTimerState(meeting_id=meeting.id))
    await db_session.flush()
    return meeting


async def _make_agenda_item(
    db_session: AsyncSession, meeting: Meeting, **overrides: object
) -> MeetingAgendaItem:
    defaults: dict = {"meeting_id": meeting.id, "title": "討論事項一"}
    defaults.update(overrides)
    item = MeetingAgendaItem(**defaults)
    db_session.add(item)
    await db_session.flush()
    return item


async def _make_attendance(
    db_session: AsyncSession, meeting: Meeting, user: User, **overrides: object
) -> MeetingAttendance:
    defaults: dict = {
        "meeting_id": meeting.id,
        "user_id": user.id,
        "role": AttendanceRole.VOTER,
        "status": AttendanceStatus.PRESENT,
        "is_voting_eligible": True,
    }
    defaults.update(overrides)
    record = MeetingAttendance(**defaults)
    db_session.add(record)
    await db_session.flush()
    return record


async def _make_vote(
    db_session: AsyncSession, meeting: Meeting, **overrides: object
) -> MeetingVote:
    defaults: dict = {"meeting_id": meeting.id, "title": "表決案一"}
    defaults.update(overrides)
    vote = MeetingVote(**defaults)
    db_session.add(vote)
    await db_session.flush()
    return vote


async def _make_regulation(
    db_session: AsyncSession, org: Org, creator: User, *, workflow_status: RegulationWorkflowStatus
) -> Regulation:
    reg = Regulation(
        title="學生會組織法修正案",
        category=RegulationCategory.ORDINANCE,
        content="",
        org_id=org.id,
        created_by=creator.id,
        workflow_status=workflow_status,
    )
    db_session.add(reg)
    await db_session.flush()
    return reg


# ── 會議 CRUD / 生命週期 ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_meetings_returns_meetings_in_org(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)

    ac = authed_client_factory(admin_user)
    resp = await ac.get("/meetings", params={"org_id": str(org.id)})

    assert resp.status_code == 200, resp.text
    ids = {row["id"] for row in resp.json()}
    assert str(meeting.id) in ids


@pytest.mark.asyncio
async def test_create_meeting_success_creates_draft_meeting(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(admin_user)

    resp = await ac.post(
        "/meetings",
        json={"title": "第二次定期會", "org_id": str(org.id), "mode": "full"},
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["title"] == "第二次定期會"
    assert body["status"] == "draft"


@pytest.mark.asyncio
async def test_create_meeting_without_permission_returns_403(
    db_session: AsyncSession, authed_client_factory, member_user: User
) -> None:
    org = await _make_org(db_session)
    ac = authed_client_factory(member_user)

    resp = await ac.post("/meetings", json={"title": "無權限會議", "org_id": str(org.id)})

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_get_meeting_returns_detail(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)

    ac = authed_client_factory(admin_user)
    resp = await ac.get(f"/meetings/{meeting.id}")

    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == str(meeting.id)


@pytest.mark.asyncio
async def test_get_meeting_not_found_returns_404(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    ac = authed_client_factory(admin_user)
    resp = await ac.get(f"/meetings/{uuid.uuid4()}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_meeting_success_changes_title(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)

    ac = authed_client_factory(admin_user)
    resp = await ac.patch(f"/meetings/{meeting.id}", json={"title": "改名後的會議"})

    assert resp.status_code == 200, resp.text
    assert resp.json()["title"] == "改名後的會議"


@pytest.mark.asyncio
async def test_update_meeting_without_permission_returns_403(
    db_session: AsyncSession, authed_client_factory, admin_user: User, member_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)

    ac = authed_client_factory(member_user)
    resp = await ac.patch(f"/meetings/{meeting.id}", json={"title": "改名"})

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_start_meeting_success_transitions_to_active(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(f"/meetings/{meeting.id}/start")

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "active"


@pytest.mark.asyncio
async def test_start_meeting_invalid_transition_returns_409(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    """已封存的會議不可重新開啟（transition_meeting 狀態機守護）。"""
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user, status=MeetingStatus.ARCHIVED)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(f"/meetings/{meeting.id}/start")

    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_open_checkin_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(f"/meetings/{meeting.id}/check-in/open")

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "checkin"


@pytest.mark.asyncio
async def test_pause_meeting_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user, status=MeetingStatus.ACTIVE)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(f"/meetings/{meeting.id}/pause")

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "paused"


@pytest.mark.asyncio
async def test_break_meeting_success_updates_screen_state(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user, status=MeetingStatus.ACTIVE)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(f"/meetings/{meeting.id}/break")

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "break"
    assert resp.json()["screen_state"]["reading_mode"] == "break"


@pytest.mark.asyncio
async def test_close_meeting_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user, status=MeetingStatus.ACTIVE)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(f"/meetings/{meeting.id}/close")

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "closed"


@pytest.mark.asyncio
async def test_archive_meeting_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user, status=MeetingStatus.CLOSED)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(f"/meetings/{meeting.id}/archive")

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "archived"


@pytest.mark.asyncio
async def test_archive_meeting_without_permission_returns_403(
    db_session: AsyncSession, authed_client_factory, admin_user: User, member_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user, status=MeetingStatus.CLOSED)

    ac = authed_client_factory(member_user)
    resp = await ac.post(f"/meetings/{meeting.id}/archive")

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_confirm_meeting_success_generates_notice_document(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(
        db_session,
        org,
        admin_user,
        starts_at=datetime.now(UTC) + timedelta(days=1),
        location="學生活動中心",
    )
    await _make_agenda_item(db_session, meeting, title="通過本學期預算案")

    ac = authed_client_factory(admin_user)
    resp = await ac.post(f"/meetings/{meeting.id}/confirm")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "confirmed"
    assert body["notice_document_id"] is not None


@pytest.mark.asyncio
async def test_confirm_meeting_missing_agenda_returns_422(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    """會議狀態機守護：確認議程前必須至少有一項議程（router 層 ValueError→422 映射）。"""
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(f"/meetings/{meeting.id}/confirm")

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_list_proposable_regulations_without_bill_stage_returns_empty(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)

    ac = authed_client_factory(admin_user)
    resp = await ac.get(f"/meetings/{meeting.id}/proposable-regulations")

    assert resp.status_code == 200, resp.text
    assert resp.json() == []


@pytest.mark.asyncio
async def test_sync_proposals_adds_matching_regulations_to_agenda(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(
        db_session, org, admin_user, bill_stage=MeetingBillStage.STANDING_COMMITTEE
    )
    await _make_regulation(
        db_session, org, admin_user, workflow_status=RegulationWorkflowStatus.UNDER_REVIEW
    )

    ac = authed_client_factory(admin_user)
    resp = await ac.post(f"/meetings/{meeting.id}/agenda-items/sync-proposals")

    assert resp.status_code == 200, resp.text
    assert len(resp.json()["agenda_items"]) == 1


@pytest.mark.asyncio
async def test_meeting_workspace_summary_groups_by_status(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    await _make_meeting(db_session, org, admin_user, status=MeetingStatus.DRAFT)
    ac = authed_client_factory(admin_user)

    resp = await ac.get("/meetings/workspace")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "drafts" in body and "active" in body


@pytest.mark.asyncio
async def test_meeting_briefing_card_returns_meeting_id(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)

    ac = authed_client_factory(admin_user)
    resp = await ac.get(f"/meetings/{meeting.id}/briefing-card")

    assert resp.status_code == 200, resp.text
    assert resp.json()["meeting_id"] == str(meeting.id)


# ── 議程管理 ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_agenda_item_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(f"/meetings/{meeting.id}/agenda-items", json={"title": "新議程項目"})

    assert resp.status_code == 201, resp.text
    assert resp.json()["title"] == "新議程項目"


@pytest.mark.asyncio
async def test_create_agenda_item_without_permission_returns_403(
    db_session: AsyncSession, authed_client_factory, admin_user: User, member_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)

    ac = authed_client_factory(member_user)
    resp = await ac.post(f"/meetings/{meeting.id}/agenda-items", json={"title": "無權限議程"})

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_reorder_agenda_items_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    item1 = await _make_agenda_item(db_session, meeting, title="案一", order_index=0)
    item2 = await _make_agenda_item(db_session, meeting, title="案二", order_index=1)

    ac = authed_client_factory(admin_user)
    resp = await ac.patch(
        f"/meetings/{meeting.id}/agenda-items/reorder",
        json=[str(item2.id), str(item1.id)],
    )

    assert resp.status_code == 200, resp.text
    ordered = resp.json()
    assert ordered[0]["id"] == str(item2.id)
    assert ordered[0]["order_index"] == 0


@pytest.mark.asyncio
async def test_reorder_agenda_items_mismatched_ids_returns_422(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    await _make_agenda_item(db_session, meeting, title="案一")

    ac = authed_client_factory(admin_user)
    resp = await ac.patch(
        f"/meetings/{meeting.id}/agenda-items/reorder",
        json=[str(uuid.uuid4())],
    )

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_update_agenda_item_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    item = await _make_agenda_item(db_session, meeting)

    ac = authed_client_factory(admin_user)
    resp = await ac.patch(
        f"/meetings/{meeting.id}/agenda-items/{item.id}", json={"title": "更新後標題"}
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["title"] == "更新後標題"


@pytest.mark.asyncio
async def test_delete_agenda_item_success_on_draft_meeting(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user, status=MeetingStatus.DRAFT)
    item = await _make_agenda_item(db_session, meeting)

    ac = authed_client_factory(admin_user)
    resp = await ac.delete(f"/meetings/{meeting.id}/agenda-items/{item.id}")

    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_agenda_item_on_active_meeting_returns_409(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    """狀態機守護：僅草稿／已確認狀態的會議可以刪除議程項目。"""
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user, status=MeetingStatus.ACTIVE)
    item = await _make_agenda_item(db_session, meeting)

    ac = authed_client_factory(admin_user)
    resp = await ac.delete(f"/meetings/{meeting.id}/agenda-items/{item.id}")

    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_add_recusal_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User, make_user
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    item = await _make_agenda_item(db_session, meeting)
    voter = await make_user(display_name="迴避委員")

    ac = authed_client_factory(admin_user)
    resp = await ac.post(
        f"/meetings/{meeting.id}/agenda-items/{item.id}/recusals",
        json={"user_id": str(voter.id), "note": "與本案有利害關係"},
    )

    assert resp.status_code == 200, resp.text
    assert any(r["user_id"] == str(voter.id) for r in resp.json()["recusals"])


@pytest.mark.asyncio
async def test_remove_recusal_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User, make_user
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    item = await _make_agenda_item(db_session, meeting)
    voter = await make_user(display_name="迴避委員2")

    ac = authed_client_factory(admin_user)
    add_resp = await ac.post(
        f"/meetings/{meeting.id}/agenda-items/{item.id}/recusals",
        json={"user_id": str(voter.id)},
    )
    assert add_resp.status_code == 200, add_resp.text

    resp = await ac.delete(f"/meetings/{meeting.id}/agenda-items/{item.id}/recusals/{voter.id}")

    assert resp.status_code == 200, resp.text
    assert resp.json()["recusals"] == []


@pytest.mark.asyncio
async def test_advance_agenda_regulation_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(
        db_session, org, admin_user, bill_stage=MeetingBillStage.STANDING_COMMITTEE
    )
    reg = await _make_regulation(
        db_session, org, admin_user, workflow_status=RegulationWorkflowStatus.UNDER_REVIEW
    )
    item = await _make_agenda_item(db_session, meeting, regulation_id=reg.id)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(f"/meetings/{meeting.id}/agenda-items/{item.id}/advance-regulation")

    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_advance_agenda_regulation_without_bill_stage_returns_422(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    item = await _make_agenda_item(db_session, meeting)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(f"/meetings/{meeting.id}/agenda-items/{item.id}/advance-regulation")

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_artifact_link_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    item = await _make_agenda_item(db_session, meeting)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(
        f"/meetings/{meeting.id}/agenda-items/{item.id}/artifact-links",
        json={"artifact_type": "external", "title": "延伸資料", "url": "https://example.com/x"},
    )

    assert resp.status_code == 201, resp.text
    assert resp.json()["title"] == "延伸資料"


@pytest.mark.asyncio
async def test_update_artifact_link_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    item = await _make_agenda_item(db_session, meeting)

    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        f"/meetings/{meeting.id}/agenda-items/{item.id}/artifact-links",
        json={"artifact_type": "external", "title": "原標題", "url": "https://example.com/a"},
    )
    link_id = create_resp.json()["id"]

    resp = await ac.patch(
        f"/meetings/{meeting.id}/agenda-items/{item.id}/artifact-links/{link_id}",
        json={"title": "改後標題"},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["title"] == "改後標題"


@pytest.mark.asyncio
async def test_delete_artifact_link_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    item = await _make_agenda_item(db_session, meeting)

    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        f"/meetings/{meeting.id}/agenda-items/{item.id}/artifact-links",
        json={"artifact_type": "external", "title": "待刪除", "url": "https://example.com/b"},
    )
    link_id = create_resp.json()["id"]

    resp = await ac.delete(
        f"/meetings/{meeting.id}/agenda-items/{item.id}/artifact-links/{link_id}"
    )

    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_add_agenda_link_attachment_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    item = await _make_agenda_item(db_session, meeting)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(
        f"/meetings/{meeting.id}/agenda-items/{item.id}/attachments/link",
        json={"url": "https://example.com/doc.pdf", "display_text": "會前資料"},
    )

    assert resp.status_code == 201, resp.text
    assert resp.json()["filename"] == "會前資料"


@pytest.mark.asyncio
async def test_upload_agenda_attachment_success(
    db_session: AsyncSession,
    authed_client_factory,
    admin_user: User,
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from api.core import config as config_module

    monkeypatch.setattr(config_module.settings, "STORAGE_LOCAL_DIR", str(tmp_path))

    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    item = await _make_agenda_item(db_session, meeting)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(
        f"/meetings/{meeting.id}/agenda-items/{item.id}/attachments",
        files={"file": ("agenda.png", io.BytesIO(_PNG_MAGIC), "image/png")},
    )

    assert resp.status_code == 201, resp.text
    assert resp.json()["content_type"] == "image/png"


@pytest.mark.asyncio
async def test_delete_agenda_attachment_success(
    db_session: AsyncSession,
    authed_client_factory,
    admin_user: User,
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from api.core import config as config_module

    monkeypatch.setattr(config_module.settings, "STORAGE_LOCAL_DIR", str(tmp_path))

    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    item = await _make_agenda_item(db_session, meeting)

    ac = authed_client_factory(admin_user)
    upload_resp = await ac.post(
        f"/meetings/{meeting.id}/agenda-items/{item.id}/attachments",
        files={"file": ("agenda.png", io.BytesIO(_PNG_MAGIC), "image/png")},
    )
    attachment_id = upload_resp.json()["id"]

    resp = await ac.delete(
        f"/meetings/{meeting.id}/agenda-items/{item.id}/attachments/{attachment_id}"
    )

    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_download_agenda_attachment_without_storage_key_returns_404(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    """連結型附件（link_url，無 storage_key）不可下載。"""
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    item = await _make_agenda_item(db_session, meeting)

    ac = authed_client_factory(admin_user)
    link_resp = await ac.post(
        f"/meetings/{meeting.id}/agenda-items/{item.id}/attachments/link",
        json={"url": "https://example.com/x.pdf"},
    )
    attachment_id = link_resp.json()["id"]

    resp = await ac.get(
        f"/meetings/{meeting.id}/agenda-items/{item.id}/attachments/{attachment_id}/download"
    )

    assert resp.status_code == 404


# ── 出列席 ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_join_meeting_success_via_checkin_token(
    db_session: AsyncSession, authed_client_factory, admin_user: User, make_user
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    attendee = await make_user(display_name="與會議員")

    ac = authed_client_factory(attendee)
    resp = await ac.get(f"/meetings/join/{meeting.checkin_token}")

    assert resp.status_code == 200, resp.text
    assert resp.json()["meeting"]["id"] == str(meeting.id)


@pytest.mark.asyncio
async def test_join_meeting_invalid_token_returns_404(
    db_session: AsyncSession, authed_client_factory, member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/meetings/join/not-a-real-token")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_check_in_success_creates_attendance_record(
    db_session: AsyncSession, authed_client_factory, admin_user: User, make_user
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user, status=MeetingStatus.CHECKIN)
    attendee = await make_user(display_name="報到議員")

    ac = authed_client_factory(attendee)
    resp = await ac.post(
        f"/meetings/{meeting.id}/check-in", params={"token": meeting.checkin_token}
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "present"


@pytest.mark.asyncio
async def test_check_in_wrong_token_returns_403(
    db_session: AsyncSession, authed_client_factory, admin_user: User, make_user
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user, status=MeetingStatus.CHECKIN)
    attendee = await make_user(display_name="報到議員2")

    ac = authed_client_factory(attendee)
    resp = await ac.post(f"/meetings/{meeting.id}/check-in", params={"token": "錯誤簽到碼"})

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_resolve_attendance_source_manual_returns_members(
    db_session: AsyncSession, authed_client_factory, admin_user: User, make_user
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    member = await make_user(display_name="手動名冊成員")

    ac = authed_client_factory(admin_user)
    resp = await ac.post(
        f"/meetings/{meeting.id}/attendance/sources/resolve",
        json={"source_type": "manual", "user_ids": [str(member.id)]},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["count"] == 1


@pytest.mark.asyncio
async def test_import_attendance_source_manual_creates_attendance(
    db_session: AsyncSession, authed_client_factory, admin_user: User, make_user
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    member = await make_user(display_name="匯入名冊成員")

    ac = authed_client_factory(admin_user)
    resp = await ac.post(
        f"/meetings/{meeting.id}/attendance/sources",
        json={
            "source_type": "manual",
            "user_ids": [str(member.id)],
            "is_voting_eligible": True,
        },
    )

    assert resp.status_code == 201, resp.text
    assert resp.json()["imported_count"] == 1


@pytest.mark.asyncio
async def test_upsert_attendance_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User, make_user
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    member = await make_user(display_name="補登議員")

    ac = authed_client_factory(admin_user)
    resp = await ac.post(
        f"/meetings/{meeting.id}/attendance",
        json={"user_id": str(member.id), "status": "present", "is_voting_eligible": True},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["user_id"] == str(member.id)


@pytest.mark.asyncio
async def test_upsert_attendance_without_permission_returns_403(
    db_session: AsyncSession, authed_client_factory, admin_user: User, member_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)

    ac = authed_client_factory(member_user)
    resp = await ac.post(
        f"/meetings/{meeting.id}/attendance",
        json={"user_id": str(member_user.id), "status": "present"},
    )

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_update_attendance_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User, make_user
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    member = await make_user(display_name="修改出席議員")
    record = await _make_attendance(db_session, meeting, member, status=AttendanceStatus.EXPECTED)

    ac = authed_client_factory(admin_user)
    resp = await ac.patch(
        f"/meetings/{meeting.id}/attendance/{record.id}", json={"status": "leave"}
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "leave"


# ── 表決 ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_vote_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(f"/meetings/{meeting.id}/votes", json={"title": "第一案表決"})

    assert resp.status_code == 201, resp.text
    assert resp.json()["title"] == "第一案表決"
    assert resp.json()["status"] == "draft"


@pytest.mark.asyncio
async def test_create_vote_without_permission_returns_403(
    db_session: AsyncSession, authed_client_factory, admin_user: User, member_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)

    ac = authed_client_factory(member_user)
    resp = await ac.post(f"/meetings/{meeting.id}/votes", json={"title": "無權限表決"})

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_update_vote_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    vote = await _make_vote(db_session, meeting)

    ac = authed_client_factory(admin_user)
    resp = await ac.patch(f"/meetings/{meeting.id}/votes/{vote.id}", json={"title": "改後表決標題"})

    assert resp.status_code == 200, resp.text
    assert resp.json()["title"] == "改後表決標題"


@pytest.mark.asyncio
async def test_open_vote_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    vote = await _make_vote(db_session, meeting)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(f"/meetings/{meeting.id}/votes/{vote.id}/open")

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "open"


@pytest.mark.asyncio
async def test_close_vote_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    vote = await _make_vote(
        db_session, meeting, status=VoteStatus.OPEN, opened_at=datetime.now(UTC)
    )

    ac = authed_client_factory(admin_user)
    resp = await ac.post(f"/meetings/{meeting.id}/votes/{vote.id}/close")

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "closed"


@pytest.mark.asyncio
async def test_close_vote_already_closed_returns_409(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    vote = await _make_vote(db_session, meeting, status=VoteStatus.DRAFT)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(f"/meetings/{meeting.id}/votes/{vote.id}/close")

    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_cast_ballot_success_by_eligible_voter(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    """admin_user 為 superuser 繞過 require_permission，但仍須通過
    _assert_voter_eligible 的業務規則（須為本場會議可投票且已出席成員）。"""
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    vote = await _make_vote(
        db_session, meeting, status=VoteStatus.OPEN, opened_at=datetime.now(UTC)
    )
    await _make_attendance(db_session, meeting, admin_user)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(
        f"/meetings/{meeting.id}/votes/{vote.id}/ballot", json={"choice": "approve"}
    )

    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_cast_ballot_not_eligible_returns_403(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    """未列入表決權名冊者不可投票（_assert_voter_eligible 拋 PermissionError→403）。"""
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    vote = await _make_vote(
        db_session, meeting, status=VoteStatus.OPEN, opened_at=datetime.now(UTC)
    )

    ac = authed_client_factory(admin_user)
    resp = await ac.post(
        f"/meetings/{meeting.id}/votes/{vote.id}/ballot", json={"choice": "approve"}
    )

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_cast_ballot_duplicate_returns_409(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    vote = await _make_vote(
        db_session, meeting, status=VoteStatus.OPEN, opened_at=datetime.now(UTC)
    )
    await _make_attendance(db_session, meeting, admin_user)

    ac = authed_client_factory(admin_user)
    first = await ac.post(
        f"/meetings/{meeting.id}/votes/{vote.id}/ballot", json={"choice": "approve"}
    )
    assert first.status_code == 200, first.text

    resp = await ac.post(
        f"/meetings/{meeting.id}/votes/{vote.id}/ballot", json={"choice": "reject"}
    )

    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_recorder_cast_ballot_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User, make_user
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user, mode=MeetingMode.SIMPLE)
    vote = await _make_vote(
        db_session, meeting, status=VoteStatus.OPEN, opened_at=datetime.now(UTC)
    )
    voter = await make_user(display_name="代登投票議員")
    await _make_attendance(db_session, meeting, voter)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(
        f"/meetings/{meeting.id}/votes/{vote.id}/recorder-ballot",
        json={"voter_id": str(voter.id), "choice": "approve"},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["voter_id"] == str(voter.id)


@pytest.mark.asyncio
async def test_record_vote_tally_success_closes_vote(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user, mode=MeetingMode.SIMPLE)
    vote = await _make_vote(
        db_session, meeting, status=VoteStatus.OPEN, opened_at=datetime.now(UTC)
    )

    ac = authed_client_factory(admin_user)
    resp = await ac.post(
        f"/meetings/{meeting.id}/votes/{vote.id}/tally",
        json={"manual_tally": {"approve": 5, "reject": 1, "abstain": 0}},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "closed"
    assert body["tally"]["approve"] == 5


@pytest.mark.asyncio
async def test_record_acclamation_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user, mode=MeetingMode.SIMPLE)
    item = await _make_agenda_item(db_session, meeting)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(
        f"/meetings/{meeting.id}/agenda-items/{item.id}/acclamation",
        json={"result_label": "無異議通過"},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["tally"]["passed"] is True


# ── 動議 / 決議 ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_motion_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(
        f"/meetings/{meeting.id}/motions",
        json={"title": "修正動議一", "motion_type": "amendment"},
    )

    assert resp.status_code == 201, resp.text
    assert resp.json()["motion_type"] == "amendment"


@pytest.mark.asyncio
async def test_update_motion_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)

    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(f"/meetings/{meeting.id}/motions", json={"title": "待修正動議"})
    motion_id = create_resp.json()["id"]

    resp = await ac.patch(f"/meetings/{meeting.id}/motions/{motion_id}", json={"status": "adopted"})

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "adopted"


@pytest.mark.asyncio
async def test_create_decision_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    item = await _make_agenda_item(db_session, meeting)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(
        f"/meetings/{meeting.id}/decisions",
        json={
            "agenda_item_id": str(item.id),
            "title": "通過本案",
            "content": "照案通過，交行政部門辦理。",
            "status": "passed",
            "create_follow_up": False,
        },
    )

    assert resp.status_code == 201, resp.text
    assert resp.json()["status"] == "passed"


@pytest.mark.asyncio
async def test_create_decision_without_permission_returns_403(
    db_session: AsyncSession, authed_client_factory, admin_user: User, member_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    item = await _make_agenda_item(db_session, meeting)

    ac = authed_client_factory(member_user)
    resp = await ac.post(
        f"/meetings/{meeting.id}/decisions",
        json={
            "agenda_item_id": str(item.id),
            "title": "無權限決議",
            "content": "內容",
            "create_follow_up": False,
        },
    )

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_update_decision_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    item = await _make_agenda_item(db_session, meeting)

    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        f"/meetings/{meeting.id}/decisions",
        json={
            "agenda_item_id": str(item.id),
            "title": "待更新決議",
            "content": "初版內容",
            "create_follow_up": False,
        },
    )
    decision_id = create_resp.json()["id"]

    resp = await ac.patch(
        f"/meetings/{meeting.id}/decisions/{decision_id}", json={"content": "修訂後內容"}
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["content"] == "修訂後內容"


# ── 議員請求 / 發言 queue ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_meeting_request_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User, make_user
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    requester = await make_user(display_name="提出請求議員")

    ac = authed_client_factory(requester)
    resp = await ac.post(
        f"/meetings/{meeting.id}/requests",
        json={"request_type": "speech", "content": "我想發言"},
    )

    assert resp.status_code == 201, resp.text
    assert resp.json()["request_type"] == "speech"


@pytest.mark.asyncio
async def test_update_meeting_request_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User, make_user
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    requester = await make_user(display_name="請求待處理議員")

    requester_client = authed_client_factory(requester)
    create_resp = await requester_client.post(
        f"/meetings/{meeting.id}/requests",
        json={"request_type": "point_of_order"},
    )
    request_id = create_resp.json()["id"]

    ac = authed_client_factory(admin_user)
    resp = await ac.patch(
        f"/meetings/{meeting.id}/requests/{request_id}", json={"status": "acknowledged"}
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "acknowledged"


@pytest.mark.asyncio
async def test_enqueue_request_speech_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User, make_user
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    requester = await make_user(display_name="排隊發言議員")

    requester_client = authed_client_factory(requester)
    create_resp = await requester_client.post(
        f"/meetings/{meeting.id}/requests",
        json={"request_type": "speech"},
    )
    request_id = create_resp.json()["id"]

    ac = authed_client_factory(admin_user)
    resp = await ac.post(f"/meetings/{meeting.id}/requests/{request_id}/enqueue")

    assert resp.status_code == 201, resp.text
    assert resp.json()["speaker_name"] == requester.display_name


@pytest.mark.asyncio
async def test_create_speech_queue_item_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(
        f"/meetings/{meeting.id}/speech-queue", json={"speaker_name": "指定發言人"}
    )

    assert resp.status_code == 201, resp.text
    assert resp.json()["speaker_name"] == "指定發言人"


@pytest.mark.asyncio
async def test_reorder_speech_queue_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    ac = authed_client_factory(admin_user)
    first = await ac.post(f"/meetings/{meeting.id}/speech-queue", json={"speaker_name": "甲"})
    second = await ac.post(f"/meetings/{meeting.id}/speech-queue", json={"speaker_name": "乙"})

    # 生產環境每個 HTTP request 走 api.core.database.get_db 建立的全新 session
    # （見 database.py:96 async with AsyncSessionLocal()），彼此沒有 identity map
    # 殘留；但本測試刻意讓三次請求共用同一個 db_session 以便交易可回滾，須手動
    # expire 才能還原「下一個 request 重新查詢」的真實情境，避免撞到
    # meeting.speech_queue 在稍早請求就被 selectinload 快取成空集合的假陽性。
    db_session.expire(meeting, ["speech_queue"])
    resp = await ac.patch(
        f"/meetings/{meeting.id}/speech-queue/reorder",
        json={"ordered_ids": [second.json()["id"], first.json()["id"]]},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()[0]["speaker_name"] == "乙"


@pytest.mark.asyncio
async def test_update_speech_queue_item_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        f"/meetings/{meeting.id}/speech-queue", json={"speaker_name": "待修改發言人"}
    )
    speech_id = create_resp.json()["id"]

    resp = await ac.patch(
        f"/meetings/{meeting.id}/speech-queue/{speech_id}",
        json={"speaker_role": "系學會會長"},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["speaker_role"] == "系學會會長"


@pytest.mark.asyncio
async def test_start_speech_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        f"/meetings/{meeting.id}/speech-queue", json={"speaker_name": "開始發言人"}
    )
    speech_id = create_resp.json()["id"]

    resp = await ac.post(f"/meetings/{meeting.id}/speech-queue/{speech_id}/start")

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "speaking"


@pytest.mark.asyncio
async def test_pause_speech_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        f"/meetings/{meeting.id}/speech-queue", json={"speaker_name": "暫停發言人"}
    )
    speech_id = create_resp.json()["id"]
    await ac.post(f"/meetings/{meeting.id}/speech-queue/{speech_id}/start")

    resp = await ac.post(f"/meetings/{meeting.id}/speech-queue/{speech_id}/pause")

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "paused"


@pytest.mark.asyncio
async def test_resume_speech_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        f"/meetings/{meeting.id}/speech-queue", json={"speaker_name": "繼續發言人"}
    )
    speech_id = create_resp.json()["id"]
    await ac.post(f"/meetings/{meeting.id}/speech-queue/{speech_id}/start")
    await ac.post(f"/meetings/{meeting.id}/speech-queue/{speech_id}/pause")

    resp = await ac.post(f"/meetings/{meeting.id}/speech-queue/{speech_id}/resume")

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "speaking"


@pytest.mark.asyncio
async def test_finish_speech_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        f"/meetings/{meeting.id}/speech-queue", json={"speaker_name": "結束發言人"}
    )
    speech_id = create_resp.json()["id"]
    await ac.post(f"/meetings/{meeting.id}/speech-queue/{speech_id}/start")

    resp = await ac.post(f"/meetings/{meeting.id}/speech-queue/{speech_id}/finish")

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "finished"


@pytest.mark.asyncio
async def test_skip_speech_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        f"/meetings/{meeting.id}/speech-queue", json={"speaker_name": "略過發言人"}
    )
    speech_id = create_resp.json()["id"]

    resp = await ac.post(f"/meetings/{meeting.id}/speech-queue/{speech_id}/skip")

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "skipped"


@pytest.mark.asyncio
async def test_extend_speech_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    ac = authed_client_factory(admin_user)
    create_resp = await ac.post(
        f"/meetings/{meeting.id}/speech-queue", json={"speaker_name": "延長發言人"}
    )
    speech_id = create_resp.json()["id"]
    original_remaining = create_resp.json()["remaining_seconds"]

    resp = await ac.post(
        f"/meetings/{meeting.id}/speech-queue/{speech_id}/extend", json={"seconds": 60}
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["remaining_seconds"] == original_remaining + 60


# ── 大屏 / 事件 / 會議紀錄 ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_screen_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)

    ac = authed_client_factory(admin_user)
    resp = await ac.get(f"/meetings/{meeting.id}/screen")

    assert resp.status_code == 200, resp.text
    assert resp.json()["meeting"]["id"] == str(meeting.id)


@pytest.mark.asyncio
async def test_get_screen_without_permission_returns_403(
    db_session: AsyncSession, authed_client_factory, admin_user: User, member_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)

    ac = authed_client_factory(member_user)
    resp = await ac.get(f"/meetings/{meeting.id}/screen")

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_update_screen_state_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)

    ac = authed_client_factory(admin_user)
    resp = await ac.patch(
        f"/meetings/{meeting.id}/screen-state",
        json={"reading_mode": "announcement", "title": "宣布事項"},
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["reading_mode"] == "announcement"


@pytest.mark.asyncio
async def test_list_meeting_events_returns_recorded_events(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)
    ac = authed_client_factory(admin_user)
    await ac.post(f"/meetings/{meeting.id}/start")

    resp = await ac.get(f"/meetings/{meeting.id}/events")

    assert resp.status_code == 200, resp.text
    assert any(e["event_type"] == "meeting.started" for e in resp.json())


@pytest.mark.asyncio
async def test_get_minutes_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user, mode=MeetingMode.SIMPLE)
    await _make_agenda_item(db_session, meeting)

    ac = authed_client_factory(admin_user)
    resp = await ac.get(f"/meetings/{meeting.id}/minutes")

    assert resp.status_code == 200, resp.text
    assert "markdown" in resp.json()


@pytest.mark.asyncio
async def test_create_minutes_document_success(
    db_session: AsyncSession, authed_client_factory, admin_user: User
) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(
        db_session,
        org,
        admin_user,
        mode=MeetingMode.SIMPLE,
        location="活動中心",
        starts_at=datetime.now(UTC),
    )
    await _make_agenda_item(db_session, meeting)
    await _make_attendance(db_session, meeting, admin_user)

    ac = authed_client_factory(admin_user)
    resp = await ac.post(f"/meetings/{meeting.id}/minutes/document-draft")

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "draft"


@pytest.mark.asyncio
async def test_public_screen_success(db_session: AsyncSession, client, admin_user: User) -> None:
    org = await _make_org(db_session)
    meeting = await _make_meeting(db_session, org, admin_user)

    resp = await client.get(f"/public/meetings/screen/{meeting.screen_token}")

    assert resp.status_code == 200, resp.text
    assert resp.json()["meeting"]["id"] == str(meeting.id)


@pytest.mark.asyncio
async def test_public_screen_not_found_returns_404(client) -> None:
    resp = await client.get("/public/meetings/screen/not-a-real-token")
    assert resp.status_code == 404
