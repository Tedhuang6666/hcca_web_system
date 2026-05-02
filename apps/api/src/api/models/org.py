"""組織架構 ORM 模型 - Org / Position / Permission / UserPosition"""

from __future__ import annotations

import uuid
from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import Date, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin

if TYPE_CHECKING:
    from api.models.user import User


class Org(Base, TimestampMixin):
    """組織節點（支援 Adjacency List 樹狀結構）"""

    __tablename__ = "orgs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Adjacency List 自我關聯
    parent: Mapped[Org | None] = relationship(
        "Org", remote_side="Org.id", back_populates="children"
    )
    children: Mapped[list[Org]] = relationship("Org", back_populates="parent")
    positions: Mapped[list[Position]] = relationship("Position", back_populates="org")


class Position(Base, TimestampMixin):
    """職位定義（屬於某個組織）"""

    __tablename__ = "positions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    org: Mapped[Org] = relationship("Org", back_populates="positions")
    permissions: Mapped[list[Permission]] = relationship("Permission", back_populates="position")
    holders: Mapped[list[UserPosition]] = relationship("UserPosition", back_populates="position")


class Permission(Base):
    """職位的權限碼（如 document:approve, finance:view）"""

    __tablename__ = "permissions"
    __table_args__ = (UniqueConstraint("position_id", "code", name="uq_position_permission"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    position_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("positions.id", ondelete="CASCADE"), nullable=False
    )
    code: Mapped[str] = mapped_column(String(100), nullable=False, index=True)

    position: Mapped[Position] = relationship("Position", back_populates="permissions")


class UserPosition(Base, TimestampMixin):
    """使用者擔任職位的任期記錄"""

    __tablename__ = "user_positions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("positions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    user: Mapped[User] = relationship("User", back_populates="positions")  # type: ignore[name-defined]
    position: Mapped[Position] = relationship("Position", back_populates="holders")
