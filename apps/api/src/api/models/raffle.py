"""校園活動抽獎：活動、獎品庫存、平板 session 與抽獎紀錄。"""

from __future__ import annotations

import enum
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin

if TYPE_CHECKING:
    from api.models.user import User


class RaffleStatus(enum.StrEnum):
    DRAFT = "draft"
    OPEN = "open"
    PAUSED = "paused"
    CLOSED = "closed"


class RaffleEvent(Base, TimestampMixin):
    """抽獎活動主表；event row 會在抽獎時被鎖定，確保多平板序號一致。"""

    __tablename__ = "raffle_events"
    __table_args__ = (UniqueConstraint("event_code", name="uq_raffle_events_event_code"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_code: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    access_code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    access_code_hint: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[RaffleStatus] = mapped_column(
        String(16), nullable=False, default=RaffleStatus.DRAFT, index=True
    )
    draw_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reserve_released: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    created_by: Mapped[User | None] = relationship("User")
    prizes: Mapped[list[RafflePrize]] = relationship(
        "RafflePrize",
        back_populates="event",
        cascade="all, delete-orphan",
        order_by="RafflePrize.sort_order",
    )
    sessions: Mapped[list[RaffleSession]] = relationship(
        "RaffleSession", back_populates="event", cascade="all, delete-orphan"
    )
    draws: Mapped[list[RaffleDraw]] = relationship(
        "RaffleDraw", back_populates="event", cascade="all, delete-orphan"
    )


class RafflePrize(Base, TimestampMixin):
    """獎品庫存；unlimited 用 NULL quantity 表示。"""

    __tablename__ = "raffle_prizes"
    __table_args__ = (Index("ix_raffle_prizes_event_tier", "event_id", "tier"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("raffle_events.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tier: Mapped[str] = mapped_column(String(2), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    total_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    remaining_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    event: Mapped[RaffleEvent] = relationship("RaffleEvent", back_populates="prizes")
    draws: Mapped[list[RaffleDraw]] = relationship("RaffleDraw", back_populates="prize")


class RaffleSession(Base, TimestampMixin):
    """匿名參加者 session；只允許同一個 session 完成一次抽獎。"""

    __tablename__ = "raffle_sessions"
    __table_args__ = (UniqueConstraint("event_id", "token_hash", name="uq_raffle_sessions_token"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("raffle_events.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    device_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    has_drawn: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    event: Mapped[RaffleEvent] = relationship("RaffleEvent", back_populates="sessions")
    draw: Mapped[RaffleDraw | None] = relationship(
        "RaffleDraw", back_populates="session", uselist=False
    )


class RaffleDraw(Base, TimestampMixin):
    """不可變抽獎結果；冪等鍵讓行動網路重送不會重複扣庫存。"""

    __tablename__ = "raffle_draws"
    __table_args__ = (
        UniqueConstraint("event_id", "session_id", name="uq_raffle_draws_session"),
        UniqueConstraint("event_id", "idempotency_key", name="uq_raffle_draws_idempotency"),
        UniqueConstraint("event_id", "draw_number", name="uq_raffle_draws_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("raffle_events.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("raffle_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    prize_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("raffle_prizes.id", ondelete="RESTRICT"), nullable=False
    )
    draw_number: Mapped[int] = mapped_column(Integer, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(80), nullable=False)

    event: Mapped[RaffleEvent] = relationship("RaffleEvent", back_populates="draws")
    session: Mapped[RaffleSession] = relationship("RaffleSession", back_populates="draw")
    prize: Mapped[RafflePrize] = relationship("RafflePrize", back_populates="draws")


__all__ = ["RaffleDraw", "RaffleEvent", "RafflePrize", "RaffleSession", "RaffleStatus"]
