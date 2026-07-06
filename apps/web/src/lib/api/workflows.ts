import type {
  WorkflowInstanceOut, WorkflowLinkCreate, WorkflowLinkOut, WorkflowTimelineOut, WorkflowTransitionCreate,
} from "../types";
import { get, post } from "./core";

// ── 跨模組工作流 ──────────────────────────────────────────────────────────────

export const workflowsApi = {
  list: (params?: {
    workflow_type?: string;
    status?: string;
    activity_id?: string;
    limit?: number;
    offset?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.workflow_type) q.set("workflow_type", params.workflow_type);
    if (params?.status) q.set("status", params.status);
    if (params?.activity_id) q.set("activity_id", params.activity_id);
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    const qs = q.toString();
    return get<WorkflowInstanceOut[]>(`/workflows/instances${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => get<WorkflowInstanceOut>(`/workflows/instances/${id}`),
  transition: (id: string, body: WorkflowTransitionCreate) =>
    post<WorkflowInstanceOut>(`/workflows/instances/${id}/transition`, body),
  timeline: (id: string) =>
    get<WorkflowTimelineOut>(`/workflows/instances/${id}/timeline`),
  createLink: (id: string, body: WorkflowLinkCreate) =>
    post<WorkflowLinkOut>(`/workflows/instances/${id}/links`, body),
};
