"""議事系統 Pydantic Schemas"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field
from pydantic.networks import HttpUrl

from api.models.meeting import (
    AgendaItemType,
    ArtifactLinkType,
    AttendanceRole,
    AttendanceSourceType,
    AttendanceStatus,
    BallotChoice,
    MeetingBillStage,
    MeetingDecisionStatus,
    MeetingMode,
    MeetingMotionStatus,
    MeetingMotionType,
    MeetingRequestStatus,
    MeetingRequestType,
    MeetingStatus,
    ScreenReadingMode,
    SpeechQueueStatus,
    TimerStatus,
    VoteRecordMethod,
    VoteStatus,
    VoteThresholdType,
    VoteVisibility,
)
from api.models.regulation import (
    RegulationAmendmentType,
    RegulationCategory,
    RegulationWorkflowStatus,
)


class UserBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str
    email: str
    student_id: str | None = None


class RegulationBrief(BaseModel):
    """議程項目關聯法規（修正案）的精簡資訊。"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    category: RegulationCategory
    version: int
    workflow_status: RegulationWorkflowStatus
    amendment_type: RegulationAmendmentType
    source_regulation_id: uuid.UUID | None = None


class SchoolClassBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    class_code: str
    label: str | None = None
    grade: int | None = None


class MeetingCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    org_id: uuid.UUID
    mode: MeetingMode = MeetingMode.SIMPLE
    activity_id: uuid.UUID | None = None
    description: str | None = None
    location: str | None = Field(None, max_length=200)
    chair_name: str | None = Field(None, max_length=100)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    expected_voters: int = Field(0, ge=0)
    quorum_count: int = Field(0, ge=0)
    default_pass_threshold: int = Field(0, ge=0)
    default_speech_seconds: int = Field(180, ge=10, le=7200)
    allow_observer_requests: bool = False
    bill_stage: MeetingBillStage | None = None


class MeetingUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    mode: MeetingMode | None = None
    activity_id: uuid.UUID | None = None
    description: str | None = None
    location: str | None = Field(None, max_length=200)
    chair_name: str | None = Field(None, max_length=100)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    expected_voters: int | None = Field(None, ge=0)
    quorum_count: int | None = Field(None, ge=0)
    default_pass_threshold: int | None = Field(None, ge=0)
    default_speech_seconds: int | None = Field(None, ge=10, le=7200)
    allow_observer_requests: bool | None = None
    bill_stage: MeetingBillStage | None = None
    current_agenda_item_id: uuid.UUID | None = None
    screen_focus_title: str | None = Field(None, max_length=200)
    screen_focus_body: str | None = None


class MeetingConfirmCreate(BaseModel):
    notice_serial_template_id: uuid.UUID | None = None
    notice_serial_number: str | None = Field(None, min_length=1, max_length=30)


class AgendaItemCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    item_type: AgendaItemType = AgendaItemType.MANUAL
    order_index: int = Field(0, ge=0)
    regulation_id: uuid.UUID | None = None
    document_id: uuid.UUID | None = None
    council_proposal_id: uuid.UUID | None = None
    notes: str | None = None
    resolution: str | None = None


class AgendaItemUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    item_type: AgendaItemType | None = None
    order_index: int | None = Field(None, ge=0)
    regulation_id: uuid.UUID | None = None
    document_id: uuid.UUID | None = None
    council_proposal_id: uuid.UUID | None = None
    notes: str | None = None
    resolution: str | None = None


class AgendaAttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    agenda_item_id: uuid.UUID
    filename: str
    display_name: str | None
    content_type: str | None
    file_size: int | None
    url: str = ""
    link_url: str | None = None
    uploaded_by: uuid.UUID
    created_at: datetime


class AgendaAttachmentLinkCreate(BaseModel):
    url: HttpUrl
    display_text: str | None = Field(None, max_length=255)


class ArtifactLinkCreate(BaseModel):
    artifact_type: ArtifactLinkType
    object_id: uuid.UUID | None = None
    title: str = Field(..., min_length=1, max_length=200)
    url: HttpUrl | None = None
    summary: str | None = None


class ArtifactLinkUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    url: HttpUrl | None = None
    summary: str | None = None


class ArtifactLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    agenda_item_id: uuid.UUID
    artifact_type: ArtifactLinkType
    object_id: uuid.UUID | None
    title: str
    url: str | None
    summary: str | None
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class RecusalCreate(BaseModel):
    user_id: uuid.UUID
    note: str | None = Field(None, max_length=500)


class RecusalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    agenda_item_id: uuid.UUID
    user_id: uuid.UUID
    note: str | None
    created_by: uuid.UUID
    created_at: datetime
    user: UserBrief | None = None


class AgendaItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    meeting_id: uuid.UUID
    title: str
    description: str | None
    item_type: AgendaItemType
    order_index: int
    regulation_id: uuid.UUID | None
    document_id: uuid.UUID | None
    council_proposal_id: uuid.UUID | None
    notes: str | None
    resolution: str | None
    created_at: datetime
    updated_at: datetime
    regulation: RegulationBrief | None = None
    attachments: list[AgendaAttachmentOut] = []
    artifact_links: list[ArtifactLinkOut] = []
    recusals: list[RecusalOut] = []


class AttendanceCreate(BaseModel):
    user_id: uuid.UUID
    role: AttendanceRole = AttendanceRole.ATTENDEE
    status: AttendanceStatus = AttendanceStatus.PRESENT
    is_voting_eligible: bool = False
    proxy_for_user_id: uuid.UUID | None = None
    note: str | None = None


class AttendanceUpdate(BaseModel):
    role: AttendanceRole | None = None
    status: AttendanceStatus | None = None
    is_voting_eligible: bool | None = None
    proxy_for_user_id: uuid.UUID | None = None
    note: str | None = None


class AttendanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    meeting_id: uuid.UUID
    user_id: uuid.UUID
    role: AttendanceRole
    status: AttendanceStatus
    checked_in_at: datetime | None
    is_voting_eligible: bool
    voting_class_id: uuid.UUID | None = None
    proxy_for_user_id: uuid.UUID | None
    note: str | None
    created_at: datetime
    updated_at: datetime
    user: UserBrief | None = None
    voting_class: SchoolClassBrief | None = None
    proxy_for_user: UserBrief | None = None


class AttendanceSourceResolveRequest(BaseModel):
    source_type: AttendanceSourceType
    source_id: uuid.UUID | None = None
    user_ids: list[uuid.UUID] = []
    role: AttendanceRole = AttendanceRole.ATTENDEE
    is_voting_eligible: bool = False


class AttendanceSourceCreate(AttendanceSourceResolveRequest):
    label: str | None = Field(None, max_length=200)


class AttendanceSourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    meeting_id: uuid.UUID
    source_type: AttendanceSourceType
    source_id: uuid.UUID | None
    label: str
    role: AttendanceRole
    is_voting_eligible: bool
    imported_count: int
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class AttendanceSourcePreviewOut(BaseModel):
    source_type: AttendanceSourceType
    source_id: uuid.UUID | None
    label: str
    members: list[UserBrief]
    count: int


class VoteOption(BaseModel):
    key: str = Field(..., min_length=1, max_length=50)
    label: str = Field(..., min_length=1, max_length=100)


class VoteCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    agenda_item_id: uuid.UUID | None = None
    visibility: VoteVisibility = VoteVisibility.NAMED
    pass_threshold: int = Field(0, ge=0)
    threshold_type: VoteThresholdType = VoteThresholdType.SIMPLE_MAJORITY
    record_method: VoteRecordMethod = VoteRecordMethod.BALLOTS
    options: list[VoteOption] | None = None


class VoteUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    visibility: VoteVisibility | None = None
    pass_threshold: int | None = Field(None, ge=0)
    threshold_type: VoteThresholdType | None = None
    record_method: VoteRecordMethod | None = None
    options: list[VoteOption] | None = None
    result_note: str | None = None


class ManualTallyRequest(BaseModel):
    """主席口頭計票：直接寫入彙總票數並關閉表決。"""

    manual_tally: dict[str, int] = Field(
        ..., description="如 {'approve':5,'reject':3} 或自訂 {'a':5}"
    )
    result_label: str | None = Field(None, max_length=200)


class AcclamationRequest(BaseModel):
    """無異議通過：一鍵建立並關閉表決。"""

    title: str | None = Field(None, min_length=1, max_length=200)
    result_label: str = Field("無異議通過", min_length=1, max_length=200)


class RecorderBallotCreate(BaseModel):
    """紀錄代登逐人票。"""

    voter_id: uuid.UUID
    choice: BallotChoice = BallotChoice.APPROVE
    option_key: str | None = Field(None, max_length=50)


class BallotCreate(BaseModel):
    choice: BallotChoice


class MeetingRequestCreate(BaseModel):
    request_type: MeetingRequestType
    agenda_item_id: uuid.UUID | None = None
    content: str | None = Field(None, max_length=1000)


class MeetingRequestUpdate(BaseModel):
    status: MeetingRequestStatus


class MeetingRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    meeting_id: uuid.UUID
    user_id: uuid.UUID
    request_type: MeetingRequestType
    status: MeetingRequestStatus
    agenda_item_id: uuid.UUID | None
    content: str | None
    created_at: datetime
    updated_at: datetime
    user: UserBrief | None = None


