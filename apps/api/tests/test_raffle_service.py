from itertools import cycle
from types import SimpleNamespace

from api.services import raffle as raffle_service
from api.services.raffle import _released_finite_prizes, _released_limits


def make_event(draw_count: int, reserve_released: bool = False):
    prizes = [
        SimpleNamespace(tier="A", total_quantity=4, remaining_quantity=4),
        SimpleNamespace(tier="B", total_quantity=10, remaining_quantity=10),
        SimpleNamespace(tier="C", total_quantity=10, remaining_quantity=10),
        SimpleNamespace(tier="D", total_quantity=None, remaining_quantity=None),
    ]
    return SimpleNamespace(
        draw_count=draw_count,
        reserve_released=reserve_released,
        prizes=prizes,
    )


def test_release_limits_hold_back_a_prize_at_the_start():
    event = make_event(draw_count=0)

    assert _released_limits(event) == {"A": 0, "B": 8, "C": 9}
    assert {prize.tier for prize in _released_finite_prizes(event)} == {"B", "C"}


def test_release_limits_open_more_prizes_as_draw_count_grows():
    event = make_event(draw_count=100)

    assert _released_limits(event) == {"A": 3, "B": 8, "C": 9}


def test_release_limits_keep_late_reserve_until_admin_releases_it():
    event = make_event(draw_count=60)
    event.prizes[0].remaining_quantity = 1
    event.prizes[1].remaining_quantity = 2
    event.prizes[2].remaining_quantity = 1

    assert _released_finite_prizes(event) == []
    assert [prize.remaining_quantity for prize in event.prizes[:3]] == [1, 2, 1]


def test_release_limits_release_everything_in_final_mode():
    event = make_event(draw_count=0, reserve_released=True)

    assert _released_limits(event) == {"A": 4, "B": 10, "C": 10}
    assert {prize.tier for prize in _released_finite_prizes(event)} == {"A", "B", "C"}


def test_draw_result_randomly_selects_finite_or_participation_prize(monkeypatch):
    event = make_event(draw_count=0)

    monkeypatch.setattr(raffle_service.secrets, "randbelow", lambda limit: 0)
    assert raffle_service._select_prize(event).tier in {"B", "C"}

    monkeypatch.setattr(raffle_service.secrets, "randbelow", lambda limit: limit - 1)
    assert raffle_service._select_prize(event).tier == "D"


def test_draw_results_follow_random_probability_not_fixed_draw_schedule(monkeypatch):
    event = make_event(draw_count=100)
    for prize in event.prizes[:3]:
        prize.total_quantity = 1_000
        prize.remaining_quantity = 1_000
    gate_rolls = cycle((0, 1, 2))

    def randbelow(limit: int) -> int:
        return next(gate_rolls) if limit == raffle_service.FINITE_PRIZE_ROLLS else 0

    monkeypatch.setattr(raffle_service.secrets, "randbelow", randbelow)
    results = [raffle_service._select_prize(event).tier for _ in range(300)]

    assert results.count("D") == 200
    assert sum(tier != "D" for tier in results) == 100
