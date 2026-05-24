"""班級系統 ORM 模型 - SchoolClass / ClassStudentRange / ClassCadre + 可重用結單 Mixin"""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin

if TYPE_CHECKING:
    from api.models.org import Position
    from api.models.user import User


# ── 班級 ──────────────────────────────────────────────────────────────────────


class SchoolClass(Base, TimestampMixin):
    """
    班級（以學年度區隔，逐年重設）。

    班級代碼為數字（如「115」＝ 1 年級 15 班）；同一學年度內 class_code 唯一。
    逐年重設＝新增下學年度班級並將舊學年度 is_active 設為 False（不做自動升級）。
    """

    __tablename__ = "school_classes"
    __table_args__ = (UniqueConstraint("academic_year", "class_code", name="uq_class_year_code"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 學年度（民國年，如 115）
    academic_year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    # 數字班級代碼（如「115」）
    class_code: Mapped[str] = mapped_column(String(20), nullable=False)
    # 年級（供報表分組，建立時填入）
    grade: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    # 顯示名稱（選填，如「115 高一 15 班」）
    label: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # 是否為當前學年度班級（僅 active 班級參與自動歸班）
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="SET NULL"), nullable=True, index=True
    )

    ranges: Mapped[list[ClassStudentRange]] = relationship(
        "ClassStudentRange", back_populates="school_class", cascade="all, delete-orphan"
    )
    manual_members: Mapped[list[ClassManualMember]] = relationship(
        "ClassManualMember", back_populates="school_class", cascade="all, delete-orphan"
    )
    cadres: Mapped[list[ClassCadre]] = relationship(
        "ClassCadre", back_populates="school_class", cascade="all, delete-orphan"
    )
    memberships: Mapped[list[ClassMembership]] = relationship(
        "ClassMembership", back_populates="school_class", cascade="all, delete-orphan"
    )
    role_bindings: Mapped[list[ClassRoleBinding]] = relationship(
        "ClassRoleBinding", back_populates="school_class", cascade="all, delete-orphan"
    )


class ClassMembershipSource(enum.StrEnum):
    RANGE = "range"
    MANUAL = "manual"
    TRANSFER = "transfer"
    IMPORT = "import"


class ClassMembershipStatus(enum.StrEnum):
    ACTIVE = "active"
    ENDED = "ended"


class ClassRoleKey(enum.StrEnum):
    CLASS_LEADER = "class_leader"
    CLASS_REPRESENTATIVE = "class_representative"
    VICE_LEADER = "vice_leader"
    DISCIPLINE = "discipline"
    LUNCH_MANAGER = "lunch_manager"
    TREASURER = "treasurer"
    GENERAL_AFFAIRS = "general_affairs"


class ClassMembership(Base, TimestampMixin):
    """年度班級名冊快照，支援轉班與歷史訂單歸戶。"""

    __tablename__ = "class_memberships"
    __table_args__ = (
        Index("ix_class_memberships_user_active", "user_id", "status"),
        Index("ix_class_memberships_class_status", "class_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_classes.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    academic_year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default=ClassMembershipSource.MANUAL)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=ClassMembershipStatus.ACTIVE)
    start_date: Mapped[date] = mapped_column(Date, nullable=False, default=date.today)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    school_class: Mapped[SchoolClass] = relationship("SchoolClass", back_populates="memberships")
    user: Mapped[User] = relationship("User")


class ClassRoleBinding(Base, TimestampMixin):
    """班級角色與 RBAC Position 的綁定。"""

    __tablename__ = "class_role_bindings"
    __table_args__ = (
        UniqueConstraint("class_id", "role_key", name="uq_class_role_binding"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_classes.id", ondelete="CASCADE"), index=True
    )
    role_key: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    position_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("positions.id", ondelete="CASCADE"), index=True
    )

    school_class: Mapped[SchoolClass] = relationship("SchoolClass", back_populates="role_bindings")
    position: Mapped[Position] = relationship("Position")


class ClassStudentRange(Base, TimestampMixin):
    """班級學號區間規則（預先設定：學號 X～Y 歸入某班）。一班可有多段。"""

    __tablename__ = "class_student_ranges"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("school_classes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    student_id_start: Mapped[str] = mapped_column(String(20), nullable=False)
    student_id_end: Mapped[str] = mapped_column(String(20), nullable=False)

    school_class: Mapped[SchoolClass] = relationship("SchoolClass", back_populates="ranges")


class ClassManualMember(Base, TimestampMixin):
    """班級手動成員（補足轉班、無學號或特殊帳號，不依賴學號區間）。"""

    __tablename__ = "class_manual_members"
    __table_args__ = (UniqueConstraint("class_id", "user_id", name="uq_class_manual_member"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("school_classes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    school_class: Mapped[SchoolClass] = relationship(
        "SchoolClass", back_populates="manual_members"
    )
    user: Mapped[User] = relationship("User")


class ClassCadre(Base, TimestampMixin):
    """班級幹部（負責結單與收費，可檢視本班訂購情形並標示繳費）。一班可多位。"""

    __tablename__ = "class_cadres"
    __table_args__ = (UniqueConstraint("class_id", "user_id", name="uq_class_cadre"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    class_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("school_classes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    school_class: Mapped[SchoolClass] = relationship("SchoolClass", back_populates="cadres")
    user: Mapped[User] = relationship("User")


# ── 可重用結單 / 繳費 Mixin ────────────────────────────────────────────────────


class ClassConsolidationMixin:
    """
    可重用的「班級結單 / 繳費」欄位 Mixin。

    本次套用於 shop.Order；學餐 meal.MealOrder 日後可直接 mixin 共用同一套欄位，
    讓兩系統共享「依班級歸戶、幹部標示繳費」的制度。
    """

    # 下單當時買家所屬班級的快照（班級刪除時設 NULL，不連帶刪訂單）
    class_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("school_classes.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    is_paid: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


__all__ = [
    "ClassCadre",
    "ClassConsolidationMixin",
    "ClassManualMember",
    "ClassMembership",
    "ClassMembershipSource",
    "ClassMembershipStatus",
    "ClassRoleBinding",
    "ClassRoleKey",
    "ClassStudentRange",
    "SchoolClass",
]
