"""事情導向治理中樞模型。"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONDict, JSONList

if TYPE_CHECKING:
    from api.models.org import Org
    from api.models.user import User


class MatterStatus(enum.StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    ARCHIVED = "archived"
    CANCELED = "canceled"


class MatterPriority(enum.StrEnum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


class MatterVisibility(enum.StrEnum):
    PRIVATE = "private"
    ORG = "org"
    INTERNAL = "internal"
    PUBLIC = "public"


class MatterType(enum.StrEnum):
    ACTIVITY = "activity"
    POLICY = "policy"
    REGULATION = "regulation"
    PETITION = "petition"
    MEETING = "meeting"
    ADMINISTRATION = "administration"
    PROJECT = "project"
    OTHER = "other"


class CaseStatus(enum.StrEnum):
    DRAFT = "draft"
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    REVIEW = "review"
    APPROVED = "approved"
    DONE = "done"
    ARCHIVED = "archived"
    CANCELED = "canceled"


class GovernanceEventType(enum.StrEnum):
    CREATED = "created"
    UPDATED = "updated"
    STATUS_CHANGED = "status_changed"
    LINKED = "linked"
    TASK_CREATED = "task_created"
    COMMENT = "comment"


class DecisionStatus(enum.StrEnum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    PARTIAL = "partial"
    COMPLETED = "completed"
    OVERDUE = "overdue"
    CANCELED = "canceled"


class PlanningDocumentStatus(enum.StrEnum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    IN_REVIEW = "in_review"
    REVISION_REQUESTED = "revision_requested"
    APPROVED = "approved"
    ARCHIVED = "archived"


class AutomationRuleStatus(enum.StrEnum):
    ACTIVE = "active"
    PAUSED = "paused"
    ARCHIVED = "archived"


class Matter(Base, TimestampMixin):
    """一件完整自治事務，是跨模組治理的最高層級。"""

    __tablename__ = "matters"
    __table_args__ = (
        Index("ix_matters_org_status", "org_id", "status"),
        Index("ix_matters_owner_status", "owner_user_id", "status"),
        Index("ix_matters_type_status", "matter_type", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(240), nullable=False, index=True)
    matter_type: Mapped[str] = mapped_column(
        # 不另建單欄索引：複合索引 ix_matters_type_status 的前導欄已涵蓋 matter_type 查詢，
        # 多掛 index=True 只會造成冗餘索引＋alembic autogenerate 漂移（ix_matters_matter_type）。
        String(40),
        nullable=False,
        default=MatterType.PROJECT,
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="SET NULL"), nullable=True
    )
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    priority: Mapped[str] = mapped_column(
        String(20), nullable=False, default=MatterPriority.NORMAL, index=True
    )
    visibility: Mapped[str] = mapped_column(
        String(20), nullable=False, default=MatterVisibility.INTERNAL, index=True
    )
    status: Mapped[str] = mapped_column(
        String(30), nullable=False, default=MatterStatus.ACTIVE, index=True
    )
    progress_percent: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    meta: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict, server_default="{}")
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )

    org: Mapped[Org | None] = relationship("Org")
    owner: Mapped[User | None] = relationship("User", foreign_keys=[owner_user_id])
    created_by: Mapped[User | None] = relationship("User", foreign_keys=[created_by_id])
    programs: Mapped[list[Program]] = relationship(
        "Program", back_populates="matter", cascade="all, delete-orphan"
    )
    cases: Mapped[list[GovernanceCase]] = relationship(
        "GovernanceCase", back_populates="matter", cascade="all, delete-orphan"
    )
    links: Mapped[list[EntityRelation]] = relationship(
        "EntityRelation", back_populates="matter", cascade="all, delete-orphan"
    )
    events: Mapped[list[TimelineEvent]] = relationship(
        "TimelineEvent", back_populates="matter", cascade="all, delete-orphan"
    )
    decisions: Mapped[list[Decision]] = relationship(
        "Decision", back_populates="matter", cascade="all, delete-orphan"
    )
    planning_documents: Mapped[list[PlanningDocument]] = relationship(
        "PlanningDocument", back_populates="matter", cascade="all, delete-orphan"
    )
    role_assignments: Mapped[list[MatterRoleAssignment]] = relationship(
        "MatterRoleAssignment",
        back_populates="matter",
        cascade="all, delete-orphan",
        foreign_keys="MatterRoleAssignment.matter_id",
    )


class Program(Base, TimestampMixin):
    """大型事情底下的子專案。"""

    __tablename__ = "programs"
    __table_args__ = (
        Index("ix_programs_matter_status", "matter_id", "status"),
        UniqueConstraint("matter_id", "name", name="uq_programs_matter_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    matter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("matters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(
        String(30), nullable=False, default=CaseStatus.TODO, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )

    matter: Mapped[Matter] = relationship("Matter", back_populates="programs")
    owner: Mapped[User | None] = relationship("User")
    cases: Mapped[list[GovernanceCase]] = relationship("GovernanceCase", back_populates="program")


class GovernanceCase(Base, TimestampMixin):
    """事情或專案底下的行政處理單位。"""

    __tablename__ = "governance_cases"
    __table_args__ = (
        Index("ix_governance_cases_matter_status", "matter_id", "status"),
        Index("ix_governance_cases_program_status", "program_id", "status"),
        Index("ix_governance_cases_owner_status", "owner_user_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    matter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("matters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    program_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("programs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(240), nullable=False, index=True)
    case_type: Mapped[str] = mapped_column(String(50), nullable=False, default="general")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(
        String(30), nullable=False, default=CaseStatus.TODO, index=True
    )
    current_step: Mapped[str | None] = mapped_column(String(100), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    meta: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict, server_default="{}")
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )

    matter: Mapped[Matter] = relationship("Matter", back_populates="cases")
    program: Mapped[Program | None] = relationship("Program", back_populates="cases")
    owner: Mapped[User | None] = relationship("User")


class EntityRelation(Base, TimestampMixin):
    """Matter/Case 與平台各模組資源的通用關聯。"""

    __tablename__ = "entity_relations"
    __table_args__ = (
        UniqueConstraint(
            "matter_id",
            "case_id",
            "source_type",
            "source_id",
            "target_type",
            "target_id",
            "relation",
            name="uq_entity_relations_edge",
        ),
        Index("ix_entity_relations_matter", "matter_id", "target_type"),
        Index("ix_entity_relations_case", "case_id", "target_type"),
        Index("ix_entity_relations_target", "target_type", "target_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    matter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("matters.id", ondelete="CASCADE"), nullable=True, index=True
    )
    case_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("governance_cases.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    source_type: Mapped[str] = mapped_column(String(50), nullable=False)
    source_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    target_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    target_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    relation: Mapped[str] = mapped_column(String(50), nullable=False, default="related")
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    href: Mapped[str | None] = mapped_column(String(500), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    meta: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict, server_default="{}")
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    matter: Mapped[Matter | None] = relationship("Matter", back_populates="links")
    case: Mapped[GovernanceCase | None] = relationship("GovernanceCase")
    created_by: Mapped[User | None] = relationship("User")


class TimelineEvent(Base):
    """事情中心頁使用的行政時間軸。"""

    __tablename__ = "timeline_events"
    __table_args__ = (
        Index("ix_timeline_events_matter_created", "matter_id", "created_at"),
        Index("ix_timeline_events_case_created", "case_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    matter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("matters.id", ondelete="CASCADE"), nullable=True, index=True
    )
    case_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("governance_cases.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    actor_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    payload: Mapped[dict] = mapped_column(
        JSONDict, nullable=False, default=dict, server_default="{}"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    matter: Mapped[Matter | None] = relationship("Matter", back_populates="events")
    actor: Mapped[User | None] = relationship("User")


class Decision(Base, TimestampMixin):
    """會議或行政流程產生的決議與執行追蹤。"""

    __tablename__ = "decisions"
    __table_args__ = (
        Index("ix_decisions_matter_status", "matter_id", "status"),
        Index("ix_decisions_owner_status", "owner_user_id", "status"),
        Index("ix_decisions_source", "source_type", "source_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    matter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("matters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    case_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("governance_cases.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    source_type: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    source_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    title: Mapped[str] = mapped_column(String(240), nullable=False, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(30), nullable=False, default=DecisionStatus.PENDING, index=True
    )
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    meta: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict, server_default="{}")
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    matter: Mapped[Matter] = relationship("Matter", back_populates="decisions")
    case: Mapped[GovernanceCase | None] = relationship("GovernanceCase")
    owner: Mapped[User | None] = relationship("User", foreign_keys=[owner_user_id])
    created_by: Mapped[User | None] = relationship("User", foreign_keys=[created_by_id])


class PlanningDocument(Base, TimestampMixin):
    """企劃書主檔，版本內容存於 PlanningDocumentRevision。"""

    __tablename__ = "planning_documents"
    __table_args__ = (
        Index("ix_planning_documents_matter_status", "matter_id", "status"),
        Index("ix_planning_documents_case", "case_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    matter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("matters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    case_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("governance_cases.id", ondelete="SET NULL"),
        nullable=True,
    )
    title: Mapped[str] = mapped_column(String(240), nullable=False, index=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(30), nullable=False, default=PlanningDocumentStatus.DRAFT, index=True
    )
    current_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    meta: Mapped[dict] = mapped_column(JSONDict, nullable=False, default=dict, server_default="{}")
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )

    matter: Mapped[Matter] = relationship("Matter", back_populates="planning_documents")
    case: Mapped[GovernanceCase | None] = relationship("GovernanceCase")
    created_by: Mapped[User | None] = relationship("User")
    revisions: Mapped[list[PlanningDocumentRevision]] = relationship(
        "PlanningDocumentRevision",
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="PlanningDocumentRevision.version_number",
    )


class PlanningDocumentRevision(Base, TimestampMixin):
    """企劃書版本與修訂紀錄。"""

    __tablename__ = "planning_document_revisions"
    __table_args__ = (
        UniqueConstraint(
            "document_id", "version_number", name="uq_planning_document_revision_version"
        ),
        Index("ix_planning_document_revisions_document", "document_id", "version_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("planning_documents.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    version_label: Mapped[str] = mapped_column(String(80), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    change_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    document: Mapped[PlanningDocument] = relationship(
        "PlanningDocument", back_populates="revisions"
    )
    created_by: Mapped[User | None] = relationship("User")


class MatterRoleAssignment(Base, TimestampMixin):
    """Matter 內獨立於 RBAC 的組織職務與人員指派。"""

    __tablename__ = "matter_role_assignments"
    __table_args__ = (
        Index("ix_matter_role_assignments_matter", "matter_id", "parent_id"),
        Index("ix_matter_role_assignments_user", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    matter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("matters.id", ondelete="CASCADE"), nullable=False, index=True
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("matter_role_assignments.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    role_name: Mapped[str] = mapped_column(String(120), nullable=False)
    unit_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )

    matter: Mapped[Matter] = relationship(
        "Matter", back_populates="role_assignments", foreign_keys=[matter_id]
    )
    parent: Mapped[MatterRoleAssignment | None] = relationship(
        "MatterRoleAssignment", remote_side=[id]
    )
    user: Mapped[User | None] = relationship("User")


class GovernanceWorkflowTemplate(Base, TimestampMixin):
    """可套用於案件的流程模板。"""

    __tablename__ = "governance_workflow_templates"
    __table_args__ = (
        UniqueConstraint("name", "version", name="uq_governance_workflow_template_version"),
        Index("ix_governance_workflow_templates_type", "template_type", "is_active"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    template_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    steps: Mapped[list] = mapped_column(JSONList, nullable=False, default=list, server_default="[]")
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )

    created_by: Mapped[User | None] = relationship("User")


class AutomationRule(Base, TimestampMixin):
    """行政自動化規則：trigger + actions 的可稽核設定。"""

    __tablename__ = "automation_rules"
    __table_args__ = (
        Index("ix_automation_rules_trigger", "trigger_type", "status"),
        Index("ix_automation_rules_matter", "matter_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    trigger_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    conditions: Mapped[dict] = mapped_column(
        JSONDict, nullable=False, default=dict, server_default="{}"
    )
    actions: Mapped[list] = mapped_column(
        JSONList, nullable=False, default=list, server_default="[]"
    )
    matter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("matters.id", ondelete="CASCADE"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(
        String(30), nullable=False, default=AutomationRuleStatus.ACTIVE, index=True
    )
    last_triggered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    trigger_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    matter: Mapped[Matter | None] = relationship("Matter")
    created_by: Mapped[User | None] = relationship("User")


__all__ = [
    "CaseStatus",
    "AutomationRule",
    "AutomationRuleStatus",
    "Decision",
    "DecisionStatus",
    "EntityRelation",
    "GovernanceWorkflowTemplate",
    "GovernanceCase",
    "GovernanceEventType",
    "Matter",
    "MatterPriority",
    "MatterStatus",
    "MatterType",
    "MatterVisibility",
    "MatterRoleAssignment",
    "PlanningDocument",
    "PlanningDocumentRevision",
    "PlanningDocumentStatus",
    "Program",
    "TimelineEvent",
]
