"""人員主檔與身分歸屬總表。"""

from __future__ import annotations

import enum
import uuid
from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import Date, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin

if TYPE_CHECKING:
    from api.models.org import Org, Position, UserPosition
    from api.models.school_class import SchoolClass
    from api.models.user import User


class PersonStatus(enum.StrEnum):
    ACTIVE = "active"
    ALUMNI = "alumni"
    TRANSFERRED = "transferred"
    INACTIVE = "inactive"


class PersonAffiliationKind(enum.StrEnum):
    STUDENT = "student"
    CLASS_MEMBER = "class_member"
    CLASS_ROLE = "class_role"
    ORG_POSITION = "org_position"


class PersonAffiliationStatus(enum.StrEnum):
    ACTIVE = "active"
    ENDED = "ended"
    PENDING_USER = "pending_user"


class PersonAffiliationSource(enum.StrEnum):
    MANUAL = "manual"
    IMPORT = "import"
    CLASS_WORKSPACE = "class_workspace"
    RBAC_SYNC = "rbac_sync"


class Person(Base, TimestampMixin):
    """平台人員主檔；可先建立學生，再於日後連結 User 帳號。"""

    __tablename__ = "people"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_people_user_id"),
        UniqueConstraint("student_id", name="uq_people_student_id"),
        Index("ix_people_status", "status"),
        Index("ix_people_display_name", "display_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    student_id: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    legal_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=PersonStatus.ACTIVE,
        server_default=PersonStatus.ACTIVE,
        # 索引由上方 __table_args__ 的 Index("ix_people_status") 建立；
        # 此處不可再加 index=True，否則會產生同名重複索引，create_all 會 DuplicateTable。
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped[User | None] = relationship("User")
    affiliations: Mapped[list[PersonAffiliation]] = relationship(
        "PersonAffiliation", back_populates="person", cascade="all, delete-orphan"
    )


class PersonAffiliation(Base, TimestampMixin):
    """人員在班級、組織與職位上的單一身分/歸屬紀錄。"""

    __tablename__ = "person_affiliations"
    __table_args__ = (
        Index("ix_person_affiliations_person_status", "person_id", "status"),
        Index("ix_person_affiliations_kind_status", "kind", "status"),
        Index("ix_person_affiliations_class_kind", "class_id", "kind"),
        Index("ix_person_affiliations_org_kind", "org_id", "kind"),
        Index("ix_person_affiliations_position", "position_id"),
        Index("ix_person_affiliations_synced_up", "synced_user_position_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    person_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("people.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    academic_year: Mapped[int | None] = mapped_column(nullable=True, index=True)
    class_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_classes.id", ondelete="SET NULL"), nullable=True
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="SET NULL"), nullable=True
    )
    position_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("positions.id", ondelete="SET NULL"), nullable=True
    )
    role_key: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    title: Mapped[str | None] = mapped_column(String(100), nullable=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False, default=date.today)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=PersonAffiliationStatus.ACTIVE,
        server_default=PersonAffiliationStatus.ACTIVE,
        index=True,
    )
    source: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default=PersonAffiliationSource.MANUAL,
        server_default=PersonAffiliationSource.MANUAL,
    )
    synced_user_position_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("user_positions.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    person: Mapped[Person] = relationship("Person", back_populates="affiliations")
    school_class: Mapped[SchoolClass | None] = relationship("SchoolClass")
    org: Mapped[Org | None] = relationship("Org")
    position: Mapped[Position | None] = relationship("Position")
    synced_user_position: Mapped[UserPosition | None] = relationship("UserPosition")


__all__ = [
    "Person",
    "PersonAffiliation",
    "PersonAffiliationKind",
    "PersonAffiliationSource",
    "PersonAffiliationStatus",
    "PersonStatus",
]
