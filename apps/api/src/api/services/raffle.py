"""抽獎業務邏輯：驗證碼入場、保留節奏與序列化抽取。"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid

from sqlalchemy import delete, desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.raffle import RaffleDraw, RaffleEvent, RafflePrize, RaffleSession, RaffleStatus
from api.models.user import User
from api.schemas.raffle import RaffleActivate, RaffleDrawRequest

DEFAULT_EVENT_TITLE = "現場抽獎"
DEFAULT_EVENT_DESCRIPTION = "每位參加者一次機會；獎品由系統公平分配。"
DEFAULT_PRIZES = (
    ("A", "水壺", 2, 0),
    ("A", "帽踢", 2, 1),
    ("B", "麻袋", 5, 2),
    ("B", "帆布袋", 5, 3),
    ("C", "金屬吊牌", 10, 4),
    ("D", "資料夾或徽章", None, 5),
)

# 未知總人數時，有限獎品採階段釋放；reserve_released 由管理員在活動尾聲開啟。
RELEASE_SCHEDULE = (
    (0, {"A": 0, "B": 1, "C": 2}),
    (50, {"A": 1, "B": 3, "C": 5}),
    (100, {"A": 2, "B": 6, "C": 8}),
    (150, {"A": 3, "B": 8, "C": 9}),
)
RESERVED_FINITE_BY_TIER = {"A": 1, "B": 2, "C": 1}


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
    event.prizes = [
        RafflePrize(
            tier=tier,
            name=name,
            total_quantity=quantity,
            remaining_quantity=quantity,
            sort_order=sort_order,
        )
        for tier, name, quantity, sort_order in DEFAULT_PRIZES
    ]
    db.add(event)
    await db.flush()
    return event


async def update_event(
    db: AsyncSession,
    event_id: uuid.UUID,
    status: RaffleStatus,
    reserve_released: bool | None,
) -> RaffleEvent:
    event = await db.get(RaffleEvent, event_id)
    if event is None:
        raise ValueError("找不到抽獎活動")
    event.status = status
    if reserve_released is not None:
        event.reserve_released = reserve_released
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


def _tier_totals(event: RaffleEvent) -> dict[str, int]:
    return {
        tier: sum(prize.total_quantity or 0 for prize in event.prizes if prize.tier == tier)
        for tier in ("A", "B", "C")
    }


def _tier_claimed(event: RaffleEvent) -> dict[str, int]:
    return {
        tier: max(
            0,
            _tier_totals(event)[tier]
            - sum(prize.remaining_quantity or 0 for prize in event.prizes if prize.tier == tier),
        )
        for tier in ("A", "B", "C")
    }


def _released_limits(event: RaffleEvent) -> dict[str, int]:
    totals = _tier_totals(event)
    if event.reserve_released:
        return totals

    stage_limits = RELEASE_SCHEDULE[0][1]
    for minimum_draws, limits in RELEASE_SCHEDULE:
        if event.draw_count >= minimum_draws:
            stage_limits = limits

    return {
        tier: min(
            total,
            max(0, total - RESERVED_FINITE_BY_TIER.get(tier, 0)),
            stage_limits.get(tier, 0),
        )
        for tier, total in totals.items()
    }


def _released_finite_prizes(event: RaffleEvent) -> list[RafflePrize]:
    claimed = _tier_claimed(event)
    limits = _released_limits(event)
    return [
        prize
        for prize in _finite_prizes(event)
        if claimed.get(prize.tier, 0) < limits.get(prize.tier, 0)
    ]


def _weighted_choice(prizes: list[RafflePrize], final_mode: bool = False) -> RafflePrize:
    # 前段讓 C/B 比較容易出現；尾聲釋放保留獎後提高 A 賞權重。
    weights = {"A": 5, "B": 4, "C": 3} if final_mode else {"A": 1, "B": 3, "C": 7}
    total = sum(weights.get(prize.tier, 5) for prize in prizes)
    point = secrets.randbelow(total)
    for prize in prizes:
        point -= weights.get(prize.tier, 5)
        if point < 0:
            return prize
    return prizes[-1]


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

    finite = _released_finite_prizes(event)
    # 未知總人數時只抽已釋放的有限獎，A/B/C 的保留量不會因早期手氣被吃掉。
    should_give_finite = bool(finite)
    prize = (
        _weighted_choice(finite, event.reserve_released)
        if should_give_finite
        else next((item for item in event.prizes if item.tier == "D"), None)
    )
    if prize is None:
        prize = finite[0] if finite else None
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
