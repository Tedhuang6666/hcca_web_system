"""抽獎業務邏輯：驗證碼入場、隨機獎池與序列化抽取。"""

from __future__ import annotations

import hashlib
import hmac
import math
import secrets
import uuid

from sqlalchemy import delete, desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.raffle import RaffleDraw, RaffleEvent, RafflePrize, RaffleSession, RaffleStatus
from api.models.user import User
from api.schemas.raffle import RaffleActivate, RaffleDrawRequest, RafflePrizeInput

DEFAULT_EVENT_TITLE = "現場抽獎"
DEFAULT_EVENT_DESCRIPTION = "每位參加者一次機會；獎品由系統公平分配。"
DEFAULT_PRIZES = (
    ("A", "屁墊", 2, 0),
    ("A", "水壺", 2, 1),
    ("A", "帽踢", 2, 2),
    ("B", "麻袋", 5, 3),
    ("B", "帆布袋", 5, 4),
    ("C", "金屬吊牌", 10, 5),
    ("C", "帽子", 10, 6),
    ("D", "毛巾", 35, 7),
    ("F", "資料夾或徽章", None, 8),
)

# 活動規模保底 200 人；有限獎機率會隨階段、剩餘庫存與剩餘名額動態調整。
PLANNED_DRAW_COUNT = 200
A_PRIZE_RELEASE_DRAW = 50
RESERVE_RATIO_BY_RANK = (0.25, 0.2, 0.1)


def _hash(value: str) -> str:
    return hashlib.sha256(value.strip().encode()).hexdigest()


def _is_valid_code(value: str, digest: str) -> bool:
    return hmac.compare_digest(_hash(value), digest)


async def list_events(db: AsyncSession) -> list[RaffleEvent]:
    result = await db.execute(
        select(RaffleEvent)
        .options(selectinload(RaffleEvent.prizes))
        .order_by(desc(RaffleEvent.created_at))
    )
    return list(result.scalars().unique().all())


async def get_event(db: AsyncSession, event_id: uuid.UUID) -> RaffleEvent | None:
    result = await db.execute(
        select(RaffleEvent)
        .options(selectinload(RaffleEvent.prizes))
        .where(RaffleEvent.id == event_id)
    )
    return result.scalar_one_or_none()


async def create_event(db: AsyncSession, body: RaffleActivate, user: User) -> RaffleEvent:
    active_result = await db.execute(
        select(RaffleEvent)
        .where(RaffleEvent.status.in_([RaffleStatus.OPEN, RaffleStatus.PAUSED]))
        .with_for_update()
    )
    for active_event in active_result.scalars().all():
        active_event.status = RaffleStatus.CLOSED

    event = RaffleEvent(
        event_code=f"raffle-{uuid.uuid4().hex[:24]}",
        title=DEFAULT_EVENT_TITLE,
        description=DEFAULT_EVENT_DESCRIPTION,
        access_code_hash=_hash(body.access_code),
        access_code_hint=body.access_code[-2:].rjust(len(body.access_code), "•"),
        created_by_id=user.id,
        status=RaffleStatus.OPEN,
    )
    prize_inputs = body.prizes or [
        RafflePrizeInput(tier=tier, name=name, total_quantity=quantity)
        for tier, name, quantity, _sort_order in DEFAULT_PRIZES
    ]
    event.prizes = _build_prizes(prize_inputs)
    db.add(event)
    await db.flush()
    return event


async def update_event(
    db: AsyncSession,
    event_id: uuid.UUID,
    status: RaffleStatus | None,
    reserve_released: bool | None,
    prizes: list[RafflePrizeInput] | None = None,
) -> RaffleEvent:
    result = await db.execute(
        select(RaffleEvent)
        .options(selectinload(RaffleEvent.prizes))
        .where(RaffleEvent.id == event_id)
    )
    event = result.scalar_one_or_none()
    if event is None:
        raise ValueError("找不到抽獎活動")
    if status is None and reserve_released is None and prizes is None:
        raise ValueError("至少要提供一項活動設定")
    if status is not None:
        event.status = status
    if reserve_released is not None:
        event.reserve_released = reserve_released
    if prizes is not None:
        if event.draw_count > 0:
            raise ValueError("抽獎開始後無法修改獎池，請先清除本輪測試資料")
        event.prizes = _build_prizes(prizes)
    await db.flush()
    return event


