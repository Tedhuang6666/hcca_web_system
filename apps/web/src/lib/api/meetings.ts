import type {
  AgendaItemType, AttendanceRole, AttendanceSourceType, AttendanceStatus, BallotChoice, MeetingAgendaAttachmentOut, MeetingAgendaItemOut, MeetingArtifactLinkOut, MeetingArtifactType, MeetingAttendanceOut, MeetingAttendanceSourceOut, MeetingAttendanceSourcePreviewOut, MeetingBallotOut, MeetingBillStage, MeetingDecisionOut, MeetingDecisionStatus, MeetingEventOut, MeetingJoinOut, MeetingListItem, MeetingMinutesOut, MeetingMode, MeetingMotionOut, MeetingMotionStatus, MeetingMotionType, MeetingOut, MeetingRegulationBrief, MeetingRequestOut, MeetingRequestStatus, MeetingRequestType, MeetingScreenOut, MeetingScreenReadingMode, MeetingScreenStateOut, MeetingSpeechQueueItemOut, MeetingSpeechQueueStatus, MeetingVoteOption, MeetingVoteOut, MeetingVoteRecordMethod, MeetingWorkspaceOut, VoteThresholdType, VoteVisibility,
} from "../types";
import { BASE, get, post, patch, del, csrfHeaders, silentRefresh, errorMessageFromResponse, ApiError } from "./core";

// ── 議事系統 ──────────────────────────────────────────────────────────────────

