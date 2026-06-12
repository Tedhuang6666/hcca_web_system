"""劃位系統服務層 - 場次/座位圖 CRUD、分批時段、保留鎖、自助選位、管理員代劃。

並發安全：
  - 保留鎖以 INSERT ... ON CONFLICT DO NOTHING（seat_id 唯一）原子取得。
  - 確認劃位於交易內 SELECT seat FOR UPDATE，並由 partial unique index
    (uq_seat_assignment_active_seat) 在 DB 層保證一座位最多一筆 active 劃位。
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.services._base import apply_updates
from api.models.seating import (
    Seat,
    SeatAssignment,
    SeatAssignmentStatus,
    SeatHold,
    SeatingWave,
    SeatingZone,
    SeatStatus,
)
from api.models.shop import Order, OrderItem, Product
from api.models.user import User
from api.schemas.seating import (
    AssignmentOut,
    HoldOut,
    SeatMapOut,
    SeatsReplace,
    SeatState,
    WavesReplace,
    ZoneCreate,
    ZoneListItem,
    ZoneUpdate,
)
from api.services import recipient as recipient_svc

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(UTC)


# ── 場次 CRUD ─────────────────────────────────────────────────────────────────


async def get_zone(
    session: AsyncSession, zone_id: uuid.UUID, *, with_children: bool = True
) -> SeatingZone | None:
    q = select(SeatingZone).where(SeatingZone.id == zone_id)
    if with_children:
        q = q.options(
            selectinload(SeatingZone.seats),
            selectinload(SeatingZone.waves),
        )
    return (await session.execute(q)).scalar_one_or_none()


async def list_zones_for_product(
    session: AsyncSession, product_id: uuid.UUID
) -> list[ZoneListItem]:
    zones = (
        (
            await session.execute(
                select(SeatingZone)
                .where(SeatingZone.product_id == product_id)
                .order_by(SeatingZone.sort_order, SeatingZone.created_at)
            )
        )
        .scalars()
        .all()
    )
    if not zones:
        return []
    zone_ids = [z.id for z in zones]

    seat_counts: dict[uuid.UUID, dict[str, int]] = {
        zid: {"total": 0, "avail": 0} for zid in zone_ids
    }
    rows = await session.execute(
        select(Seat.zone_id, Seat.status, func.count())
        .where(Seat.zone_id.in_(zone_ids))
        .group_by(Seat.zone_id, Seat.status)
    )
    for zid, st, cnt in rows:
        seat_counts[zid]["total"] += cnt
        if st == SeatStatus.AVAILABLE:
            seat_counts[zid]["avail"] += cnt

    assigned: dict[uuid.UUID, int] = dict.fromkeys(zone_ids, 0)
    arows = await session.execute(
        select(SeatAssignment.zone_id, func.count())
        .where(
            SeatAssignment.zone_id.in_(zone_ids),
            SeatAssignment.status == SeatAssignmentStatus.ACTIVE,
        )
        .group_by(SeatAssignment.zone_id)
    )
    for zid, cnt in arows:
        assigned[zid] = cnt

    return [
        ZoneListItem(
            id=z.id,
            product_id=z.product_id,
            name=z.name,
            starts_at=z.starts_at,
            seating_opens_at=z.seating_opens_at,
            sort_order=z.sort_order,
            seat_count=seat_counts[z.id]["total"],
            available_count=max(seat_counts[z.id]["avail"] - assigned[z.id], 0),
            assigned_count=assigned[z.id],
        )
        for z in zones
    ]


async def create_zone(session: AsyncSession, *, data: ZoneCreate) -> SeatingZone:
    product = await session.get(Product, data.product_id)
    if product is None:
        raise ValueError("找不到所屬商品")
    zone = SeatingZone(
        product_id=data.product_id,
        name=data.name,
        description=data.description,
        starts_at=data.starts_at,
        seating_opens_at=data.seating_opens_at,
        hold_minutes=data.hold_minutes,
        layout=data.layout or {},
        sort_order=data.sort_order,
    )
    session.add(zone)
    await session.flush()
    return await get_zone(session, zone.id)  # type: ignore[return-value]


async def update_zone(session: AsyncSession, zone: SeatingZone, *, data: ZoneUpdate) -> SeatingZone:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(zone, field, value)
    await session.flush()
    return zone


async def delete_zone(session: AsyncSession, zone: SeatingZone) -> None:
    active = await session.scalar(
        select(func.count())
        .select_from(SeatAssignment)
        .where(
            SeatAssignment.zone_id == zone.id,
            SeatAssignment.status == SeatAssignmentStatus.ACTIVE,
        )
    )
    if active:
        raise ValueError("此場次已有人劃位，無法刪除（請先釋放劃位）")
    await session.delete(zone)
    await session.flush()


# ── 座位圖批次儲存（編輯器）─────────────────────────────────────────────────────


async def replace_seats(
    session: AsyncSession, zone: SeatingZone, *, data: SeatsReplace
) -> SeatingZone:
    """以編輯器目前座位集合覆蓋座位圖：依 id upsert，未列出的座位刪除。"""
    if data.layout is not None:
        zone.layout = data.layout

    existing = {s.id: s for s in zone.seats}
    kept_ids: set[uuid.UUID] = set()
    seen_labels: set[str] = set()

    for item in data.seats:
        if item.label in seen_labels:
            raise ValueError(f"座位代號重複：{item.label}")
        seen_labels.add(item.label)

        if item.id and item.id in existing:
            seat = existing[item.id]
            seat.label = item.label
            seat.block = item.block
            seat.row_label = item.row_label
            seat.x = item.x
            seat.y = item.y
            seat.seat_type = item.seat_type
            seat.price_delta = item.price_delta
            seat.status = item.status
            kept_ids.add(seat.id)
        else:
            # 透過關聯集合新增，確保 zone.seats 在同一 session 內即時反映
            zone.seats.append(
                Seat(
                    label=item.label,
                    block=item.block,
                    row_label=item.row_label,
                    x=item.x,
                    y=item.y,
                    seat_type=item.seat_type,
                    price_delta=item.price_delta,
                    status=item.status,
                )
            )

    # 刪除未列出的座位（若已有 active 劃位則擋下）
    to_remove = [sid for sid in existing if sid not in kept_ids]
    if to_remove:
        active = await session.scalar(
            select(func.count())
            .select_from(SeatAssignment)
            .where(
                SeatAssignment.seat_id.in_(to_remove),
                SeatAssignment.status == SeatAssignmentStatus.ACTIVE,
            )
        )
        if active:
            raise ValueError("欲刪除的座位中有已劃位者，無法移除")
        await session.execute(delete(SeatHold).where(SeatHold.seat_id.in_(to_remove)))
        for sid in to_remove:
            zone.seats.remove(existing[sid])  # delete-orphan cascade 刪除

    await session.flush()
    return zone


async def replace_waves(
    session: AsyncSession, zone: SeatingZone, *, data: WavesReplace
) -> SeatingZone:
    existing = {w.id: w for w in zone.waves}
    kept: set[uuid.UUID] = set()
    for item in data.waves:
        if item.id and item.id in existing:
            wave = existing[item.id]
            wave.name = item.name
            wave.starts_at = item.starts_at
            wave.audience = item.audience or {}
            wave.sort_order = item.sort_order
            kept.add(wave.id)
        else:
            zone.waves.append(
                SeatingWave(
                    name=item.name,
                    starts_at=item.starts_at,
                    audience=item.audience or {},
                    sort_order=item.sort_order,
                )
            )
    for wid in [w for w in existing if w not in kept]:
        zone.waves.remove(existing[wid])  # delete-orphan cascade 刪除
    await session.flush()
    return zone


# ── 分批開放時段判定 ──────────────────────────────────────────────────────────


async def _user_in_audience(session: AsyncSession, audience: dict, user: User) -> bool:
    """空條件 = 所有人；否則以 targeting 規格解析後判斷 user 是否在內。"""
    if not audience:
        return True
    kwargs = recipient_svc.spec_to_resolve_kwargs(audience)
    if not any(
        [
            kwargs["include_all"],
            kwargs["include_school"],
            kwargs["user_ids"],
            kwargs["position_ids"],
            kwargs["org_ids"],
        ]
    ):
        return True
    users, _ = await recipient_svc.resolve_recipients(session, **kwargs)
    return any(u.id == user.id for u in users)


async def resolve_open_state(
    session: AsyncSession, zone: SeatingZone, user: User, *, now: datetime | None = None
) -> tuple[bool, datetime | None]:
    """回傳 (本人現在是否可劃位, 下一波對本人開放時間)。

    無任何 wave → 永遠開放。否則只有本人所屬且已到 starts_at 的 wave 開放。
    """
    now = now or _now()
    waves = sorted(zone.waves, key=lambda w: (w.sort_order, w.starts_at or datetime.min))
    if not waves:
        return True, None

    next_open: datetime | None = None
    in_any_wave = False
    for wave in waves:
        if not await _user_in_audience(session, wave.audience, user):
            continue
        in_any_wave = True
        if wave.starts_at is None or wave.starts_at <= now:
            return True, None
        if next_open is None or wave.starts_at < next_open:
            next_open = wave.starts_at
    # 不屬任何 wave → 不開放（劃位由 wave 對象界定）
    if not in_any_wave:
        return False, None
    return False, next_open


# ── 劃位額度（依購票數量）──────────────────────────────────────────────────────


def _quota_for_product(order: Order, product_id: uuid.UUID) -> int:
    return sum(it.quantity for it in order.items if it.product_id == product_id)


def _order_item_for_product(order: Order, product_id: uuid.UUID) -> OrderItem | None:
    return next((it for it in order.items if it.product_id == product_id), None)


async def _active_assignment_count(
    session: AsyncSession, order_id: uuid.UUID, product_id: uuid.UUID
) -> int:
    return (
        await session.scalar(
            select(func.count())
            .select_from(SeatAssignment)
            .join(Seat, Seat.id == SeatAssignment.seat_id)
            .join(SeatingZone, SeatingZone.id == Seat.zone_id)
            .where(
                SeatAssignment.order_id == order_id,
                SeatingZone.product_id == product_id,
                SeatAssignment.status == SeatAssignmentStatus.ACTIVE,
            )
        )
    ) or 0


# ── 使用者選位畫面 ────────────────────────────────────────────────────────────


async def get_seat_map(
    session: AsyncSession, zone: SeatingZone, user: User, *, order_id: uuid.UUID | None = None
) -> SeatMapOut:
    now = _now()
    # 清掉過期 hold，狀態才精準
    await session.execute(
        delete(SeatHold).where(SeatHold.zone_id == zone.id, SeatHold.expires_at < now)
    )
    await session.flush()

    holds = (
        (await session.execute(select(SeatHold).where(SeatHold.zone_id == zone.id))).scalars().all()
    )
    hold_by_seat = {h.seat_id: h for h in holds}
    my_hold_expires = next((h.expires_at for h in holds if h.user_id == user.id), None)

    taken = set(
        (
            await session.execute(
                select(SeatAssignment.seat_id).where(
                    SeatAssignment.zone_id == zone.id,
                    SeatAssignment.status == SeatAssignmentStatus.ACTIVE,
                )
            )
        )
        .scalars()
        .all()
    )

    seats_out: list[SeatState] = []
    for seat in sorted(zone.seats, key=lambda s: (s.row_label or "", s.label)):
        if seat.status == SeatStatus.DISABLED:
            state = "disabled"
        elif seat.status == SeatStatus.BLOCKED:
            state = "blocked"
        elif seat.id in taken:
            state = "taken"
        elif seat.id in hold_by_seat:
            state = "mine" if hold_by_seat[seat.id].user_id == user.id else "held"
        else:
            state = "available"
        seats_out.append(
            SeatState(
                id=seat.id,
                label=seat.label,
                block=seat.block,
                row_label=seat.row_label,
                x=seat.x,
                y=seat.y,
                seat_type=seat.seat_type,
                price_delta=seat.price_delta,
                state=state,
            )
        )

    can_now, next_open = await resolve_open_state(session, zone, user, now=now)

    remaining = 0
    if order_id is not None:
        order = await _load_order(session, order_id)
        if order is not None and order.user_id == user.id:
            quota = _quota_for_product(order, zone.product_id)
            used = await _active_assignment_count(session, order_id, zone.product_id)
            remaining = max(quota - used, 0)

    return SeatMapOut(
        zone_id=zone.id,
        product_id=zone.product_id,
        name=zone.name,
        starts_at=zone.starts_at,
        layout=zone.layout or {},
        hold_minutes=zone.hold_minutes,
        seats=seats_out,
        remaining_quota=remaining,
        can_select_now=can_now,
        next_open_at=next_open,
        hold_expires_at=my_hold_expires,
    )


# ── 保留鎖 ────────────────────────────────────────────────────────────────────


async def hold_seats(
    session: AsyncSession, zone: SeatingZone, user: User, seat_ids: list[uuid.UUID]
) -> HoldOut:
    """以送出的 seat_ids 為準更新本人在此場次的保留鎖（原子取得，回報被搶走的）。"""
    now = _now()
    # 過期 hold 先清（含本人與他人）
    await session.execute(
        delete(SeatHold).where(SeatHold.zone_id == zone.id, SeatHold.expires_at < now)
    )
    # 移除本人在此場次的舊 hold（重新選位即覆蓋）
    await session.execute(
        delete(SeatHold).where(SeatHold.zone_id == zone.id, SeatHold.user_id == user.id)
    )
    await session.flush()

    valid_seat_ids = set(
        (
            await session.execute(
                select(Seat.id).where(
                    Seat.id.in_(seat_ids),
                    Seat.zone_id == zone.id,
                    Seat.status == SeatStatus.AVAILABLE,
                )
            )
        )
        .scalars()
        .all()
    )
    already_taken = set(
        (
            await session.execute(
                select(SeatAssignment.seat_id).where(
                    SeatAssignment.seat_id.in_(seat_ids),
                    SeatAssignment.status == SeatAssignmentStatus.ACTIVE,
                )
            )
        )
        .scalars()
        .all()
    )

    expires = now + timedelta(minutes=zone.hold_minutes)
    acquired: list[uuid.UUID] = []
    rejected: list[uuid.UUID] = []
    for sid in seat_ids:
        if sid not in valid_seat_ids or sid in already_taken:
            rejected.append(sid)
            continue
        stmt = (
            pg_insert(SeatHold)
            .values(
                id=uuid.uuid4(),
                seat_id=sid,
                zone_id=zone.id,
                user_id=user.id,
                expires_at=expires,
            )
            .on_conflict_do_nothing(index_elements=["seat_id"])
        )
        res = await session.execute(stmt)
        if res.rowcount == 1:
            acquired.append(sid)
        else:
            rejected.append(sid)
    await session.flush()
    return HoldOut(
        zone_id=zone.id,
        seat_ids=acquired,
        expires_at=expires if acquired else None,
        rejected_seat_ids=rejected,
    )


async def release_holds(session: AsyncSession, zone_id: uuid.UUID, user_id: uuid.UUID) -> None:
    await session.execute(
        delete(SeatHold).where(SeatHold.zone_id == zone_id, SeatHold.user_id == user_id)
    )
    await session.flush()


async def cleanup_expired_holds(session: AsyncSession) -> int:
    res = await session.execute(delete(SeatHold).where(SeatHold.expires_at < _now()))
    await session.flush()
    return res.rowcount or 0


# ── 確認劃位（自助 / 管理員代劃共用核心）─────────────────────────────────────────


async def _load_order(session: AsyncSession, order_id: uuid.UUID) -> Order | None:
    return (
        await session.execute(
            select(Order).options(selectinload(Order.items)).where(Order.id == order_id)
        )
    ).scalar_one_or_none()


async def _write_assignments(
    session: AsyncSession,
    *,
    order: Order,
    seat_ids: list[uuid.UUID],
    sitter_id: uuid.UUID,
    assigned_by_id: uuid.UUID | None,
    require_open_for: User | None,
) -> list[SeatAssignment]:
    now = _now()
    # 鎖座位列（依 id 排序避免死鎖）
    seats = (
        (
            await session.execute(
                select(Seat).where(Seat.id.in_(seat_ids)).order_by(Seat.id).with_for_update()
            )
        )
        .scalars()
        .all()
    )
    seat_map = {s.id: s for s in seats}
    if len(seat_map) != len(set(seat_ids)):
        raise ValueError("含不存在的座位")

    # 同一張劃位請求須屬同一場次與同一票種
    zone_ids = {s.zone_id for s in seats}
    if len(zone_ids) != 1:
        raise ValueError("一次只能在同一場次劃位")
    zone = await get_zone(session, next(iter(zone_ids)))
    if zone is None:
        raise ValueError("找不到場次")

    for s in seats:
        if s.status != SeatStatus.AVAILABLE:
            raise ValueError(f"座位 {s.label} 不可劃")

    # 已被他人 active 劃走？
    taken = set(
        (
            await session.execute(
                select(SeatAssignment.seat_id).where(
                    SeatAssignment.seat_id.in_(seat_ids),
                    SeatAssignment.status == SeatAssignmentStatus.ACTIVE,
                )
            )
        )
        .scalars()
        .all()
    )
    if taken:
        labels = ", ".join(seat_map[sid].label for sid in taken)
        raise ValueError(f"座位已被劃走：{labels}")

    # 分批開放時段（僅自助選位檢查；管理員代劃不受限）
    if require_open_for is not None:
        can_now, _ = await resolve_open_state(session, zone, require_open_for, now=now)
        if not can_now:
            raise ValueError("尚未輪到您劃位")
        # 自助須持有有效保留鎖
        held = set(
            (
                await session.execute(
                    select(SeatHold.seat_id).where(
                        SeatHold.seat_id.in_(seat_ids),
                        SeatHold.user_id == require_open_for.id,
                        SeatHold.expires_at >= now,
                    )
                )
            )
            .scalars()
            .all()
        )
        missing = [seat_map[sid].label for sid in seat_ids if sid not in held]
        if missing:
            raise ValueError(f"座位保留已逾時，請重新選位：{', '.join(missing)}")

    # 額度檢查（依購票數量）
    product_id = zone.product_id
    quota = _quota_for_product(order, product_id)
    used = await _active_assignment_count(session, order.id, product_id)
    if used + len(seat_ids) > quota:
        raise ValueError(f"超過可劃座位數（購票 {quota} 個，已劃 {used} 個）")

    order_item = _order_item_for_product(order, product_id)
    created: list[SeatAssignment] = []
    for sid in seat_ids:
        assignment = SeatAssignment(
            seat_id=sid,
            zone_id=zone.id,
            order_id=order.id,
            order_item_id=order_item.id if order_item else None,
            user_id=sitter_id,
            assigned_by_id=assigned_by_id,
            status=SeatAssignmentStatus.ACTIVE,
        )
        session.add(assignment)
        created.append(assignment)

    try:
        await session.flush()
    except IntegrityError as exc:  # partial unique index 撞擊 = 同時被搶
        raise ValueError("座位剛被他人劃走，請重新選位") from exc

    # 清掉這些座位的保留鎖
    await session.execute(delete(SeatHold).where(SeatHold.seat_id.in_(seat_ids)))
    await session.flush()
    logger.info(
        "劃位完成 order=%s zone=%s seats=%d by_admin=%s",
        order.serial_number,
        zone.id,
        len(seat_ids),
        bool(assigned_by_id),
    )
    return created


async def confirm_selection(
    session: AsyncSession, *, user: User, order_id: uuid.UUID, seat_ids: list[uuid.UUID]
) -> list[SeatAssignment]:
    """使用者自助確認劃位（at_purchase / scheduled）。"""
    order = await _load_order(session, order_id)
    if order is None:
        raise ValueError("找不到訂單")
    if order.user_id != user.id:
        raise PermissionError("只能為自己的訂單劃位")
    return await _write_assignments(
        session,
        order=order,
        seat_ids=seat_ids,
        sitter_id=user.id,
        assigned_by_id=None,
        require_open_for=user,
    )


async def admin_assign(
    session: AsyncSession, *, admin: User, order_id: uuid.UUID, seat_ids: list[uuid.UUID]
) -> list[SeatAssignment]:
    """管理員代為劃位（admin_assign 模式，依到場順序確認繳費後）。"""
    order = await _load_order(session, order_id)
    if order is None:
        raise ValueError("找不到訂單")
    return await _write_assignments(
        session,
        order=order,
        seat_ids=seat_ids,
        sitter_id=order.user_id,
        assigned_by_id=admin.id,
        require_open_for=None,
    )


async def release_assignment(session: AsyncSession, assignment_id: uuid.UUID) -> None:
    assignment = await session.get(SeatAssignment, assignment_id)
    if assignment is None:
        raise ValueError("找不到劃位紀錄")
    assignment.status = SeatAssignmentStatus.RELEASED
    await session.flush()


# ── 查詢 / 序列化 ─────────────────────────────────────────────────────────────


async def list_assignments(
    session: AsyncSession,
    *,
    order_id: uuid.UUID | None = None,
    zone_id: uuid.UUID | None = None,
    status: SeatAssignmentStatus | None = SeatAssignmentStatus.ACTIVE,
) -> list[SeatAssignment]:
    q = select(SeatAssignment).options(
        selectinload(SeatAssignment.seat),
        selectinload(SeatAssignment.zone),
        selectinload(SeatAssignment.user),
    )
    if order_id:
        q = q.where(SeatAssignment.order_id == order_id)
    if zone_id:
        q = q.where(SeatAssignment.zone_id == zone_id)
    if status:
        q = q.where(SeatAssignment.status == status)
    q = q.order_by(SeatAssignment.created_at)
    return list((await session.execute(q)).scalars().all())


def serialize_assignment(a: SeatAssignment) -> AssignmentOut:
    return AssignmentOut(
        id=a.id,
        seat_id=a.seat_id,
        seat_label=a.seat.label if a.seat else None,
        zone_id=a.zone_id,
        zone_name=a.zone.name if a.zone else None,
        order_id=a.order_id,
        order_item_id=a.order_item_id,
        user_id=a.user_id,
        user_name=a.user.display_name if a.user else None,
        assigned_by_id=a.assigned_by_id,
        status=a.status,
        created_at=a.created_at,
    )