async def reset_event(db: AsyncSession, event_id: uuid.UUID) -> RaffleEvent:
    result = await db.execute(
        select(RaffleEvent)
        .options(selectinload(RaffleEvent.prizes))
        .where(RaffleEvent.id == event_id)
        .with_for_update()
    )
    event = result.scalar_one_or_none()
    if event is None:
        raise ValueError("找不到抽獎活動")

    await db.execute(delete(RaffleDraw).where(RaffleDraw.event_id == event.id))
    await db.execute(delete(RaffleSession).where(RaffleSession.event_id == event.id))
    for prize in event.prizes:
        prize.remaining_quantity = prize.total_quantity
    event.draw_count = 0
    event.reserve_released = False
    event.status = RaffleStatus.OPEN
    await db.flush()
    return event


async def join_event(
    db: AsyncSession,
    access_code: str,
    device_id: str | None,
) -> tuple[RaffleSession, RaffleEvent, str]:
    result = await db.execute(
        select(RaffleEvent)
        .options(selectinload(RaffleEvent.prizes))
        .where(RaffleEvent.status.in_([RaffleStatus.OPEN, RaffleStatus.PAUSED]))
        .order_by(desc(RaffleEvent.created_at))
    )
    event = result.scalars().first()
    if event is None:
        raise ValueError("目前尚未開放抽獎")
    if not _is_valid_code(access_code, event.access_code_hash):
        raise PermissionError("驗證碼不正確")

    token = secrets.token_urlsafe(32)
    session = RaffleSession(event_id=event.id, token_hash=_hash(token), device_id=device_id)
    db.add(session)
    await db.flush()
    return session, event, token