export const meetingsApi = {
  workspace: () => get<MeetingWorkspaceOut>("/meetings/workspace"),
  list: (params?: { org_id?: string; status?: string; invited_only?: boolean; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.org_id) q.set("org_id", params.org_id);
    if (params?.status) q.set("status", params.status);
    if (params?.invited_only) q.set("invited_only", "true");
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    return get<MeetingListItem[]>(`/meetings${q.size ? `?${q}` : ""}`);
  },
  get: (id: string) => get<MeetingOut>(`/meetings/${id}`),
  join: (token: string) => get<MeetingJoinOut>(`/meetings/join/${encodeURIComponent(token)}`),
  create: (body: {
    title: string;
    org_id: string;
    mode?: MeetingMode;
    activity_id?: string | null;
    description?: string | null;
    location?: string | null;
    chair_name?: string | null;
    starts_at?: string | null;
    ends_at?: string | null;
    expected_voters?: number;
    quorum_count?: number;
    default_pass_threshold?: number;
    default_speech_seconds?: number;
    allow_observer_requests?: boolean;
    bill_stage?: MeetingBillStage | null;
  }) => post<MeetingOut>("/meetings", body),
  update: (id: string, body: Partial<{
    title: string;
    mode: MeetingMode;
    activity_id: string | null;
    description: string | null;
    location: string | null;
    chair_name: string | null;
    starts_at: string | null;
    ends_at: string | null;
    expected_voters: number;
    quorum_count: number;
    default_pass_threshold: number;
    default_speech_seconds: number;
    allow_observer_requests: boolean;
    bill_stage: MeetingBillStage | null;
    current_agenda_item_id: string | null;
    screen_focus_title: string | null;
    screen_focus_body: string | null;
  }>) => patch<MeetingOut>(`/meetings/${id}`, body),
  start: (id: string) => post<MeetingOut>(`/meetings/${id}/start`),
  openCheckIn: (id: string) => post<MeetingOut>(`/meetings/${id}/check-in/open`),
  pause: (id: string) => post<MeetingOut>(`/meetings/${id}/pause`),
  break: (id: string) => post<MeetingOut>(`/meetings/${id}/break`),
  close: (id: string) => post<MeetingOut>(`/meetings/${id}/close`),
  archive: (id: string) => post<MeetingOut>(`/meetings/${id}/archive`),
  addAgendaItem: (id: string, body: {
    title: string;
    description?: string | null;
    item_type?: AgendaItemType;
    order_index?: number;
    regulation_id?: string | null;
    document_id?: string | null;
    notes?: string | null;
    resolution?: string | null;
  }) => post<MeetingAgendaItemOut>(`/meetings/${id}/agenda-items`, body),
  updateAgendaItem: (id: string, itemId: string, body: Partial<{
    title: string;
    description: string | null;
    item_type: AgendaItemType;
    order_index: number;
    regulation_id: string | null;
    document_id: string | null;
    notes: string | null;
    resolution: string | null;
  }>) => patch<MeetingAgendaItemOut>(`/meetings/${id}/agenda-items/${itemId}`, body),
  reorderAgendaItems: (id: string, orderedIds: string[]) =>
    patch<MeetingAgendaItemOut[]>(`/meetings/${id}/agenda-items/reorder`, orderedIds),
  uploadAgendaAttachment: async (
    id: string,
    itemId: string,
    file: File,
  ): Promise<MeetingAgendaAttachmentOut> => {
    const fd = new FormData();
    fd.append("file", file);
    const doFetch = () =>
      fetch(`${BASE}/meetings/${id}/agenda-items/${itemId}/attachments`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders("POST"),
        body: fd,
      });
    let res = await doFetch();
    if (res.status === 401) {
      const ok = await silentRefresh();
      if (ok) res = await doFetch();
    }
    if (!res.ok) throw new ApiError(res.status, await errorMessageFromResponse(res));
    return res.json();
  },
  addAgendaAttachmentLink: (
    id: string,
    itemId: string,
    body: { url: string; display_text?: string | null },
  ) =>
    post<MeetingAgendaAttachmentOut>(
      `/meetings/${id}/agenda-items/${itemId}/attachments/link`,
      body,
    ),
  deleteAgendaAttachment: (id: string, itemId: string, attachmentId: string) =>
    del<void>(`/meetings/${id}/agenda-items/${itemId}/attachments/${attachmentId}`),
  agendaAttachmentDownloadUrl: (id: string, itemId: string, attachmentId: string) =>
    `${BASE}/meetings/${id}/agenda-items/${itemId}/attachments/${attachmentId}/download`,
  addArtifactLink: (id: string, itemId: string, body: {
    artifact_type: MeetingArtifactType;
    object_id?: string | null;
    title: string;
    url?: string | null;
    summary?: string | null;
  }) => post<MeetingArtifactLinkOut>(`/meetings/${id}/agenda-items/${itemId}/artifact-links`, body),
  updateArtifactLink: (id: string, itemId: string, linkId: string, body: Partial<{
    title: string;
    url: string | null;
    summary: string | null;
  }>) => patch<MeetingArtifactLinkOut>(
    `/meetings/${id}/agenda-items/${itemId}/artifact-links/${linkId}`,
    body,
  ),
  deleteArtifactLink: (id: string, itemId: string, linkId: string) =>
    del<void>(`/meetings/${id}/agenda-items/${itemId}/artifact-links/${linkId}`),
  deleteAgendaItem: (id: string, itemId: string) =>
    del<void>(`/meetings/${id}/agenda-items/${itemId}`),
  confirm: (
    id: string,
    body?: { notice_serial_template_id?: string | null; notice_serial_number?: string | null },
  ) => post<MeetingOut>(`/meetings/${id}/confirm`, body ?? {}),
  proposableRegulations: (id: string) =>
    get<MeetingRegulationBrief[]>(`/meetings/${id}/proposable-regulations`),
  syncProposals: (id: string) =>
    post<MeetingOut>(`/meetings/${id}/agenda-items/sync-proposals`),
  advanceAgendaRegulation: (id: string, itemId: string) =>
    post<MeetingAgendaItemOut>(`/meetings/${id}/agenda-items/${itemId}/advance-regulation`),
  checkIn: (id: string, token?: string) =>
    post<MeetingAttendanceOut>(
      `/meetings/${id}/check-in${token ? `?token=${encodeURIComponent(token)}` : ""}`,
    ),
  resolveAttendanceSource: (id: string, body: {
    source_type: AttendanceSourceType;
    source_id?: string | null;
    user_ids?: string[];
    role?: AttendanceRole;
    is_voting_eligible?: boolean;
  }) => post<MeetingAttendanceSourcePreviewOut>(`/meetings/${id}/attendance/sources/resolve`, body),
  importAttendanceSource: (id: string, body: {
    source_type: AttendanceSourceType;
    source_id?: string | null;
    user_ids?: string[];
    role?: AttendanceRole;
    is_voting_eligible?: boolean;
    label?: string | null;
  }) => post<MeetingAttendanceSourceOut>(`/meetings/${id}/attendance/sources`, body),
  upsertAttendance: (id: string, body: {
    user_id: string;
    role?: AttendanceRole;
    status?: AttendanceStatus;
    is_voting_eligible?: boolean;
    proxy_for_user_id?: string | null;
    note?: string | null;
  }) => post<MeetingAttendanceOut>(`/meetings/${id}/attendance`, body),
  updateAttendance: (id: string, attendanceId: string, body: Partial<{
    role: AttendanceRole;
    status: AttendanceStatus;
    is_voting_eligible: boolean;
    proxy_for_user_id: string | null;
    note: string | null;
  }>) => patch<MeetingAttendanceOut>(`/meetings/${id}/attendance/${attendanceId}`, body),
  createVote: (id: string, body: {
    title: string;
    description?: string | null;
    agenda_item_id?: string | null;
    visibility?: VoteVisibility;
    pass_threshold?: number;
    threshold_type?: VoteThresholdType;
    record_method?: MeetingVoteRecordMethod;
    options?: MeetingVoteOption[] | null;
  }) => post<MeetingVoteOut>(`/meetings/${id}/votes`, body),
  updateVote: (id: string, voteId: string, body: Partial<{
    title: string;
    description: string | null;
    visibility: VoteVisibility;
    pass_threshold: number;
    threshold_type: VoteThresholdType;
    record_method: MeetingVoteRecordMethod;
    options: MeetingVoteOption[] | null;
    result_note: string | null;
  }>) => patch<MeetingVoteOut>(`/meetings/${id}/votes/${voteId}`, body),
  createMotion: (id: string, body: {
    agenda_item_id?: string | null;
    proposer_id?: string | null;
    motion_type?: MeetingMotionType;
    title: string;
    content?: string | null;
    vote_id?: string | null;
  }) => post<MeetingMotionOut>(`/meetings/${id}/motions`, body),
  updateMotion: (id: string, motionId: string, body: Partial<{
    agenda_item_id: string | null;
    proposer_id: string | null;
    motion_type: MeetingMotionType;
    title: string;
    content: string | null;
    status: MeetingMotionStatus;
    vote_id: string | null;
  }>) => patch<MeetingMotionOut>(`/meetings/${id}/motions/${motionId}`, body),
  createDecision: (id: string, body: {
    agenda_item_id: string;
    motion_id?: string | null;
    vote_id?: string | null;
    title: string;
    content: string;
    status?: MeetingDecisionStatus;
    regulation_transition_to?: string | null;
    create_follow_up?: boolean;
    follow_up_assignee_id?: string | null;
    follow_up_due_at?: string | null;
    create_document_draft?: boolean;
  }) => post<MeetingDecisionOut>(`/meetings/${id}/decisions`, body),
  updateDecision: (id: string, decisionId: string, body: Partial<{
    motion_id: string | null;
    vote_id: string | null;
    title: string;
    content: string;
    status: MeetingDecisionStatus;
    regulation_transition_to: string | null;
  }>) => patch<MeetingDecisionOut>(`/meetings/${id}/decisions/${decisionId}`, body),
  openVote: (id: string, voteId: string) =>
    post<MeetingVoteOut>(`/meetings/${id}/votes/${voteId}/open`),
  closeVote: (id: string, voteId: string) =>
    post<MeetingVoteOut>(`/meetings/${id}/votes/${voteId}/close`),
  castBallot: (id: string, voteId: string, choice: BallotChoice) =>
    post<MeetingBallotOut>(`/meetings/${id}/votes/${voteId}/ballot`, { choice }),
  // ── 簡易評議模式 ──────────────────────────────────────────────────────────
  recorderBallot: (id: string, voteId: string, body: {
    voter_id: string;
    choice?: BallotChoice;
    option_key?: string | null;
  }) => post<MeetingBallotOut>(`/meetings/${id}/votes/${voteId}/recorder-ballot`, body),
  recordTally: (id: string, voteId: string, body: {
    manual_tally: Record<string, number>;
    result_label?: string | null;
  }) => post<MeetingVoteOut>(`/meetings/${id}/votes/${voteId}/tally`, body),
  acclamation: (id: string, agendaItemId: string, body?: {
    title?: string | null;
    result_label?: string;
  }) => post<MeetingVoteOut>(`/meetings/${id}/agenda-items/${agendaItemId}/acclamation`, body ?? {}),
  addRecusal: (id: string, agendaItemId: string, body: { user_id: string; note?: string | null }) =>
    post<MeetingAgendaItemOut>(`/meetings/${id}/agenda-items/${agendaItemId}/recusals`, body),
  removeRecusal: (id: string, agendaItemId: string, userId: string) =>
    del<MeetingAgendaItemOut>(`/meetings/${id}/agenda-items/${agendaItemId}/recusals/${userId}`),
  createRequest: (id: string, body: {
    request_type: MeetingRequestType;
    agenda_item_id?: string | null;
    content?: string | null;
  }) => post<MeetingRequestOut>(`/meetings/${id}/requests`, body),
  updateRequest: (id: string, requestId: string, status: MeetingRequestStatus) =>
    patch<MeetingRequestOut>(`/meetings/${id}/requests/${requestId}`, { status }),
  enqueueRequest: (id: string, requestId: string) =>
    post<MeetingSpeechQueueItemOut>(`/meetings/${id}/requests/${requestId}/enqueue`),
  createSpeechQueueItem: (id: string, body: {
    agenda_item_id?: string | null;
    user_id?: string | null;
    request_id?: string | null;
    speaker_name?: string | null;
    speaker_role?: string | null;
    duration_seconds?: number | null;
  }) => post<MeetingSpeechQueueItemOut>(`/meetings/${id}/speech-queue`, body),
  reorderSpeechQueue: (id: string, ordered_ids: string[]) =>
    patch<MeetingSpeechQueueItemOut[]>(`/meetings/${id}/speech-queue/reorder`, { ordered_ids }),
  updateSpeechQueueItem: (id: string, speechId: string, body: Partial<{
    agenda_item_id: string | null;
    speaker_name: string;
    speaker_role: string | null;
    status: MeetingSpeechQueueStatus;
    order_index: number;
    duration_seconds: number;
    remaining_seconds: number;
  }>) => patch<MeetingSpeechQueueItemOut>(`/meetings/${id}/speech-queue/${speechId}`, body),
  startSpeech: (id: string, speechId: string) =>
    post<MeetingSpeechQueueItemOut>(`/meetings/${id}/speech-queue/${speechId}/start`),
  pauseSpeech: (id: string, speechId: string) =>
    post<MeetingSpeechQueueItemOut>(`/meetings/${id}/speech-queue/${speechId}/pause`),
  resumeSpeech: (id: string, speechId: string) =>
    post<MeetingSpeechQueueItemOut>(`/meetings/${id}/speech-queue/${speechId}/resume`),
  finishSpeech: (id: string, speechId: string) =>
    post<MeetingSpeechQueueItemOut>(`/meetings/${id}/speech-queue/${speechId}/finish`),
  skipSpeech: (id: string, speechId: string) =>
    post<MeetingSpeechQueueItemOut>(`/meetings/${id}/speech-queue/${speechId}/skip`),
  extendSpeech: (id: string, speechId: string, seconds: number) =>
    post<MeetingSpeechQueueItemOut>(`/meetings/${id}/speech-queue/${speechId}/extend`, { seconds }),
  screen: (id: string) => get<MeetingScreenOut>(`/meetings/${id}/screen`),
  updateScreenState: (id: string, body: Partial<{
    agenda_item_id: string | null;
    reading_mode: MeetingScreenReadingMode;
    title: string | null;
    body: string | null;
    active_attachment_id: string | null;
    scroll_position: number;
    auto_scroll: boolean;
    scroll_speed: number;
    is_fullscreen: boolean;
  }>) => patch<MeetingScreenStateOut>(`/meetings/${id}/screen-state`, body),
  publicScreen: (token: string) =>
    get<MeetingScreenOut>(`/public/meetings/screen/${encodeURIComponent(token)}`),
  events: (id: string, limit = 200) =>
    get<MeetingEventOut[]>(`/meetings/${id}/events?limit=${limit}`),
  minutes: (id: string) => get<MeetingMinutesOut>(`/meetings/${id}/minutes`),
  createMinutesDocument: (id: string) =>
    post<{ document_id: string; title: string; status: string }>(
      `/meetings/${id}/minutes/document-draft`,
    ),
};
