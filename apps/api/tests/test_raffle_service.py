from types import SimpleNamespace

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

    assert _released_limits(event) == {"A": 0, "B": 1, "C": 2}
    assert {prize.tier for prize in _released_finite_prizes(event)} == {"B", "C"}


def test_release_limits_open_more_prizes_as_draw_count_grows():
    event = make_event(draw_count=100)

    assert _released_limits(event) == {"A": 2, "B": 6, "C": 8}


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
