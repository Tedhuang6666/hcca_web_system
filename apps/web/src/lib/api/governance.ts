import type {
  AutomationMeta, AutomationRuleCreate, AutomationRuleOut, AutomationRuleUpdate, DecisionCreate, DecisionOut, DecisionUpdate, EntityRelationCreate, EntityRelationGraphOut, EntityRelationOut, GovernanceCaseCreate, GovernanceCaseOut, GovernanceCaseUpdate, GovernanceDashboardOut, GovernanceDiscordEventRouteIn, GovernanceDiscordEventRouteOut, GovernanceDiscordWorkspaceIn, GovernanceDiscordWorkspaceOut, GovernanceModuleCapabilityOut, GovernanceResourceSearchOut, GovernanceWorkflowTemplateCreate, GovernanceWorkflowTemplateOut, MatterCreate, MatterLinkRef, MatterListItem, MatterOut, MatterResourceCreate, MatterResourceOut, MatterResourceUpdate, MatterRoleAssignmentCreate, MatterRoleAssignmentOut, MatterRoleAssignmentUpdate, MatterSpawnKind, MatterSpawnResult, MatterUpdate, PlanningDocumentAttachmentOut, PlanningDocumentCreate, PlanningDocumentOut, PlanningDocumentRevisionCreate, PlanningDocumentRevisionOut, PlanningDocumentUpdate, ProgramCreate, ProgramOut, ProgramUpdate, TimelineEventCreate, TimelineEventOut, WorkItemCreate, WorkItemOut,
} from "../types";
import { BASE, get, post, patch, put, del, csrfHeaders, silentRefresh, formatErrorDetail, ApiError } from "./core";

