"""跨模組案件工作流模型。"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONDict

if TYPE_CHECKING:
    from api.models.activity import Activity
    from api.models.org import Org
    from api.models.user import User


class WorkflowSourceType(enum.StrEnum):
    COUNCIL_PROPOSAL = "council_proposal"
    JUDICIAL_PETITION = "judicial_petition"
    ACTIVITY = "activity"
    MEETING = "meeting"


class WorkflowEventType(enum.StrEnum):
    CREATED = "created"
    TRANSITION = "transition"
    LINKED = "linked"
    UNLINKED = "unlinked"
    SCHEDULED = "scheduled"
    DECISION = "decision"
    PUBLISHED = "published"


class WorkflowInstance(Base, TimestampMixin):
    """任一治理案件或活動的統一流程主檔。"""

    __tablename__ = "workflow_instances"
    __table_args__ = (
        UniqueConstraint("source_type", "source_id", name="uq_workflow_instances_source"),
        Index("ix_workflow_instances_type_status", "workflow_type", "status"),
        Index("ix_workflow_instances_source", "source_type", "source_id"),
        Index("ix_workflow_instances_activity", "activity_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workflow_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    source_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    source_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    current_step: Mapped[str | None] = mapped_column(String(80), nullable=True)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    activity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("activities.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )
    meta: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict, server_default="{}")

    org: Mapped[Org | None] = relationship("Org")
    activity: Mapped[Activity | None] = relationship("Activity")
    created_by: Mapped[User | None] = relationship("User")
    events: Mapped[list[WorkflowEvent]] = relationship(
        "WorkflowEvent",
        back_populates="instance",
        cascade="all, delete-orphan",
        order_by="WorkflowEvent.created_at",
    )
    links: Mapped[list[WorkflowLink]] = relationship(
        "WorkflowLink", back_populates="instance", cascade="all, delete-orphan"
    )


class WorkflowEvent(Base):
    """工作流時間軸事件。"""

    __tablename__ = "workflow_events"
    __table_args__ = (
        Index("ix_workflow_events_instance_created", "instance_id", "created_at"),
        Index("ix_workflow_events_instance_type", "instance_id", "event_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    instance_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("workflow_instances.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    from_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    actor_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload: Mapped[dict] = mapped_column(
        JSONDict, nullable=False, default=dict, server_default="{}"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    instance: Mapped[WorkflowInstance] = relationship("WorkflowInstance", back_populates="events")
    actor: Mapped[User | None] = relationship("User")


class WorkflowLink(Base, TimestampMixin):
    """工作流與平台內外資源的關聯。"""

    __tablename__ = "workflow_links"
    __table_args__ = (
        UniqueConstraint(
            "instance_id", "target_type", "target_id", "relation", name="uq_workflow_link_target"
        ),
        Index("ix_workflow_links_instance_type", "instance_id", "target_type"),
        Index("ix_workflow_links_target", "target_type", "target_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    instance_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("workflow_instances.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    target_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    target_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    relation: Mapped[str] = mapped_column(String(50), nullable=False, default="related")
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    href: Mapped[str | None] = mapped_column(String(500), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    meta: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict, server_default="{}")
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    instance: Mapped[WorkflowInstance] = relationship("WorkflowInstance", back_populates="links")
    created_by: Mapped[User | None] = relationship("User")


__all__ = [
    "WorkflowEvent",
    "WorkflowEventType",
    "WorkflowInstance",
    "WorkflowLink",
    "WorkflowSourceType",
]