async def get_public_event(
    db: AsyncSession, session_token: str
) -> tuple[RaffleSession, RaffleEvent]:
    result = await db.execute(
        select(RaffleSession)
        .options(selectinload(RaffleSession.event).selectinload(RaffleEvent.prizes))
        .where(RaffleSession.token_hash == _hash(session_token))
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise PermissionError("抽獎連線已失效，請重新輸入驗證碼")
    return session, session.event


async def get_session_draw(db: AsyncSession, session_id: uuid.UUID) -> RaffleDraw | None:
    result = await db.execute(
        select(RaffleDraw)
        .options(selectinload(RaffleDraw.prize))
        .where(RaffleDraw.session_id == session_id)
    )
    return result.scalar_one_or_none()


async def next_session(
    db: AsyncSession, session_token: str
) -> tuple[RaffleSession, RaffleEvent, str]:
    result = await db.execute(
        select(RaffleSession)
        .options(selectinload(RaffleSession.event).selectinload(RaffleEvent.prizes))
        .where(RaffleSession.token_hash == _hash(session_token))
        .with_for_update()
    )
    current = result.scalar_one_or_none()
    if current is None:
        raise PermissionError("抽獎連線已失效，請重新輸入驗證碼")
    if not current.has_drawn:
        raise ValueError("目前這台平板尚未完成上一輪抽獎")
    if current.event.status not in {RaffleStatus.OPEN, RaffleStatus.PAUSED}:
        raise ValueError("這場抽獎目前已結束")

    token = secrets.token_urlsafe(32)
    session = RaffleSession(
        event_id=current.event_id, token_hash=_hash(token), device_id=current.device_id
    )
    db.add(session)
    await db.flush()
    return session, current.event, token


def _finite_prizes(event: RaffleEvent) -> list[RafflePrize]:
    return [
        prize for prize in event.prizes if prize.remaining_quantity and prize.remaining_quantity > 0
    ]


def _build_prizes(prizes: list[RafflePrizeInput]) -> list[RafflePrize]:
    return [
        RafflePrize(
            tier=prize.tier.strip(),
            name=prize.name.strip(),
            total_quantity=prize.total_quantity,
            remaining_quantity=prize.total_quantity,
            sort_order=sort_order,
        )
        for sort_order, prize in enumerate(prizes)
    ]


def _finite_tiers(event: RaffleEvent) -> list[str]:
    return sorted({prize.tier for prize in event.prizes if prize.total_quantity is not None})


def _tier_totals(event: RaffleEvent) -> dict[str, int]:
    return {
        tier: sum(prize.total_quantity or 0 for prize in event.prizes if prize.tier == tier)
        for tier in _finite_tiers(event)
    }


def _tier_claimed(event: RaffleEvent) -> dict[str, int]:
    return {
        tier: max(
            0,
            _tier_totals(event)[tier]
            - sum(prize.remaining_quantity or 0 for prize in event.prizes if prize.tier == tier),
        )
        for tier in _finite_tiers(event)
    }


def _released_limits(event: RaffleEvent) -> dict[str, int]:
    totals = _tier_totals(event)
    if event.reserve_released:
        return totals

    tiers = list(totals)
    reserved = _reserved_quantities(event)
    limits = {
        tier: min(total, max(0, total - reserved.get(tier, 0))) for tier, total in totals.items()
    }
    if tiers and event.draw_count < A_PRIZE_RELEASE_DRAW:
        limits[tiers[0]] = 0
    return limits


def _reserved_quantities(event: RaffleEvent) -> dict[str, int]:
    totals = _tier_totals(event)
    return {
        tier: min(
            total,
            max(1, math.ceil(total * RESERVE_RATIO_BY_RANK[min(rank, 2)])) if total > 0 else 0,
        )
        for rank, (tier, total) in enumerate(totals.items())
    }


def reserved_quantities(event: RaffleEvent) -> dict[str, int]:
    return _reserved_quantities(event)


def _released_finite_prizes(event: RaffleEvent) -> list[RafflePrize]:
    claimed = _tier_claimed(event)
    limits = _released_limits(event)
    return [
        prize
        for prize in _finite_prizes(event)
        if claimed.get(prize.tier, 0) < limits.get(prize.tier, 0)
    ]


def _released_finite_count(event: RaffleEvent) -> int:
    claimed = _tier_claimed(event)
    limits = _released_limits(event)
    count = 0
    for tier, limit in limits.items():
        remaining = sum(
            prize.remaining_quantity or 0 for prize in event.prizes if prize.tier == tier
        )
        count += min(remaining, max(0, limit - claimed[tier]))
    return count


def _selection_weights(prizes: list[RafflePrize], final_mode: bool = False) -> list[int]:
    tiers = sorted({prize.tier for prize in prizes})
    tier_weights = {
        tier: (max(1, len(tiers) * 2 - rank) if final_mode else 1 + rank * 2)
        for rank, tier in enumerate(tiers)
    }
    return [
        tier_weights[prize.tier]
        * (prize.remaining_quantity if prize.remaining_quantity is not None else 1)
        for prize in prizes
    ]


def _weighted_choice(prizes: list[RafflePrize], final_mode: bool = False) -> RafflePrize:
    weights = _selection_weights(prizes, final_mode)
    total = sum(weights)
    point = secrets.randbelow(total)
    for prize, weight in zip(prizes, weights, strict=True):
        point -= weight
        if point < 0:
            return prize
    return prizes[-1]


def _should_give_finite(event: RaffleEvent) -> bool:
    finite_count = _released_finite_count(event)
    if finite_count == 0:
        return False
    remaining_slots = max(1, PLANNED_DRAW_COUNT - event.draw_count)
    if finite_count >= remaining_slots:
        return True
    return secrets.randbelow(remaining_slots) < finite_count


def _select_prize(event: RaffleEvent) -> RafflePrize | None:
    finite = _released_finite_prizes(event)
    participation = [prize for prize in event.prizes if prize.remaining_quantity is None]
    if finite and _should_give_finite(event):
        return _weighted_choice(finite, event.reserve_released)
    if participation:
        return _weighted_choice(participation, event.reserve_released)
    return _weighted_choice(finite, event.reserve_released) if finite else None


def current_prize_probabilities(event: RaffleEvent) -> dict[uuid.UUID, float]:
    finite = _released_finite_prizes(event)
    participation = [prize for prize in event.prizes if prize.remaining_quantity is None]
    finite_count = _released_finite_count(event)
    remaining_slots = max(1, PLANNED_DRAW_COUNT - event.draw_count)
    finite_chance = min(1.0, finite_count / remaining_slots) if finite_count else 0.0
    probabilities: dict[uuid.UUID, float] = {}

    if finite:
        weights = _selection_weights(finite, event.reserve_released)
        weight_total = sum(weights)
        for prize, weight in zip(finite, weights, strict=True):
            probabilities[prize.id] = finite_chance * weight / weight_total * 100
    if participation:
        share = (1 - finite_chance) * 100 / len(participation)
        probabilities.update({prize.id: share for prize in participation})
    if not probabilities:
        weights = _selection_weights(event.prizes, event.reserve_released)
        weight_total = sum(weights)
        probabilities = {
            prize.id: weight / weight_total * 100
            for prize, weight in zip(event.prizes, weights, strict=True)
        }
    return probabilities


async def draw(db: AsyncSession, body: RaffleDrawRequest) -> RaffleDraw:
    session_result = await db.execute(
        select(RaffleSession).where(RaffleSession.token_hash == _hash(body.session_token))
    )
    session = session_result.scalar_one_or_none()
    if session is None:
        raise PermissionError("抽獎連線已失效，請重新輸入驗證碼")

    # 活動列是整場抽獎的序列化閘門：多台平板可同時送出，但只會依序進入這個區段。
    event_result = await db.execute(
        select(RaffleEvent)
        .options(selectinload(RaffleEvent.prizes))
        .where(RaffleEvent.id == session.event_id)
        .with_for_update()
    )
    event = event_result.scalar_one()

    existing_result = await db.execute(
        select(RaffleDraw)
        .options(selectinload(RaffleDraw.prize))
        .where(
            RaffleDraw.event_id == event.id,
            RaffleDraw.idempotency_key == body.idempotency_key,
        )
    )
    existing = existing_result.scalar_one_or_none()
    if existing is not None:
        return existing
    if session.has_drawn:
        result = await db.execute(
            select(RaffleDraw)
            .options(selectinload(RaffleDraw.prize))
            .where(RaffleDraw.session_id == session.id)
        )
        return result.scalar_one()
    if event.status != RaffleStatus.OPEN:
        raise ValueError("這場抽獎目前沒有開放抽獎")

    prize = _select_prize(event)
    if prize is None:
        raise ValueError("獎品尚未設定")
    if prize.remaining_quantity is not None:
        if prize.remaining_quantity <= 0:
            raise ValueError("這份獎品剛好被其他平板抽完，請再試一次")
        prize.remaining_quantity -= 1

    event.draw_count += 1
    session.has_drawn = True
    result = RaffleDraw(
        event_id=event.id,
        session_id=session.id,
        prize_id=prize.id,
        draw_number=event.draw_count,
        idempotency_key=body.idempotency_key,
    )
    db.add(result)
    await db.flush()
    result.prize = prize
    return result


async def recent_draws(db: AsyncSession, event_id: uuid.UUID, limit: int = 12) -> list[RaffleDraw]:
    result = await db.execute(
        select(RaffleDraw)
        .options(selectinload(RaffleDraw.prize))
        .where(RaffleDraw.event_id == event_id)
        .order_by(desc(RaffleDraw.draw_number))
        .limit(limit)
    )
    return list(result.scalars().all())


__all__ = [
    "create_event",
    "draw",
    "get_event",
    "get_public_event",
    "get_session_draw",
    "join_event",
    "list_events",
    "next_session",
    "recent_draws",
    "reset_event",
    "update_event",
]
