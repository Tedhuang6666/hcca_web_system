"""螢幕 / 加入 / 工作台 / 會議紀錄 payload 組裝"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import TAIPEI, local_today
from api.models.meeting import (
    AttendanceStatus,
    BallotChoice,
    Meeting,
    MeetingAttendance,
    MeetingStatus,
    SpeechQueueStatus,
    VoteStatus,
    VoteVisibility,
)
from api.models.school_class import ClassMembership, ClassMembershipStatus, SchoolClass
from api.services.meeting._agenda import list_events
from api.services.meeting._session import list_meetings
from api.services.meeting._voting import (
    _vote_tally,
    attendance_summary,
    eligible_voter_count,
    get_or_create_screen_state,
    get_or_create_timer_state,
    recused_voter_count,
)


async def decorate_vote(
    session: AsyncSession, vote, *, include_ballots: bool
) -> dict:
    eligible = await eligible_voter_count(session, vote.meeting_id)
    if vote.agenda_item_id is not None:
        eligible -= await recused_voter_count(session, vote.meeting_id, vote.agenda_item_id)
    eligible = max(eligible, 0)
    summary = await attendance_summary(session, vote.meeting_id)
    ballots = vote.ballots if include_ballots or vote.visibility == VoteVisibility.NAMED else []
    return {
        "id": vote.id,
        "meeting_id": vote.meeting_id,
        "agenda_item_id": vote.agenda_item_id,
        "title": vote.title,
        "description": vote.description,
        "visibility": vote.visibility,
        "status": vote.status,
        "pass_threshold": vote.pass_threshold,
        "threshold_type": vote.threshold_type,
        "record_method": vote.record_method,
        "options": vote.options,
        "manual_tally": vote.manual_tally,
        "result_label": vote.result_label,
        "opened_at": vote.opened_at,
        "closed_at": vote.closed_at,
        "result_note": vote.result_note,
        "created_at": vote.created_at,
        "updated_at": vote.updated_at,
        "tally": _vote_tally(vote, eligible, summary.get("present_voters", 0)),
        "ballots": ballots,
    }


def _vote_roster_status(record: dict[str, int]) -> str:
    choices = sum(1 for key in ("approve", "reject", "abstain") if record[key] > 0)
    if choices > 1:
        return "mixed"
    if record["approve"] > 0:
        return "approve"
    if record["reject"] > 0:
        return "reject"
    if record["abstain"] > 0:
        return "abstain"
    return "not_voted"


async def vote_roster_payload(
    session: AsyncSession, meeting: Meeting, vote
) -> dict | None:
    if vote is None:
        return None

    class_rows = await session.execute(
        select(SchoolClass.id, SchoolClass.class_code, SchoolClass.label, SchoolClass.grade)
        .where(SchoolClass.is_active == True)  # noqa: E712
        .order_by(SchoolClass.grade.asc(), SchoolClass.class_code.asc())
    )
    records: dict[uuid.UUID | None, dict] = {
        class_id: {
            "class_id": class_id,
            "class_code": class_code,
            "label": label or class_code,
            "grade": grade,
            "eligible": 0,
            "present": 0,
            "approve": 0,
            "reject": 0,
            "abstain": 0,
            "not_voted": 0,
            "status": "not_voted",
        }
        for class_id, class_code, label, grade in class_rows.all()
    }
    unassigned = {
        "class_id": None,
        "class_code": "未分班",
        "label": "未分班",
        "grade": None,
        "eligible": 0,
        "present": 0,
        "approve": 0,
        "reject": 0,
        "abstain": 0,
        "not_voted": 0,
        "status": "not_voted",
    }
    eligible_records = [r for r in meeting.attendance_records if r.is_voting_eligible]
    user_ids = [r.user_id for r in eligible_records if r.voting_class_id is None]
    user_class: dict[uuid.UUID, uuid.UUID] = {}
    if user_ids:
        membership_rows = await session.execute(
            select(ClassMembership.user_id, ClassMembership.class_id)
            .join(SchoolClass, SchoolClass.id == ClassMembership.class_id)
            .where(
                ClassMembership.user_id.in_(user_ids),
                ClassMembership.status == ClassMembershipStatus.ACTIVE,
                SchoolClass.is_active == True,  # noqa: E712
            )
            .order_by(ClassMembership.academic_year.desc())
        )
        for user_id, class_id in membership_rows.all():
            user_class.setdefault(user_id, class_id)

    ballots = {ballot.voter_id: ballot.choice for ballot in vote.ballots}
    for record in eligible_records:
        class_id = record.voting_class_id or user_class.get(record.user_id)
        target = records.get(class_id, unassigned)
        target["eligible"] += 1
        if record.status == AttendanceStatus.PRESENT:
            target["present"] += 1
        choice = ballots.get(record.user_id)
        if choice == BallotChoice.APPROVE:
            target["approve"] += 1
        elif choice == BallotChoice.REJECT:
            target["reject"] += 1
        elif choice == BallotChoice.ABSTAIN:
            target["abstain"] += 1
        else:
            target["not_voted"] += 1

    for record in records.values():
        record["status"] = _vote_roster_status(record)
    unassigned["status"] = _vote_roster_status(unassigned)
    return {
        "classes": list(records.values()),
        "unassigned": unassigned if unassigned["eligible"] > 0 else None,
    }


async def screen_payload(session: AsyncSession, meeting: Meeting) -> dict:
    current = next(
        (item for item in meeting.agenda_items if item.id == meeting.current_agenda_item_id), None
    )
    active_vote = next((vote for vote in meeting.votes if vote.status == VoteStatus.OPEN), None)
    timer_state = await get_or_create_timer_state(session, meeting)
    active_speech = next(
        (
            item
            for item in meeting.speech_queue
            if item.id == timer_state.active_speech_id
            or item.status in {SpeechQueueStatus.SPEAKING, SpeechQueueStatus.PAUSED}
        ),
        None,
    )
    return {
        "meeting": meeting,
        "current_agenda_item": current,
        "active_vote": await decorate_vote(session, active_vote, include_ballots=False)
        if active_vote
        else None,
        "attendance_summary": await attendance_summary(session, meeting.id),
        "screen_state": await get_or_create_screen_state(session, meeting),
        "vote_roster": await vote_roster_payload(session, meeting, active_vote),
        "active_speech": active_speech,
        "speech_queue": [
            item
            for item in sorted(meeting.speech_queue, key=lambda item: item.order_index)
            if item.status
            in {SpeechQueueStatus.QUEUED, SpeechQueueStatus.SPEAKING, SpeechQueueStatus.PAUSED}
        ],
        "timer_state": timer_state,
    }


async def join_payload(
    session: AsyncSession, meeting: Meeting, *, user_id: uuid.UUID
) -> dict:
    record = await session.scalar(
        select(MeetingAttendance).where(
            MeetingAttendance.meeting_id == meeting.id,
            MeetingAttendance.user_id == user_id,
        )
    )
    current = next(
        (item for item in meeting.agenda_items if item.id == meeting.current_agenda_item_id), None
    )
    active_vote = next((vote for vote in meeting.votes if vote.status == VoteStatus.OPEN), None)
    my_ballot = (
        next((ballot for ballot in active_vote.ballots if ballot.voter_id == user_id), None)
        if active_vote
        else None
    )
    timer_state = await get_or_create_timer_state(session, meeting)
    active_speech = next(
        (
            item
            for item in meeting.speech_queue
            if item.id == timer_state.active_speech_id
            or item.status in {SpeechQueueStatus.SPEAKING, SpeechQueueStatus.PAUSED}
        ),
        None,
    )
    return {
        "meeting": meeting,
        "current_agenda_item": current,
        "attendance": record,
        "is_rostered": record is not None,
        "can_vote": bool(
            record and record.is_voting_eligible and record.status == AttendanceStatus.PRESENT
        ),
        "active_vote": await decorate_vote(session, active_vote, include_ballots=False)
        if active_vote
        else None,
        "my_ballot": my_ballot,
        "my_speech_queue_items": [
            item
            for item in sorted(meeting.speech_queue, key=lambda item: item.order_index)
            if item.user_id == user_id
            and item.status
            in {SpeechQueueStatus.QUEUED, SpeechQueueStatus.SPEAKING, SpeechQueueStatus.PAUSED}
        ],
        "active_speech": active_speech,
        "timer_state": timer_state,
    }


async def workspace_payload(session: AsyncSession) -> dict:
    today = local_today()
    rows = await list_meetings(session, limit=200)
    return {
        "today": [m for m in rows if m.starts_at and m.starts_at.date() == today],
        "drafts": [m for m in rows if m.status in {MeetingStatus.DRAFT, MeetingStatus.CONFIRMED}],
        "active": [
            m
            for m in rows
            if m.status
            in {
                MeetingStatus.CHECKIN,
                MeetingStatus.ACTIVE,
                MeetingStatus.BREAK,
                MeetingStatus.PAUSED,
            }
        ],
        "closing_pending": [m for m in rows if m.status == MeetingStatus.CLOSED],
    }


def _fmt_local(dt: datetime | None) -> str:
    return dt.astimezone(TAIPEI).strftime("%Y-%m-%d %H:%M") if dt else "未填"


def _attendee_names(meeting: Meeting, statuses: set) -> list[str]:
    return [
        (record.user.display_name if record.user else str(record.user_id))
        for record in meeting.attendance_records
        if record.status in statuses
    ]


def _full_minutes_lines(meeting: Meeting, votes: list[dict], summary: dict[str, int]) -> list[str]:
    lines = [
        f"# {meeting.title}",
        "",
        f"- 地點：{meeting.location or '未填'}",
        f"- 主席：{meeting.chair_name or '未填'}",
        f"- 出席表決權人數：{summary.get('present_voters', 0)}",
        "",
        "## 議程與決議",
    ]
    for item in sorted(meeting.agenda_items, key=lambda x: x.order_index):
        lines.append(f"### {item.order_index + 1}. {item.title}")
        if item.description:
            lines.append(item.description)
        if item.artifact_links:
            lines.append("資料包：")
            for link in item.artifact_links:
                suffix = f" {link.url}" if link.url else ""
                lines.append(f"- {link.title}{suffix}")
        if item.attachments:
            lines.append("附件：")
            for attachment in item.attachments:
                lines.append(f"- {attachment.display_name or attachment.filename}")
        if item.resolution:
            lines.append(f"決議：{item.resolution}")
    if meeting.motions:
        lines.extend(["", "## 動議"])
        for motion in meeting.motions:
            lines.append(f"- {motion.title}（{motion.status}）")
    if meeting.decisions:
        lines.extend(["", "## 正式決議"])
        for decision in meeting.decisions:
            lines.append(f"- {decision.title}：{decision.content}")
    if meeting.speech_queue:
        lines.extend(["", "## 發言紀錄"])
        for item in sorted(meeting.speech_queue, key=lambda x: x.started_at or x.created_at):
            if item.status in {SpeechQueueStatus.FINISHED, SpeechQueueStatus.SKIPPED}:
                lines.append(f"- {item.speaker_name}：{item.status}")
    lines.extend(["", "## 表決"])
    for vote in votes:
        tally = vote["tally"]
        lines.append(
            f"- {vote['title']}：同意 {tally['approve']}、反對 {tally['reject']}、"
            f"棄權 {tally['abstain']}，{'通過' if tally['passed'] else '未通過'}"
        )
    return lines


def _simple_minutes_lines(meeting: Meeting, summary: dict[str, int]) -> list[str]:
    present = _attendee_names(meeting, {AttendanceStatus.PRESENT})
    leave = _attendee_names(meeting, {AttendanceStatus.LEAVE})
    absent = _attendee_names(meeting, {AttendanceStatus.ABSENT})
    lines = [
        f"# {meeting.title}",
        "",
        f"- 開會時間：{_fmt_local(meeting.starts_at)}",
        f"- 地點：{meeting.location or '未填'}",
        f"- 主席：{meeting.chair_name or '未填'}",
        f"- 出席委員（{len(present)}）：{'、'.join(present) or '無'}",
    ]
    if leave:
        lines.append(f"- 請假：{'、'.join(leave)}")
    if absent:
        lines.append(f"- 缺席：{'、'.join(absent)}")
    lines.extend(["", "## 討論事項"])
    for item in sorted(meeting.agenda_items, key=lambda x: x.order_index):
        lines.append(f"### {item.order_index + 1}. {item.title}")
        if item.description:
            lines.append(f"說明：{item.description}")
        if item.notes:
            lines.append(f"討論：{item.notes}")
        recused = [(r.user.display_name if r.user else str(r.user_id)) for r in item.recusals]
        if recused:
            lines.append(f"（{'、'.join(recused)}委員迴避）")
        lines.append(f"決議：{item.resolution or '未做成決議'}")
        lines.append("")
    return lines


async def minutes_payload(session: AsyncSession, meeting: Meeting) -> dict:
    from api.models.meeting import MeetingMode

    votes = [await decorate_vote(session, vote, include_ballots=True) for vote in meeting.votes]
    summary = await attendance_summary(session, meeting.id)
    if meeting.mode == MeetingMode.SIMPLE:
        lines = _simple_minutes_lines(meeting, summary)
    else:
        lines = _full_minutes_lines(meeting, votes, summary)
    return {
        "meeting": meeting,
        "attendance_summary": summary,
        "agenda_items": sorted(meeting.agenda_items, key=lambda x: x.order_index),
        "votes": votes,
        "events": await list_events(session, meeting.id),
        "markdown": "\n".join(lines),
    }