export const governanceApi = {
  dashboard: () => get<GovernanceDashboardOut>("/governance/dashboard"),
  listMatters: (params?: {
    status?: string;
    matter_type?: string;
    q?: string;
    limit?: number;
    offset?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.matter_type) q.set("matter_type", params.matter_type);
    if (params?.q) q.set("q", params.q);
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    const qs = q.toString();
    return get<MatterListItem[]>(`/governance/matters${qs ? `?${qs}` : ""}`);
  },
  createMatter: (body: MatterCreate) => post<MatterOut>("/governance/matters", body),
  getMatter: (id: string) => get<MatterOut>(`/governance/matters/${id}`),
  getMatterBySlug: (slug: string) => get<MatterOut>(`/governance/matters/by-slug/${encodeURIComponent(slug)}`),
  discordWorkspace: (id: string) =>
    get<GovernanceDiscordWorkspaceOut | null>(
      `/governance/matters/${id}/discord-workspace`,
    ),
  saveDiscordWorkspace: (id: string, body: GovernanceDiscordWorkspaceIn) =>
    put<GovernanceDiscordWorkspaceOut>(
      `/governance/matters/${id}/discord-workspace`,
      body,
    ),
  syncDiscordWorkspace: (id: string) =>
    post<GovernanceDiscordWorkspaceOut>(
      `/governance/matters/${id}/discord-workspace/sync`,
      {},
    ),
  discordRoutes: (id: string) =>
    get<GovernanceDiscordEventRouteOut[]>(
      `/governance/matters/${id}/discord-routes`,
    ),
  saveDiscordRoute: (id: string, body: GovernanceDiscordEventRouteIn) =>
    put<GovernanceDiscordEventRouteOut>(
      `/governance/matters/${id}/discord-routes`,
      body,
    ),
  updateMatter: (id: string, body: MatterUpdate) =>
    patch<MatterOut>(`/governance/matters/${id}`, body),
  createProgram: (matterId: string, body: ProgramCreate) =>
    post<ProgramOut>(`/governance/matters/${matterId}/programs`, body),
  updateProgram: (id: string, body: ProgramUpdate) =>
    patch<ProgramOut>(`/governance/programs/${id}`, body),
  createCase: (matterId: string, body: GovernanceCaseCreate) =>
    post<GovernanceCaseOut>(`/governance/matters/${matterId}/cases`, body),
  updateCase: (id: string, body: GovernanceCaseUpdate) =>
    patch<GovernanceCaseOut>(`/governance/cases/${id}`, body),
  createRelation: (matterId: string, body: EntityRelationCreate) =>
    post<EntityRelationOut>(`/governance/matters/${matterId}/relations`, body),
  listEntityRelations: (entityType: string, entityId: string) =>
    get<EntityRelationOut[]>(
      `/governance/entities/${encodeURIComponent(entityType)}/${entityId}/relations`,
    ),
  createEntityRelation: (
    entityType: string,
    entityId: string,
    body: EntityRelationCreate,
  ) =>
    post<EntityRelationOut>(
      `/governance/entities/${encodeURIComponent(entityType)}/${entityId}/relations`,
      body,
    ),
  entityGraph: (entityType: string, entityId: string, depth = 2) =>
    get<EntityRelationGraphOut>(
      `/governance/entities/${encodeURIComponent(entityType)}/${entityId}/graph?depth=${depth}`,
    ),
  deleteRelation: (relationId: string) => del<void>(`/governance/relations/${relationId}`),
  linksForTarget: (targetType: string, targetId: string) =>
    get<MatterLinkRef[]>(
      `/governance/links?target_type=${encodeURIComponent(targetType)}&target_id=${targetId}`,
    ),
  spawn: (matterId: string, body: { kind: MatterSpawnKind; title: string; org_id?: string | null }) =>
    post<MatterSpawnResult>(`/governance/matters/${matterId}/spawn`, body),
  createEvent: (matterId: string, body: TimelineEventCreate) =>
    post<TimelineEventOut>(`/governance/matters/${matterId}/events`, body),
  listTasks: (matterId: string, includeDone = true) =>
    get<WorkItemOut[]>(
      `/governance/matters/${matterId}/tasks?include_done=${String(includeDone)}`,
    ),
  createTask: (matterId: string, body: WorkItemCreate) =>
    post<WorkItemOut>(`/governance/matters/${matterId}/tasks`, body),
  createDecision: (matterId: string, body: DecisionCreate) =>
    post<DecisionOut>(`/governance/matters/${matterId}/decisions`, body),
  updateDecision: (id: string, body: DecisionUpdate) =>
    patch<DecisionOut>(`/governance/decisions/${id}`, body),
  createPlanningDocument: (matterId: string, body: PlanningDocumentCreate) =>
    post<PlanningDocumentOut>(`/governance/matters/${matterId}/planning-documents`, body),
  updatePlanningDocument: (id: string, body: PlanningDocumentUpdate) =>
    patch<PlanningDocumentOut>(`/governance/planning-documents/${id}`, body),
  createPlanningRevision: (id: string, body: PlanningDocumentRevisionCreate) =>
    post<PlanningDocumentRevisionOut>(`/governance/planning-documents/${id}/revisions`, body),
  moduleCapabilities: () =>
    get<GovernanceModuleCapabilityOut[]>("/governance/module-capabilities"),
  searchResources: (kind: string, q: string, limit = 20) =>
    get<GovernanceResourceSearchOut[]>(
      `/governance/resources/search?${new URLSearchParams({
        kind,
        q,
        limit: String(limit),
      }).toString()}`,
    ),
  createResource: (matterId: string, body: MatterResourceCreate) =>
    post<MatterResourceOut>(`/governance/matters/${matterId}/resources`, body),
  updateResource: (matterId: string, resourceId: string, body: MatterResourceUpdate) =>
    patch<MatterResourceOut>(`/governance/matters/${matterId}/resources/${resourceId}`, body),
  deleteResource: (matterId: string, resourceId: string) =>
    del<void>(`/governance/matters/${matterId}/resources/${resourceId}`),
  uploadPlanningAttachment: async (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const doFetch = () =>
      fetch(`${BASE}/governance/planning-documents/${id}/attachments`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders("POST"),
        body: form,
      });
    let response = await doFetch();
    if (response.status === 401 && await silentRefresh()) response = await doFetch();
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new ApiError(
        response.status,
        formatErrorDetail(payload?.detail, "附件上傳失敗"),
      );
    }
    return response.json() as Promise<PlanningDocumentAttachmentOut>;
  },
  renamePlanningAttachment: (documentId: string, attachmentId: string, displayName: string) =>
    patch<PlanningDocumentAttachmentOut>(
      `/governance/planning-documents/${documentId}/attachments/${attachmentId}`,
      { display_name: displayName },
    ),
  deletePlanningAttachment: (documentId: string, attachmentId: string) =>
    del<void>(`/governance/planning-documents/${documentId}/attachments/${attachmentId}`),
  planningAttachmentDownloadUrl: (documentId: string, attachmentId: string) =>
    `${BASE}/governance/planning-documents/${documentId}/attachments/${attachmentId}/download`,
  planningAttachmentPreviewUrl: (documentId: string, attachmentId: string) =>
    `${BASE}/governance/planning-documents/${documentId}/attachments/${attachmentId}/preview`,
  createRoleAssignment: (matterId: string, body: MatterRoleAssignmentCreate) =>
    post<MatterRoleAssignmentOut>(`/governance/matters/${matterId}/roles`, body),
  updateRoleAssignment: (id: string, body: MatterRoleAssignmentUpdate) =>
    patch<MatterRoleAssignmentOut>(`/governance/roles/${id}`, body),
  listWorkflowTemplates: () =>
    get<GovernanceWorkflowTemplateOut[]>("/governance/workflow-templates"),
  createWorkflowTemplate: (body: GovernanceWorkflowTemplateCreate) =>
    post<GovernanceWorkflowTemplateOut>("/governance/workflow-templates", body),
  listAutomationRules: (matterId?: string) =>
    get<AutomationRuleOut[]>(
      `/governance/automation-rules${matterId ? `?matter_id=${matterId}` : ""}`,
    ),
  createAutomationRule: (body: AutomationRuleCreate) =>
    post<AutomationRuleOut>("/governance/automation-rules", body),
  updateAutomationRule: (id: string, body: AutomationRuleUpdate) =>
    patch<AutomationRuleOut>(`/governance/automation-rules/${id}`, body),
  automationMeta: () => get<AutomationMeta>("/governance/automation-meta"),
};
