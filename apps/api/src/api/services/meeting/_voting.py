"""表決 / 計時 / 動議 / 決議 / 迴避 / 發言隊列"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.meeting import (
    AttendanceStatus,
    BallotChoice,
    Meeting,
    MeetingAgendaItem,
    MeetingAgendaRecusal,
    MeetingAttendance,
    MeetingBallot,
    MeetingDecision,
    MeetingMode,
    MeetingMotion,
    MeetingRequest,
    MeetingRequestStatus,
    MeetingScreenState,
    MeetingSpeechQueueItem,
    MeetingTimerState,
    MeetingVote,
    SpeechQueueStatus,
    TimerStatus,
    VoteRecordMethod,
    VoteStatus,
    VoteThresholdType,
    VoteVisibility,
)
from api.models.user import User
from api.schemas.meeting import (
    DecisionCreate,
    DecisionUpdate,
    MeetingRequestCreate,
    MotionCreate,
    MotionUpdate,
    RecorderBallotCreate,
    ScreenStateUpdate,
    SpeechQueueCreate,
    SpeechQueueUpdate,
    VoteCreate,
    VoteUpdate,
)
from api.services._base import apply_updates


def _vote_tally(vote: MeetingVote, eligible_count: int, present_voters: int = 0) -> dict:
    """計算表決結果，依 record_method 分流。"""
    method = VoteRecordMethod(vote.record_method)
    options = vote.options or None
    threshold_type = VoteThresholdType(vote.threshold_type)

    if method == VoteRecordMethod.ACCLAMATION:
        return {
            "approve": present_voters,
            "reject": 0,
            "abstain": 0,
            "total": present_voters,
            "eligible": eligible_count,
            "pass_threshold": 0,  # nosec B105
            "threshold_type": threshold_type,
            "passed": True,
            "option_counts": {},
            "result_label": vote.result_label or "無異議通過",
        }

    if options:
        keys = [str(opt.get("key")) for opt in options if opt.get("key")]
        option_counts = {key: 0 for key in keys}
        if method == VoteRecordMethod.TALLY:
            for key in keys:
                option_counts[key] = int((vote.manual_tally or {}).get(key, 0))
        else:
            for ballot in vote.ballots:
                if ballot.option_key in option_counts:
                    option_counts[ballot.option_key] += 1
        total = sum(option_counts.values())
        return {
            "approve": 0,
            "reject": 0,
            "abstain": 0,
            "total": total,
            "eligible": eligible_count,
            "pass_threshold": 0,  # nosec B105
            "threshold_type": threshold_type,
            "passed": bool(vote.result_label),
            "option_counts": option_counts,
            "result_label": vote.result_label,
        }

    if method == VoteRecordMethod.TALLY:
        tally = vote.manual_tally or {}
        approve = int(tally.get("approve", 0))
        reject = int(tally.get("reject", 0))
        abstain = int(tally.get("abstain", 0))
    else:
        approve = sum(1 for b in vote.ballots if b.choice == BallotChoice.APPROVE)
        reject = sum(1 for b in vote.ballots if b.choice == BallotChoice.REJECT)
        abstain = sum(1 for b in vote.ballots if b.choice == BallotChoice.ABSTAIN)
    total = approve + reject + abstain

    if threshold_type == VoteThresholdType.CUSTOM:
        threshold = vote.pass_threshold or 0
        passed = approve >= threshold if threshold > 0 else approve > reject
    elif threshold_type == VoteThresholdType.PRESENT_MAJORITY:
        threshold = present_voters // 2 + 1
        passed = approve >= threshold
    elif threshold_type == VoteThresholdType.ALL_MEMBERS_MAJORITY:
        threshold = eligible_count // 2 + 1
        passed = approve >= threshold
    else:
        threshold = 0
        passed = approve > reject
    return {
        "approve": approve,
        "reject": reject,
        "abstain": abstain,
        "total": total,
        "eligible": eligible_count,
        "pass_threshold": threshold,
        "threshold_type": threshold_type,
        "passed": passed,
        "option_counts": {},
        "result_label": vote.result_label,
    }


async def create_vote(session: AsyncSession, meeting: Meeting, *, data: VoteCreate) -> MeetingVote:
    vote = MeetingVote(
        meeting_id=meeting.id,
        title=data.title,
        description=data.description,
        agenda_item_id=data.agenda_item_id,
        visibility=data.visibility,
        pass_threshold=data.pass_threshold or meeting.default_pass_threshold,
        threshold_type=data.threshold_type,
        record_method=data.record_method,
        options=[opt.model_dump() for opt in data.options] if data.options else None,
    )
    session.add(vote)
    await session.flush()
    return vote


async def create_motion(
    session: AsyncSession, meeting: Meeting, *, data: MotionCreate
) -> MeetingMotion:
    motion = MeetingMotion(meeting_id=meeting.id, **data.model_dump())
    session.add(motion)
    await session.flush()
    return motion


async def update_motion(
    session: AsyncSession, motion: MeetingMotion, *, data: MotionUpdate
) -> MeetingMotion:
    apply_updates(motion, data)
    await session.flush()
    return motion


async def create_decision(
    session: AsyncSession,
    meeting: Meeting,
    *,
    data: DecisionCreate,
    created_by: uuid.UUID,
) -> MeetingDecision:
    decision_fields = data.model_dump(
        exclude={
            "create_follow_up",
            "follow_up_assignee_id",
            "follow_up_due_at",
            "create_document_draft",
        }
    )
    decision = MeetingDecision(meeting_id=meeting.id, created_by=created_by, **decision_fields)
    session.add(decision)
    item = next((x for x in meeting.agenda_items if x.id == data.agenda_item_id), None)
    if item is not None and data.status != "draft":
        item.resolution = data.content
    await session.flush()
    return decision


async def update_decision(
    session: AsyncSession, decision: MeetingDecision, *, data: DecisionUpdate
) -> MeetingDecision:
    apply_updates(decision, data)
    await session.flush()
    return decision


async def get_or_create_screen_state(session: AsyncSession, meeting: Meeting) -> MeetingScreenState:
    state = meeting.screen_state
    if state is None:
        state = MeetingScreenState(meeting_id=meeting.id)
        session.add(state)
        await session.flush()
    return state


async def get_or_create_timer_state(session: AsyncSession, meeting: Meeting) -> MeetingTimerState:
    state = meeting.timer_state
    if state is None:
        state = MeetingTimerState(
            meeting_id=meeting.id,
            duration_seconds=meeting.default_speech_seconds,
            remaining_when_paused=meeting.default_speech_seconds,
        )
        session.add(state)
        await session.flush()
    return state


async def update_screen_state(
    session: AsyncSession,
    meeting: Meeting,
    *,
    data: ScreenStateUpdate,
    updated_by: uuid.UUID | None,
) -> MeetingScreenState:
    state = await get_or_create_screen_state(session, meeting)
    values = data.model_dump(exclude_unset=True)
    for field, value in values.items():
        setattr(state, field, value)
    if data.agenda_item_id is not None:
        meeting.current_agenda_item_id = data.agenda_item_id
    state.updated_by = updated_by
    await session.flush()
    return state


async def update_vote(session: AsyncSession, vote: MeetingVote, *, data: VoteUpdate) -> MeetingVote:
    apply_updates(vote, data)
    await session.flush()
    return vote


def current_timer_remaining(state: MeetingTimerState, now: datetime | None = None) -> int:
    if state.status == TimerStatus.RUNNING and state.server_started_at is not None:
        now = now or datetime.now(UTC)
        elapsed = int((now - state.server_started_at).total_seconds())
        return state.duration_seconds - elapsed
    return state.remaining_when_paused


async def create_speech_queue_item(
    session: AsyncSession,
    meeting: Meeting,
    *,
    data: SpeechQueueCreate,
) -> MeetingSpeechQueueItem:
    request = None
    user = None
    if data.request_id is not None:
        request = await session.get(MeetingRequest, data.request_id)
        if request is None or request.meeting_id != meeting.id:
            raise ValueError("找不到此議事請求")
    user_id = data.user_id or (request.user_id if request else None)
    if user_id is not None:
        user = await session.get(User, user_id)
    speaker_name = data.speaker_name or (user.display_name if user else None)
    if not speaker_name:
        raise ValueError("請提供發言人姓名")
    max_order = max((item.order_index for item in meeting.speech_queue), default=-1)
    duration = data.duration_seconds or meeting.default_speech_seconds
    item = MeetingSpeechQueueItem(
        meeting_id=meeting.id,
        agenda_item_id=data.agenda_item_id
        or (request.agenda_item_id if request else meeting.current_agenda_item_id),
        user_id=user_id,
        request_id=data.request_id,
        speaker_name=speaker_name,
        speaker_role=data.speaker_role,
        order_index=max_order + 1,
        duration_seconds=duration,
        remaining_seconds=duration,
    )
    session.add(item)
    if request is not None:
        request.status = MeetingRequestStatus.ACKNOWLEDGED
    await session.flush()
    return item


async def update_speech_queue_item(
    session: AsyncSession,
    item: MeetingSpeechQueueItem,
    *,
    data: SpeechQueueUpdate,
) -> MeetingSpeechQueueItem:
    apply_updates(item, data)
    if (
        "duration_seconds" in data.model_fields_set
        and "remaining_seconds" not in data.model_fields_set
    ):
        item.remaining_seconds = item.duration_seconds
    await session.flush()
    return item


async def reorder_speech_queue(
    session: AsyncSession, meeting: Meeting, ordered_ids: list[uuid.UUID]
) -> list[MeetingSpeechQueueItem]:
    items = {item.id: item for item in meeting.speech_queue}
    if set(ordered_ids) != set(items):
        raise ValueError("發言排序清單與目前 queue 不一致")
    for index, item_id in enumerate(ordered_ids):
        items[item_id].order_index = index
    await session.flush()
    return sorted(items.values(), key=lambda item: item.order_index)


async def start_speech(
    session: AsyncSession, meeting: Meeting, item: MeetingSpeechQueueItem
) -> MeetingSpeechQueueItem:
    state = await get_or_create_timer_state(session, meeting)
    now = datetime.now(UTC)
    for other in meeting.speech_queue:
        if (
            other.status in {SpeechQueueStatus.SPEAKING, SpeechQueueStatus.PAUSED}
            and other.id != item.id
        ):
            other.status = SpeechQueueStatus.FINISHED
            other.finished_at = now
    item.status = SpeechQueueStatus.SPEAKING
    item.started_at = now
    item.paused_at = None
    if item.remaining_seconds <= 0:
        item.remaining_seconds = item.duration_seconds
    state.active_speech_id = item.id
    state.status = TimerStatus.RUNNING
    state.server_started_at = now
    state.duration_seconds = item.remaining_seconds
    state.remaining_when_paused = item.remaining_seconds
    await session.flush()
    return item


async def pause_speech(
    session: AsyncSession, meeting: Meeting, item: MeetingSpeechQueueItem
) -> MeetingSpeechQueueItem:
    state = await get_or_create_timer_state(session, meeting)
    if state.active_speech_id != item.id or state.status != TimerStatus.RUNNING:
        raise ValueError("此發言目前沒有進行中的計時")
    remaining = current_timer_remaining(state)
    item.remaining_seconds = max(0, remaining)
    item.status = SpeechQueueStatus.PAUSED
    item.paused_at = datetime.now(UTC)
    state.status = TimerStatus.PAUSED if remaining >= 0 else TimerStatus.OVERTIME
    state.remaining_when_paused = remaining
    state.server_started_at = None
    await session.flush()
    return item


async def resume_speech(
    session: AsyncSession, meeting: Meeting, item: MeetingSpeechQueueItem
) -> MeetingSpeechQueueItem:
    state = await get_or_create_timer_state(session, meeting)
    if state.active_speech_id != item.id:
        state.active_speech_id = item.id
    item.status = SpeechQueueStatus.SPEAKING
    item.paused_at = None
    state.status = TimerStatus.RUNNING
    state.server_started_at = datetime.now(UTC)
    state.duration_seconds = item.remaining_seconds
    state.remaining_when_paused = item.remaining_seconds
    await session.flush()
    return item


async def finish_speech(
    session: AsyncSession,
    meeting: Meeting,
    item: MeetingSpeechQueueItem,
    *,
    status: SpeechQueueStatus = SpeechQueueStatus.FINISHED,
) -> MeetingSpeechQueueItem:
    state = await get_or_create_timer_state(session, meeting)
    if state.active_speech_id == item.id:
        item.remaining_seconds = max(0, current_timer_remaining(state))
        state.active_speech_id = None
        state.status = TimerStatus.IDLE
        state.server_started_at = None
        state.duration_seconds = meeting.default_speech_seconds
        state.remaining_when_paused = meeting.default_speech_seconds
    item.status = status
    item.finished_at = datetime.now(UTC)
    await session.flush()
    return item


async def extend_speech(
    session: AsyncSession, meeting: Meeting, item: MeetingSpeechQueueItem, *, seconds: int
) -> MeetingSpeechQueueItem:
    state = await get_or_create_timer_state(session, meeting)
    if state.active_speech_id == item.id and state.status == TimerStatus.RUNNING:
        remaining = current_timer_remaining(state) + seconds
        state.server_started_at = datetime.now(UTC)
        state.duration_seconds = remaining
        state.remaining_when_paused = remaining
        item.remaining_seconds = remaining
    else:
        item.remaining_seconds += seconds
    item.duration_seconds += seconds
    await session.flush()
    return item


async def open_vote(session: AsyncSession, vote: MeetingVote) -> MeetingVote:
    if vote.status == VoteStatus.CLOSED:
        raise ValueError("已關閉的表決不可重新開啟")
    vote.status = VoteStatus.OPEN
    vote.opened_at = datetime.now(UTC)
    await session.flush()
    return vote


async def close_vote(session: AsyncSession, vote: MeetingVote) -> MeetingVote:
    if vote.status != VoteStatus.OPEN:
        raise ValueError("只有進行中的表決可以關閉")
    vote.status = VoteStatus.CLOSED
    vote.closed_at = datetime.now(UTC)
    await session.flush()
    meeting = await session.get(Meeting, vote.meeting_id)
    if meeting is not None and meeting.mode == MeetingMode.SIMPLE:
        await _write_back_resolution(session, vote)
    return vote


async def _assert_voter_eligible(
    session: AsyncSession, vote: MeetingVote, voter_id: uuid.UUID
) -> None:
    attendance = await session.scalar(
        select(MeetingAttendance).where(
            MeetingAttendance.meeting_id == vote.meeting_id,
            MeetingAttendance.user_id == voter_id,
            MeetingAttendance.is_voting_eligible == True,  # noqa: E712
            MeetingAttendance.status == AttendanceStatus.PRESENT,
        )
    )
    if attendance is None:
        raise PermissionError("不是本場會議可投票且已出席的成員")
    if vote.agenda_item_id is not None:
        recused = await session.scalar(
            select(MeetingAgendaRecusal).where(
                MeetingAgendaRecusal.agenda_item_id == vote.agenda_item_id,
                MeetingAgendaRecusal.user_id == voter_id,
            )
        )
        if recused is not None:
            raise PermissionError("此委員已對本案迴避，不可表決")


async def cast_ballot(
    session: AsyncSession, vote: MeetingVote, *, voter_id: uuid.UUID, choice: BallotChoice
) -> MeetingBallot:
    if vote.status != VoteStatus.OPEN:
        raise ValueError("表決尚未開放或已關閉")
    await _assert_voter_eligible(session, vote, voter_id)
    existing = await session.scalar(
        select(MeetingBallot).where(
            MeetingBallot.vote_id == vote.id, MeetingBallot.voter_id == voter_id
        )
    )
    if existing is not None:
        raise ValueError("此表決已投票，關閉前不可重複投票")
    ballot = MeetingBallot(
        vote_id=vote.id, voter_id=voter_id, choice=choice, cast_at=datetime.now(UTC)
    )
    session.add(ballot)
    await session.flush()
    return ballot


async def recorder_cast_ballot(
    session: AsyncSession, vote: MeetingVote, *, data: RecorderBallotCreate
) -> MeetingBallot:
    """紀錄代登逐人票（簡易模式）：可重複登記以更正，不要求操作者＝投票者。"""
    if vote.status != VoteStatus.OPEN:
        raise ValueError("表決尚未開放或已關閉")
    await _assert_voter_eligible(session, vote, data.voter_id)
    existing = await session.scalar(
        select(MeetingBallot).where(
            MeetingBallot.vote_id == vote.id, MeetingBallot.voter_id == data.voter_id
        )
    )
    if existing is not None:
        existing.choice = data.choice
        existing.option_key = data.option_key
        existing.cast_at = datetime.now(UTC)
        await session.flush()
        return existing
    ballot = MeetingBallot(
        vote_id=vote.id,
        voter_id=data.voter_id,
        choice=data.choice,
        option_key=data.option_key,
        cast_at=datetime.now(UTC),
    )
    session.add(ballot)
    await session.flush()
    return ballot


async def record_manual_tally(
    session: AsyncSession,
    vote: MeetingVote,
    *,
    manual_tally: dict[str, int],
    result_label: str | None = None,
) -> MeetingVote:
    """主席口頭計票：寫入彙總票數、設為 TALLY 方式並關閉表決。"""
    vote.record_method = VoteRecordMethod.TALLY
    vote.manual_tally = {str(k): int(v) for k, v in manual_tally.items()}
    if result_label:
        vote.result_label = result_label
    if vote.status == VoteStatus.DRAFT:
        vote.opened_at = datetime.now(UTC)
    vote.status = VoteStatus.CLOSED
    vote.closed_at = datetime.now(UTC)
    await session.flush()
    await _write_back_resolution(session, vote)
    return vote


async def record_acclamation(
    session: AsyncSession,
    meeting: Meeting,
    *,
    agenda_item_id: uuid.UUID | None,
    title: str,
    result_label: str = "無異議通過",
) -> MeetingVote:
    """無異議通過：一鍵建立並關閉 ACCLAMATION 表決。"""
    vote = MeetingVote(
        meeting_id=meeting.id,
        agenda_item_id=agenda_item_id,
        title=title,
        visibility=VoteVisibility.NAMED,
        record_method=VoteRecordMethod.ACCLAMATION,
        result_label=result_label,
        status=VoteStatus.CLOSED,
        opened_at=datetime.now(UTC),
        closed_at=datetime.now(UTC),
    )
    session.add(vote)
    await session.flush()
    await _write_back_resolution(session, vote)
    return vote


async def _write_back_resolution(session: AsyncSession, vote: MeetingVote) -> None:
    if vote.agenda_item_id is None:
        return
    item = await session.get(MeetingAgendaItem, vote.agenda_item_id)
    if item is None:
        return
    eligible = await eligible_voter_count(session, vote.meeting_id)
    eligible -= await recused_voter_count(session, vote.meeting_id, vote.agenda_item_id)
    summary = await attendance_summary(session, vote.meeting_id)
    tally = _vote_tally(vote, max(eligible, 0), summary.get("present_voters", 0))
    item.resolution = _format_resolution(vote, tally)
    await session.flush()


def _format_resolution(vote: MeetingVote, tally: dict) -> str:
    method = VoteRecordMethod(vote.record_method)
    if method == VoteRecordMethod.ACCLAMATION:
        return vote.result_label or "無異議通過"
    if vote.options:
        labels = {str(o.get("key")): str(o.get("label")) for o in vote.options}
        parts = [
            f"{labels.get(key, key)} {count} 票"
            for key, count in tally.get("option_counts", {}).items()
        ]
        body = "、".join(parts)
        return f"{body}；{vote.result_label}" if vote.result_label else body
    verdict = "通過" if tally.get("passed") else "不通過"
    return f"同意 {tally['approve']}、不同意 {tally['reject']}、棄權 {tally['abstain']}，{verdict}"


async def add_recusal(
    session: AsyncSession,
    agenda_item: MeetingAgendaItem,
    *,
    user_id: uuid.UUID,
    note: str | None,
    created_by: uuid.UUID,
) -> MeetingAgendaRecusal:
    existing = await session.scalar(
        select(MeetingAgendaRecusal).where(
            MeetingAgendaRecusal.agenda_item_id == agenda_item.id,
            MeetingAgendaRecusal.user_id == user_id,
        )
    )
    if existing is not None:
        existing.note = note
        await session.flush()
        return existing
    recusal = MeetingAgendaRecusal(
        agenda_item_id=agenda_item.id, user_id=user_id, note=note, created_by=created_by
    )
    session.add(recusal)
    await session.flush()
    return recusal


async def remove_recusal(
    session: AsyncSession, agenda_item: MeetingAgendaItem, *, user_id: uuid.UUID
) -> bool:
    recusal = await session.scalar(
        select(MeetingAgendaRecusal).where(
            MeetingAgendaRecusal.agenda_item_id == agenda_item.id,
            MeetingAgendaRecusal.user_id == user_id,
        )
    )
    if recusal is None:
        return False
    await session.delete(recusal)
    await session.flush()
    return True


async def create_request(
    session: AsyncSession,
    meeting: Meeting,
    *,
    user_id: uuid.UUID,
    data: MeetingRequestCreate,
) -> MeetingRequest:
    record = MeetingRequest(
        meeting_id=meeting.id,
        user_id=user_id,
        request_type=data.request_type,
        agenda_item_id=data.agenda_item_id or meeting.current_agenda_item_id,
        content=data.content,
    )
    session.add(record)
    await session.flush()
    return record


async def update_request_status(
    session: AsyncSession,
    record: MeetingRequest,
    *,
    status: MeetingRequestStatus,
) -> MeetingRequest:
    record.status = status
    await session.flush()
    return record


async def eligible_voter_count(session: AsyncSession, meeting_id: uuid.UUID) -> int:
    return int(
        await session.scalar(
            select(func.count()).where(
                MeetingAttendance.meeting_id == meeting_id,
                MeetingAttendance.is_voting_eligible == True,  # noqa: E712
            )
        )
        or 0
    )


async def recused_voter_count(
    session: AsyncSession, meeting_id: uuid.UUID, agenda_item_id: uuid.UUID
) -> int:
    return int(
        await session.scalar(
            select(func.count())
            .select_from(MeetingAgendaRecusal)
            .join(
                MeetingAttendance,
                (MeetingAttendance.user_id == MeetingAgendaRecusal.user_id)
                & (MeetingAttendance.meeting_id == meeting_id),
            )
            .where(
                MeetingAgendaRecusal.agenda_item_id == agenda_item_id,
                MeetingAttendance.is_voting_eligible == True,  # noqa: E712
            )
        )
        or 0
    )


async def attendance_summary(session: AsyncSession, meeting_id: uuid.UUID) -> dict[str, int]:
    result = await session.execute(
        select(MeetingAttendance.status, func.count())
        .where(MeetingAttendance.meeting_id == meeting_id)
        .group_by(MeetingAttendance.status)
    )
    summary = {status.value: int(count) for status, count in result.all()}
    present_voters = await session.scalar(
        select(func.count()).where(
            MeetingAttendance.meeting_id == meeting_id,
            MeetingAttendance.status == AttendanceStatus.PRESENT,
            MeetingAttendance.is_voting_eligible == True,  # noqa: E712
        )
    )
    summary["present_voters"] = int(present_voters or 0)
    return summary
