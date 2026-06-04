"""簡易評議模式：表決計票與決議文字產生的純函式測試。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from api.models.meeting import (
    BallotChoice,
    MeetingBallot,
    MeetingVote,
    VoteRecordMethod,
    VoteThresholdType,
)
from api.services.meeting import _format_resolution, _vote_tally


def _vote(**overrides: Any) -> MeetingVote:
    vote = MeetingVote(
        id=uuid.uuid4(),
        meeting_id=uuid.uuid4(),
        title="議案一",
        threshold_type=VoteThresholdType.SIMPLE_MAJORITY,
        record_method=VoteRecordMethod.BALLOTS,
    )
    for key, value in overrides.items():
        setattr(vote, key, value)
    return vote


def _ballot(choice: BallotChoice, option_key: str | None = None) -> MeetingBallot:
    return MeetingBallot(
        id=uuid.uuid4(),
        vote_id=uuid.uuid4(),
        voter_id=uuid.uuid4(),
        choice=choice,
        option_key=option_key,
        cast_at=datetime.now(UTC),
    )


def test_acclamation_tally_passes_without_counts() -> None:
    vote = _vote(record_method=VoteRecordMethod.ACCLAMATION, result_label="無異議通過")
    tally = _vote_tally(vote, eligible_count=7, present_voters=5)
    assert tally["passed"] is True
    assert tally["result_label"] == "無異議通過"
    assert tally["approve"] == 5  # 視為全體出席表決權同意
    assert _format_resolution(vote, tally) == "無異議通過"


def test_manual_tally_standard_options() -> None:
    vote = _vote(
        record_method=VoteRecordMethod.TALLY,
        manual_tally={"approve": 4, "reject": 1, "abstain": 2},
    )
    tally = _vote_tally(vote, eligible_count=7, present_voters=7)
    assert (tally["approve"], tally["reject"], tally["abstain"]) == (4, 1, 2)
    assert tally["passed"] is True  # 同意多於不同意
    assert _format_resolution(vote, tally) == "同意 4、不同意 1、棄權 2，通過"


def test_manual_tally_rejected_when_reject_majority() -> None:
    vote = _vote(
        record_method=VoteRecordMethod.TALLY,
        manual_tally={"approve": 1, "reject": 5, "abstain": 0},
    )
    tally = _vote_tally(vote, eligible_count=7, present_voters=6)
    assert tally["passed"] is False
    assert "不通過" in _format_resolution(vote, tally)


def test_custom_options_tally_counts_and_resolution() -> None:
    vote = _vote(
        record_method=VoteRecordMethod.TALLY,
        options=[{"key": "a", "label": "甲案"}, {"key": "b", "label": "乙案"}],
        manual_tally={"a": 5, "b": 3},
        result_label="甲案通過",
    )
    tally = _vote_tally(vote, eligible_count=8, present_voters=8)
    assert tally["option_counts"] == {"a": 5, "b": 3}
    assert tally["total"] == 8
    assert tally["passed"] is True  # result_label 已認定
    resolution = _format_resolution(vote, tally)
    assert "甲案 5 票" in resolution and "乙案 3 票" in resolution and "甲案通過" in resolution


def test_ballots_method_counts_from_individual_votes() -> None:
    vote = _vote(record_method=VoteRecordMethod.BALLOTS)
    vote.ballots = [
        _ballot(BallotChoice.APPROVE),
        _ballot(BallotChoice.APPROVE),
        _ballot(BallotChoice.REJECT),
    ]
    tally = _vote_tally(vote, eligible_count=5, present_voters=3)
    assert (tally["approve"], tally["reject"], tally["abstain"]) == (2, 1, 0)
    assert tally["passed"] is True


def test_ballots_method_with_custom_option_keys() -> None:
    vote = _vote(
        record_method=VoteRecordMethod.BALLOTS,
        options=[{"key": "a", "label": "甲案"}, {"key": "b", "label": "乙案"}],
        result_label="甲案通過",
    )
    vote.ballots = [
        _ballot(BallotChoice.APPROVE, option_key="a"),
        _ballot(BallotChoice.APPROVE, option_key="a"),
        _ballot(BallotChoice.APPROVE, option_key="b"),
    ]
    tally = _vote_tally(vote, eligible_count=5, present_voters=3)
    assert tally["option_counts"] == {"a": 2, "b": 1}
