"""議事系統草稿確認 / 法案審議階段推進狀態機守護測試。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest

from api.models.meeting import (
    Meeting,
    MeetingAgendaItem,
    MeetingBillStage,
    MeetingStatus,
)
from api.models.regulation import Regulation, RegulationCategory, RegulationWorkflowStatus
from api.models.user import User
from api.services import meeting as meeting_svc


def _draft_meeting(**overrides: Any) -> Meeting:
    meeting = Meeting(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        title="第一次定期會",
        status=MeetingStatus.DRAFT,
        screen_token="screen",
        checkin_token="checkin",
        created_by=uuid.uuid4(),
    )
    for key, value in overrides.items():
        setattr(meeting, key, value)
    return meeting


def _agenda_item(**overrides: Any) -> MeetingAgendaItem:
    item = MeetingAgendaItem(id=uuid.uuid4(), meeting_id=uuid.uuid4(), title="議案一")
    for key, value in overrides.items():
        setattr(item, key, value)
    return item


def _regulation(status: RegulationWorkflowStatus) -> Regulation:
    return Regulation(
        id=uuid.uuid4(),
        title="學生會組織法",
        category=RegulationCategory.ORDINANCE,
        content="",
        org_id=uuid.uuid4(),
        created_by=uuid.uuid4(),
        workflow_status=status,
    )


class _FakeSession:
    """transition_workflow / advance_agenda_regulation 用的最小化 session。"""

    def __init__(self, reg: Regulation | None = None) -> None:
        self._reg = reg

    def add(self, _obj: Any) -> None:
        return None

    async def flush(self) -> None:
        return None

    async def get(self, _model: Any, _id: Any) -> Regulation | None:
        return self._reg


@pytest.mark.asyncio
async def test_confirm_meeting_non_draft_status_raises() -> None:
    meeting = _draft_meeting(status=MeetingStatus.ACTIVE)
    with pytest.raises(ValueError, match="草稿狀態"):
        await meeting_svc.confirm_meeting(None, meeting, actor=User())  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_confirm_meeting_already_confirmed_raises() -> None:
    meeting = _draft_meeting(confirmed_at=datetime.now(UTC))
    with pytest.raises(ValueError, match="已確認"):
        await meeting_svc.confirm_meeting(None, meeting, actor=User())  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_confirm_meeting_without_agenda_raises() -> None:
    meeting = _draft_meeting()
    with pytest.raises(ValueError, match="議程項目"):
        await meeting_svc.confirm_meeting(None, meeting, actor=User())  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_confirm_meeting_without_starts_at_raises() -> None:
    meeting = _draft_meeting()
    meeting.agenda_items = [_agenda_item()]
    with pytest.raises(ValueError, match="開會時間"):
        await meeting_svc.confirm_meeting(None, meeting, actor=User())  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_confirm_meeting_without_location_raises() -> None:
    meeting = _draft_meeting(starts_at=datetime.now(UTC))
    meeting.agenda_items = [_agenda_item()]
    with pytest.raises(ValueError, match="開會地點"):
        await meeting_svc.confirm_meeting(None, meeting, actor=User())  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_advance_regulation_without_bill_stage_raises() -> None:
    meeting = _draft_meeting()
    with pytest.raises(ValueError, match="審議階段"):
        await meeting_svc.advance_agenda_regulation(
            _FakeSession(),  # type: ignore[arg-type]
            meeting,
            _agenda_item(),
            actor_id=uuid.uuid4(),
        )


@pytest.mark.asyncio
async def test_advance_regulation_unlinked_agenda_item_raises() -> None:
    meeting = _draft_meeting(bill_stage=MeetingBillStage.STANDING_COMMITTEE)
    item = _agenda_item(regulation_id=None)
    with pytest.raises(ValueError, match="未關聯法案"):
        await meeting_svc.advance_agenda_regulation(
            _FakeSession(),  # type: ignore[arg-type]
            meeting,
            item,
            actor_id=uuid.uuid4(),
        )


@pytest.mark.asyncio
async def test_advance_regulation_with_wrong_stage_status_raises() -> None:
    meeting = _draft_meeting(bill_stage=MeetingBillStage.STANDING_COMMITTEE)
    reg = _regulation(RegulationWorkflowStatus.SCHEDULED)
    item = _agenda_item(regulation_id=reg.id)
    with pytest.raises(ValueError, match="不符"):
        await meeting_svc.advance_agenda_regulation(
            _FakeSession(reg),  # type: ignore[arg-type]
            meeting,
            item,
            actor_id=uuid.uuid4(),
        )


@pytest.mark.asyncio
async def test_standing_committee_advances_under_review_to_scheduled() -> None:
    meeting = _draft_meeting(bill_stage=MeetingBillStage.STANDING_COMMITTEE)
    reg = _regulation(RegulationWorkflowStatus.UNDER_REVIEW)
    item = _agenda_item(regulation_id=reg.id)
    result = await meeting_svc.advance_agenda_regulation(
        _FakeSession(reg),  # type: ignore[arg-type]
        meeting,
        item,
        actor_id=uuid.uuid4(),
    )
    assert result.workflow_status == RegulationWorkflowStatus.SCHEDULED


@pytest.mark.asyncio
async def test_council_advances_scheduled_to_council_approved() -> None:
    meeting = _draft_meeting(bill_stage=MeetingBillStage.COUNCIL)
    reg = _regulation(RegulationWorkflowStatus.SCHEDULED)
    item = _agenda_item(regulation_id=reg.id)
    result = await meeting_svc.advance_agenda_regulation(
        _FakeSession(reg),  # type: ignore[arg-type]
        meeting,
        item,
        actor_id=uuid.uuid4(),
    )
    assert result.workflow_status == RegulationWorkflowStatus.COUNCIL_APPROVED


@pytest.mark.asyncio
async def test_list_proposable_regulations_without_bill_stage_returns_empty() -> None:
    meeting = _draft_meeting()
    result = await meeting_svc.list_proposable_regulations(
        _FakeSession(),  # type: ignore[arg-type]
        meeting,
    )
    assert result == []


@pytest.mark.asyncio
async def test_delete_agenda_item_on_non_draft_meeting_raises() -> None:
    meeting = _draft_meeting(status=MeetingStatus.CLOSED)
    with pytest.raises(ValueError, match="草稿"):
        await meeting_svc.delete_agenda_item(
            None,  # type: ignore[arg-type]
            meeting,
            _agenda_item(),
        )