class MotionCreate(BaseModel):
    agenda_item_id: uuid.UUID | None = None
    proposer_id: uuid.UUID | None = None
    motion_type: MeetingMotionType = MeetingMotionType.MAIN
    title: str = Field(..., min_length=1, max_length=200)
    content: str | None = None
    vote_id: uuid.UUID | None = None


class MotionUpdate(BaseModel):
    agenda_item_id: uuid.UUID | None = None
    proposer_id: uuid.UUID | None = None
    motion_type: MeetingMotionType | None = None
    title: str | None = Field(None, min_length=1, max_length=200)
    content: str | None = None
    status: MeetingMotionStatus | None = None
    vote_id: uuid.UUID | None = None


class MotionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    meeting_id: uuid.UUID
    agenda_item_id: uuid.UUID | None
    proposer_id: uuid.UUID | None
    motion_type: MeetingMotionType
    title: str
    content: str | None
    status: MeetingMotionStatus
    vote_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    proposer: UserBrief | None = None


class DecisionCreate(BaseModel):
    agenda_item_id: uuid.UUID
    motion_id: uuid.UUID | None = None
    vote_id: uuid.UUID | None = None
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1)
    status: MeetingDecisionStatus = MeetingDecisionStatus.DRAFT
    regulation_transition_to: str | None = Field(None, max_length=50)


class DecisionUpdate(BaseModel):
    motion_id: uuid.UUID | None = None
    vote_id: uuid.UUID | None = None
    title: str | None = Field(None, min_length=1, max_length=200)
    content: str | None = Field(None, min_length=1)
    status: MeetingDecisionStatus | None = None
    regulation_transition_to: str | None = Field(None, max_length=50)


class DecisionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    meeting_id: uuid.UUID
    agenda_item_id: uuid.UUID
    motion_id: uuid.UUID | None
    vote_id: uuid.UUID | None
    title: str
    content: str
    status: MeetingDecisionStatus
    regulation_transition_to: str | None
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class BallotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    vote_id: uuid.UUID
    voter_id: uuid.UUID
    choice: BallotChoice
    option_key: str | None = None
    cast_at: datetime
    voter: UserBrief | None = None


class VoteTallyOut(BaseModel):
    approve: int
    reject: int
    abstain: int
    total: int
    eligible: int
    pass_threshold: int
    threshold_type: VoteThresholdType = VoteThresholdType.SIMPLE_MAJORITY
    passed: bool
    # 自訂選項計數：{"a": 5, "b": 3}（無自訂選項時為空）
    option_counts: dict[str, int] = {}
    result_label: str | None = None


class VoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    meeting_id: uuid.UUID
    agenda_item_id: uuid.UUID | None
    title: str
    description: str | None
    visibility: VoteVisibility
    status: VoteStatus
    pass_threshold: int
    threshold_type: VoteThresholdType
    record_method: VoteRecordMethod
    options: list[VoteOption] | None = None
    manual_tally: dict[str, int] | None = None
    result_label: str | None = None
    opened_at: datetime | None
    closed_at: datetime | None
    result_note: str | None
    created_at: datetime
    updated_at: datetime
    tally: VoteTallyOut | None = None
    ballots: list[BallotOut] = []


class VoteRosterClassOut(BaseModel):
    class_id: uuid.UUID | None = None
    class_code: str
    label: str
    grade: int | None = None
    eligible: int
    present: int
    approve: int
    reject: int
    abstain: int
    not_voted: int
    status: str


class VoteRosterOut(BaseModel):
    classes: list[VoteRosterClassOut] = []
    unassigned: VoteRosterClassOut | None = None


class MeetingListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    activity_id: uuid.UUID | None = None
    title: str
    mode: MeetingMode
    location: str | None
    chair_name: str | None
    starts_at: datetime | None
    ends_at: datetime | None = None
    status: MeetingStatus
    expected_voters: int
    quorum_count: int
    default_pass_threshold: int
    default_speech_seconds: int
    allow_observer_requests: bool
    bill_stage: MeetingBillStage | None = None
    current_agenda_item_id: uuid.UUID | None
    screen_focus_title: str | None = None
    screen_focus_body: str | None = None
    confirmed_at: datetime | None = None
    notice_document_id: uuid.UUID | None = None
    created_at: datetime


class ScreenStateUpdate(BaseModel):
    agenda_item_id: uuid.UUID | None = None
    reading_mode: ScreenReadingMode | None = None
    title: str | None = Field(None, max_length=200)
    body: str | None = None
    active_attachment_id: uuid.UUID | None = None
    scroll_position: int | None = Field(None, ge=0)
    auto_scroll: bool | None = None
    scroll_speed: int | None = Field(None, ge=0, le=10)
    is_fullscreen: bool | None = None


class ScreenStateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    meeting_id: uuid.UUID
    agenda_item_id: uuid.UUID | None
    reading_mode: ScreenReadingMode
    title: str | None
    body: str | None
    active_attachment_id: uuid.UUID | None
    scroll_position: int
    auto_scroll: bool
    scroll_speed: int
    is_fullscreen: bool
    updated_by: uuid.UUID | None
    updated_at: datetime | None = None


class SpeechQueueCreate(BaseModel):
    agenda_item_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None
    request_id: uuid.UUID | None = None
    speaker_name: str | None = Field(None, min_length=1, max_length=100)
    speaker_role: str | None = Field(None, max_length=100)
    duration_seconds: int | None = Field(None, ge=10, le=7200)


class SpeechQueueUpdate(BaseModel):
    agenda_item_id: uuid.UUID | None = None
    speaker_name: str | None = Field(None, min_length=1, max_length=100)
    speaker_role: str | None = Field(None, max_length=100)
    status: SpeechQueueStatus | None = None
    order_index: int | None = Field(None, ge=0)
    duration_seconds: int | None = Field(None, ge=10, le=7200)
    remaining_seconds: int | None = Field(None, ge=0, le=7200)


class SpeechQueueReorder(BaseModel):
    ordered_ids: list[uuid.UUID]


class SpeechQueueExtend(BaseModel):
    seconds: int = Field(..., ge=1, le=7200)


class SpeechQueueItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    meeting_id: uuid.UUID
    agenda_item_id: uuid.UUID | None
    user_id: uuid.UUID | None
    request_id: uuid.UUID | None
    speaker_name: str
    speaker_role: str | None
    status: SpeechQueueStatus
    order_index: int
    duration_seconds: int
    remaining_seconds: int
    started_at: datetime | None
    paused_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    updated_at: datetime
    user: UserBrief | None = None


class TimerStateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    meeting_id: uuid.UUID
    active_speech_id: uuid.UUID | None
    status: TimerStatus
    server_started_at: datetime | None
    duration_seconds: int
    remaining_when_paused: int
    updated_at: datetime | None = None


class MeetingOut(MeetingListItem):
    description: str | None
    ends_at: datetime | None
    reminder_sent_at: datetime | None = None
    screen_token: str
    checkin_token: str
    agenda_items: list[AgendaItemOut] = []
    attendance_records: list[AttendanceOut] = []
    attendance_sources: list[AttendanceSourceOut] = []
    votes: list[VoteOut] = []
    requests: list[MeetingRequestOut] = []
    speech_queue: list[SpeechQueueItemOut] = []
    timer_state: TimerStateOut | None = None
    motions: list[MotionOut] = []
    decisions: list[DecisionOut] = []
    screen_state: ScreenStateOut | None = None
    events: list[MeetingEventOut] = []


class MeetingScreenOut(BaseModel):
    meeting: MeetingOut
    current_agenda_item: AgendaItemOut | None
    active_vote: VoteOut | None
    attendance_summary: dict[str, int]
    screen_state: ScreenStateOut | None = None
    vote_roster: VoteRosterOut | None = None
    active_speech: SpeechQueueItemOut | None = None
    speech_queue: list[SpeechQueueItemOut] = []
    timer_state: TimerStateOut | None = None


class MeetingJoinOut(BaseModel):
    meeting: MeetingOut
    current_agenda_item: AgendaItemOut | None
    attendance: AttendanceOut | None
    is_rostered: bool
    can_vote: bool
    active_vote: VoteOut | None
    my_ballot: BallotOut | None = None
    my_speech_queue_items: list[SpeechQueueItemOut] = []
    active_speech: SpeechQueueItemOut | None = None
    timer_state: TimerStateOut | None = None


class MeetingWorkspaceOut(BaseModel):
    today: list[MeetingListItem]
    drafts: list[MeetingListItem]
    active: list[MeetingListItem]
    closing_pending: list[MeetingListItem]


class MeetingMinutesOut(BaseModel):
    meeting: MeetingOut
    attendance_summary: dict[str, int]
    agenda_items: list[AgendaItemOut]
    votes: list[VoteOut]
    events: list[MeetingEventOut] = []
    markdown: str


class MeetingDocumentDraftOut(BaseModel):
    document_id: uuid.UUID
    title: str
    status: str


class MeetingEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    meeting_id: uuid.UUID
    agenda_item_id: uuid.UUID | None = None
    event_type: str
    actor_id: uuid.UUID | None = None
    payload: dict = {}
    created_at: datetime
