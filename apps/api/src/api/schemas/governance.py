"""事情導向治理中樞 schemas。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from api.models.governance import (
    AutomationRuleStatus,
    CaseStatus,
    DecisionStatus,
    MatterPriority,
    MatterResourceType,
    MatterStatus,
    MatterType,
    MatterVisibility,
    PlanningDocumentStatus,
)


class MatterCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=240)
    matter_type: MatterType = MatterType.PROJECT
    description: str | None = Field(None, max_length=10000)
    org_id: uuid.UUID | None = None
    owner_user_id: uuid.UUID | None = None
    starts_at: datetime | None = None
    due_at: datetime | None = None
    priority: MatterPriority = MatterPriority.NORMAL
    visibility: MatterVisibility = MatterVisibility.INTERNAL
    status: MatterStatus = MatterStatus.ACTIVE
    meta: dict = Field(default_factory=dict)


class MatterUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=240)
    matter_type: MatterType | None = None
    description: str | None = Field(None, max_length=10000)
    org_id: uuid.UUID | None = None
    owner_user_id: uuid.UUID | None = None
    starts_at: datetime | None = None
    due_at: datetime | None = None
    priority: MatterPriority | None = None
    visibility: MatterVisibility | None = None
    status: MatterStatus | None = None
    progress_percent: int | None = Field(None, ge=0, le=100)
    meta: dict | None = None


class ProgramCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(None, max_length=10000)
    owner_user_id: uuid.UUID | None = None
    starts_at: datetime | None = None
    due_at: datetime | None = None
    status: CaseStatus = CaseStatus.TODO
    sort_order: int = 0


class ProgramUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = Field(None, max_length=10000)
    owner_user_id: uuid.UUID | None = None
    starts_at: datetime | None = None
    due_at: datetime | None = None
    status: CaseStatus | None = None
    sort_order: int | None = None


class GovernanceCaseCreate(BaseModel):
    program_id: uuid.UUID | None = None
    title: str = Field(..., min_length=1, max_length=240)
    case_type: str = Field("general", min_length=1, max_length=50)
    description: str | None = Field(None, max_length=10000)
    owner_user_id: uuid.UUID | None = None
    status: CaseStatus = CaseStatus.TODO
    current_step: str | None = Field(None, max_length=100)
    due_at: datetime | None = None
    meta: dict = Field(default_factory=dict)


class GovernanceCaseUpdate(BaseModel):
    program_id: uuid.UUID | None = None
    title: str | None = Field(None, min_length=1, max_length=240)
    case_type: str | None = Field(None, min_length=1, max_length=50)
    description: str | None = Field(None, max_length=10000)
    owner_user_id: uuid.UUID | None = None
    status: CaseStatus | None = None
    current_step: str | None = Field(None, max_length=100)
    due_at: datetime | None = None
    meta: dict | None = None


class EntityRelationCreate(BaseModel):
    case_id: uuid.UUID | None = None
    source_type: str = Field("matter", min_length=1, max_length=50)
    source_id: uuid.UUID | None = None
    target_type: str = Field(..., min_length=1, max_length=50)
    target_id: uuid.UUID | None = None
    relation: str = Field("related", min_length=1, max_length=50)
    title: str = Field(..., min_length=1, max_length=240)
    href: str | None = Field(None, max_length=500)
    note: str | None = Field(None, max_length=5000)
    meta: dict = Field(default_factory=dict)


class TimelineEventCreate(BaseModel):
    case_id: uuid.UUID | None = None
    event_type: str = Field("comment", min_length=1, max_length=50)
    title: str = Field(..., min_length=1, max_length=240)
    body: str | None = Field(None, max_length=10000)
    payload: dict = Field(default_factory=dict)


class MatterResourceCreate(BaseModel):
    resource_type: MatterResourceType = MatterResourceType.EXTERNAL_URL
    title: str = Field(..., min_length=1, max_length=240)
    url: str = Field(..., min_length=1, max_length=2048)
    provider: str | None = Field(None, max_length=50)
    external_id: str | None = Field(None, max_length=255)
    description: str | None = Field(None, max_length=5000)
    meta: dict = Field(default_factory=dict)


class MatterResourceUpdate(BaseModel):
    resource_type: MatterResourceType | None = None
    title: str | None = Field(None, min_length=1, max_length=240)
    url: str | None = Field(None, min_length=1, max_length=2048)
    provider: str | None = Field(None, max_length=50)
    external_id: str | None = Field(None, max_length=255)
    description: str | None = Field(None, max_length=5000)
    meta: dict | None = None
    is_active: bool | None = None


class DecisionCreate(BaseModel):
    case_id: uuid.UUID | None = None
    source_type: str | None = Field(None, max_length=50)
    source_id: uuid.UUID | None = None
    title: str = Field(..., min_length=1, max_length=240)
    content: str = Field(..., min_length=1, max_length=20000)
    status: DecisionStatus = DecisionStatus.PENDING
    owner_user_id: uuid.UUID | None = None
    due_at: datetime | None = None
    meta: dict = Field(default_factory=dict)


class DecisionUpdate(BaseModel):
    case_id: uuid.UUID | None = None
    source_type: str | None = Field(None, max_length=50)
    source_id: uuid.UUID | None = None
    title: str | None = Field(None, min_length=1, max_length=240)
    content: str | None = Field(None, min_length=1, max_length=20000)
    status: DecisionStatus | None = None
    owner_user_id: uuid.UUID | None = None
    due_at: datetime | None = None
    meta: dict | None = None


class PlanningDocumentCreate(BaseModel):
    case_id: uuid.UUID | None = None
    title: str = Field(..., min_length=1, max_length=240)
    summary: str | None = Field(None, max_length=10000)
    status: PlanningDocumentStatus = PlanningDocumentStatus.DRAFT
    version_label: str = Field("草稿版", min_length=1, max_length=80)
    content: str = Field("", max_length=50000)
    change_reason: str | None = Field(None, max_length=5000)
    attachment_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)
    primary_attachment_id: uuid.UUID | None = None
    meta: dict = Field(default_factory=dict)


class PlanningDocumentUpdate(BaseModel):
    case_id: uuid.UUID | None = None
    title: str | None = Field(None, min_length=1, max_length=240)
    summary: str | None = Field(None, max_length=10000)
    status: PlanningDocumentStatus | None = None
    meta: dict | None = None


class PlanningDocumentRevisionCreate(BaseModel):
    version_label: str = Field(..., min_length=1, max_length=80)
    content: str = Field(..., min_length=1, max_length=50000)
    change_reason: str | None = Field(None, max_length=5000)
    attachment_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)
    primary_attachment_id: uuid.UUID | None = None


class MatterRoleAssignmentCreate(BaseModel):
    parent_id: uuid.UUID | None = None
    role_name: str = Field(..., min_length=1, max_length=120)
    unit_name: str | None = Field(None, max_length=120)
    user_id: uuid.UUID | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    note: str | None = Field(None, max_length=5000)
    sort_order: int = 0


class MatterRoleAssignmentUpdate(BaseModel):
    parent_id: uuid.UUID | None = None
    role_name: str | None = Field(None, min_length=1, max_length=120)
    unit_name: str | None = Field(None, max_length=120)
    user_id: uuid.UUID | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    note: str | None = Field(None, max_length=5000)
    sort_order: int | None = None
    is_active: bool | None = None


class GovernanceWorkflowTemplateCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    template_type: str = Field(..., min_length=1, max_length=50)
    description: str | None = Field(None, max_length=10000)
    version: int = Field(1, ge=1)
    steps: list[dict] = Field(default_factory=list)


class AutomationRuleCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    description: str | None = Field(None, max_length=10000)
    trigger_type: str = Field(..., min_length=1, max_length=80)
    conditions: dict = Field(default_factory=dict)
    actions: list[dict] = Field(default_factory=list)
    matter_id: uuid.UUID | None = None
    status: AutomationRuleStatus = AutomationRuleStatus.ACTIVE


class AutomationRuleUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=160)
    description: str | None = Field(None, max_length=10000)
    trigger_type: str | None = Field(None, min_length=1, max_length=80)
    conditions: dict | None = None
    actions: list[dict] | None = None
    matter_id: uuid.UUID | None = None
    status: AutomationRuleStatus | None = None


class ProgramOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    matter_id: uuid.UUID
    name: str
    description: str | None
    owner_user_id: uuid.UUID | None
    starts_at: datetime | None
    due_at: datetime | None
    status: str
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class GovernanceCaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    matter_id: uuid.UUID
    program_id: uuid.UUID | None
    title: str
    case_type: str
    description: str | None
    owner_user_id: uuid.UUID | None
    status: str
    current_step: str | None
    due_at: datetime | None
    completed_at: datetime | None
    meta: dict
    is_active: bool
    created_at: datetime
    updated_at: datetime


class EntityRelationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    matter_id: uuid.UUID | None
    case_id: uuid.UUID | None
    source_type: str
    source_id: uuid.UUID | None
    target_type: str
    target_id: uuid.UUID | None
    relation: str
    title: str
    href: str | None
    note: str | None
    meta: dict
    created_by_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class EntityRelationGraphOut(BaseModel):
    nodes: list[dict]
    edges: list[EntityRelationOut]


class TimelineEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    matter_id: uuid.UUID | None
    case_id: uuid.UUID | None
    event_type: str
    title: str
    body: str | None
    actor_id: uuid.UUID | None
    actor_email: str | None
    payload: dict
    created_at: datetime


class MatterResourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    matter_id: uuid.UUID
    resource_type: str
    title: str
    url: str
    provider: str | None
    external_id: str | None
    description: str | None
    meta: dict
    created_by_id: uuid.UUID | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class DecisionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    matter_id: uuid.UUID
    case_id: uuid.UUID | None
    source_type: str | None
    source_id: uuid.UUID | None
    title: str
    content: str
    status: str
    owner_user_id: uuid.UUID | None
    due_at: datetime | None
    completed_at: datetime | None
    meta: dict
    created_by_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class PlanningDocumentAttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    document_id: uuid.UUID
    filename: str
    display_name: str | None
    content_type: str
    file_size: int
    uploaded_by_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class PlanningDocumentRevisionAttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    attachment_id: uuid.UUID
    is_primary: bool
    sort_order: int
    attachment: PlanningDocumentAttachmentOut


class PlanningDocumentRevisionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    document_id: uuid.UUID
    version_number: int
    version_label: str
    content: str
    change_reason: str | None
    created_by_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    attachment_links: list[PlanningDocumentRevisionAttachmentOut] = []


class PlanningDocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    matter_id: uuid.UUID
    case_id: uuid.UUID | None
    title: str
    summary: str | None
    status: str
    current_version: int
    created_by_id: uuid.UUID | None
    approved_at: datetime | None
    meta: dict
    is_active: bool
    created_at: datetime
    updated_at: datetime
    revisions: list[PlanningDocumentRevisionOut] = []
    attachments: list[PlanningDocumentAttachmentOut] = []


class GovernanceModuleCapabilityOut(BaseModel):
    key: str
    label: str
    category: str
    icon: str
    href: str
    create_mode: str
    searchable: bool
    requires_org: bool = False
    permission_codes: list[str] = []


class GovernanceResourceSearchOut(BaseModel):
    id: uuid.UUID
    kind: str
    title: str
    summary: str = ""
    status: str | None = None
    href: str


class MatterRoleAssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    matter_id: uuid.UUID
    parent_id: uuid.UUID | None
    role_name: str
    unit_name: str | None
    user_id: uuid.UUID | None
    start_at: datetime | None
    end_at: datetime | None
    note: str | None
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class GovernanceDiscordEventRouteIn(BaseModel):
    event_type: str = Field(..., min_length=1, max_length=60)
    channel_kind: str = Field("discussion", pattern="^(discussion|announcement|staff|custom)$")
    channel_id: str | None = Field(None, max_length=32)
    create_thread: bool = False
    mention_role_id: str | None = Field(None, max_length=32)
    is_active: bool = True

    @model_validator(mode="after")
    def validate_custom_channel(self) -> GovernanceDiscordEventRouteIn:
        if self.channel_kind == "custom" and not self.channel_id:
            raise ValueError("指定既有頻道時必須選擇頻道")
        return self


class GovernanceDiscordEventRouteOut(GovernanceDiscordEventRouteIn):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class GovernanceDiscordWorkspaceIn(BaseModel):
    guild_id: str = Field(..., min_length=1, max_length=32)
    mode: str = Field("existing", pattern="^(existing|managed)$")
    category_id: str | None = Field(None, max_length=32)
    discussion_channel_id: str | None = Field(None, max_length=32)
    announcement_channel_id: str | None = Field(None, max_length=32)
    staff_channel_id: str | None = Field(None, max_length=32)
    mention_role_id: str | None = Field(None, max_length=32)
    auto_sync: bool = True
    is_active: bool = True

    @model_validator(mode="after")
    def validate_existing_workspace(self) -> GovernanceDiscordWorkspaceIn:
        if self.mode == "existing" and not self.discussion_channel_id:
            raise ValueError("綁定既有工作區時必須選擇討論頻道")
        return self


class GovernanceDiscordWorkspaceOut(GovernanceDiscordWorkspaceIn):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    matter_id: uuid.UUID
    sync_status: str
    last_error: str | None
    last_synced_at: datetime | None
    routes: list[GovernanceDiscordEventRouteOut] = []
    created_at: datetime
    updated_at: datetime


class GovernanceWorkflowTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    template_type: str
    description: str | None
    version: int
    steps: list
    created_by_id: uuid.UUID | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class AutomationRuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None
    trigger_type: str
    conditions: dict
    actions: list
    matter_id: uuid.UUID | None
    status: str
    last_triggered_at: datetime | None = None
    trigger_count: int = 0
    created_by_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class MatterSpawnIn(BaseModel):
    """從事情主動建立並連動模組artifact（指揮中心）。"""

    kind: str = Field(..., pattern="^(task|announcement|survey|meeting|document|regulation)$")
    title: str = Field(..., min_length=1, max_length=200)
    org_id: uuid.UUID | None = None


class MatterSpawnOut(BaseModel):
    kind: str
    id: uuid.UUID
    title: str
    href: str


class MatterLinkRefOut(BaseModel):
    """反向查詢結果：某模組資源被納入的事情摘要。"""

    relation_id: uuid.UUID
    matter_id: uuid.UUID
    matter_title: str
    matter_status: str
    matter_progress: int
    relation: str
    case_id: uuid.UUID | None = None


class MatterListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str | None = None
    title: str
    matter_type: str
    description: str | None
    org_id: uuid.UUID | None
    owner_user_id: uuid.UUID | None
    starts_at: datetime | None
    due_at: datetime | None
    priority: str
    visibility: str
    status: str
    progress_percent: int
    created_by_id: uuid.UUID | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    case_count: int = 0
    open_task_count: int = 0
    link_count: int = 0


class MatterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str | None = None
    title: str
    matter_type: str
    description: str | None
    org_id: uuid.UUID | None
    owner_user_id: uuid.UUID | None
    starts_at: datetime | None
    due_at: datetime | None
    priority: str
    visibility: str
    status: str
    progress_percent: int
    meta: dict
    created_by_id: uuid.UUID | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    programs: list[ProgramOut] = []
    cases: list[GovernanceCaseOut] = []
    links: list[EntityRelationOut] = []
    events: list[TimelineEventOut] = []
    resources: list[MatterResourceOut] = []
    decisions: list[DecisionOut] = []
    planning_documents: list[PlanningDocumentOut] = []
    role_assignments: list[MatterRoleAssignmentOut] = []
    discord_workspace: GovernanceDiscordWorkspaceOut | None = None


class GovernanceStatsOut(BaseModel):
    active_matters: int
    overdue_matters: int
    open_cases: int
    open_tasks: int
    my_tasks: int
    pending_decisions: int
    plans_in_review: int


class GovernanceDashboardOut(BaseModel):
    stats: GovernanceStatsOut
    matters: list[MatterListItem]
