"""組織架構 ORM 模型 - Org / Position / Permission / UserPosition"""

from __future__ import annotations

import enum
import uuid
from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin

if TYPE_CHECKING:
    from api.models.user import User


class PositionCategory(enum.StrEnum):
    """職位所屬功能區，用於區分自治組織、班級與系統用途。"""

    COUNCIL = "council"
    CLASS = "class"
    SYSTEM = "system"


class Org(Base, TimestampMixin):
    """組織節點（支援 Adjacency List 樹狀結構）"""

    __tablename__ = "orgs"
    __table_args__ = (Index("ix_orgs_parent_active", "parent_id", "is_active"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 字號前綴：用於組合字號模板的 org_prefix（如「嶺代」「嶺學」），選填
    prefix: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # 法案審議階段：標記此組織在議事流程的角色（值對應 MeetingBillStage：
    # standing_committee=常務委員會 / council=議會）。此組織所辦會議的議程會依此
    # 自動偵測待審法案；None 表一般組織。
    bill_stage: Mapped[str | None] = mapped_column(String(30), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )
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
    """職位定義（屬於某個組織，支援上下級階層）"""

    __tablename__ = "positions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=PositionCategory.COUNCIL,
        server_default=PositionCategory.COUNCIL,
        index=True,
    )
    # 權限係數：同組織內的相對權限大小，數字越大權限越高（用於自動派發審核）
    weight: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    # 職位階層：上級職位（同組織內，選填）
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("positions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    org: Mapped[Org] = relationship("Org", back_populates="positions")
    permissions: Mapped[list[Permission]] = relationship("Permission", back_populates="position")
    holders: Mapped[list[UserPosition]] = relationship("UserPosition", back_populates="position")
    parent: Mapped[Position | None] = relationship(
        "Position", remote_side="Position.id", back_populates="children"
    )
    children: Mapped[list[Position]] = relationship("Position", back_populates="parent")


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
    __table_args__ = (Index("ix_user_positions_user_end_date", "user_id", "end_date"),)

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
