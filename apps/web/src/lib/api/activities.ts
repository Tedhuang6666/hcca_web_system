import type {
  Activity, ActivityClosingReportOut, ActivityConvener, ActivityCreate, ActivityLinkCreate, ActivityLinkOut, ActivityLinkSuggestion, ActivityMember, ActivityRole, ActivitySpawnCreate, ActivitySpawnOut, ActivityWorkspaceOut, DiscordActivityWorkspace,
} from "../types";
import { get, post, patch, put, del } from "./core";

// ── 活動 ──────────────────────────────────────────────────────────────────────

export const activitiesApi = {
  list: (params?: { org_id?: string; active_only?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.org_id) q.set("org_id", params.org_id);
    if (params?.active_only !== undefined) q.set("active_only", String(params.active_only));
    const qs = q.toString();
    return get<Activity[]>(`/activities${qs ? `?${qs}` : ""}`);
  },
  mine: (activeOnly = true) =>
    get<Activity[]>(`/activities/mine?active_only=${String(activeOnly)}`),
  get: (id: string) => get<Activity>(`/activities/${id}`),
  workspace: (id: string) => get<ActivityWorkspaceOut>(`/activities/${id}/workspace`),
  spawn: (id: string, body: ActivitySpawnCreate) =>
    post<ActivitySpawnOut>(`/activities/${id}/spawn`, body),
  links: (id: string) => get<ActivityLinkOut[]>(`/activities/${id}/links`),
  createLink: (id: string, body: ActivityLinkCreate) =>
    post<ActivityLinkOut>(`/activities/${id}/links`, body),
  linkResource: (id: string, body: ActivityLinkCreate) =>
    post<ActivityLinkOut>(`/activities/${id}/links`, body),
  deleteLink: (activityId: string, linkId: string) =>
    del<void>(`/activities/${activityId}/links/${linkId}`),
  linkSuggestions: (id: string, limit = 20) =>
    get<ActivityLinkSuggestion[]>(`/activities/${id}/link-suggestions?limit=${limit}`),
  acceptSuggestion: (id: string, suggestionId: string) =>
    post<ActivityLinkOut>(
      `/activities/${id}/link-suggestions/${encodeURIComponent(suggestionId)}/accept`,
      {},
    ),
  closingReport: (id: string) =>
    get<ActivityClosingReportOut>(`/activities/${id}/closing-report`),
  create: (body: ActivityCreate) => post<Activity>("/activities", body),
  update: (id: string, body: Partial<ActivityCreate> & { is_active?: boolean }) =>
    patch<Activity>(`/activities/${id}`, body),
  archive: (id: string) => post<Activity>(`/activities/${id}/archive`, {}),
  listConveners: (id: string) => get<ActivityConvener[]>(`/activities/${id}/conveners`),
  appointConvener: (id: string, body: { user_id: string; start_date: string; end_date?: string | null }) =>
    post<ActivityConvener>(`/activities/${id}/conveners`, body),
  updateConvener: (id: string, body: { start_date?: string; end_date?: string | null }) =>
    patch<ActivityConvener>(`/activities/conveners/${id}`, body),
  removeConvener: (id: string) => del<void>(`/activities/conveners/${id}`),
  discordWorkspace: (id: string) =>
    get<DiscordActivityWorkspace | null>(`/activities/${id}/discord-workspace`),
  saveDiscordWorkspace: (
    id: string,
    body: Omit<
      DiscordActivityWorkspace,
      "id" | "activity_id" | "sync_status" | "last_error" | "last_synced_at" | "created_at" | "updated_at"
    >,
  ) => put<DiscordActivityWorkspace>(`/activities/${id}/discord-workspace`, body),
  syncDiscordWorkspace: (id: string) =>
    post<DiscordActivityWorkspace>(`/activities/${id}/discord-workspace/sync`, {}),
  listRoles: (id: string) => get<ActivityRole[]>(`/activities/${id}/roles`),
  createRole: (
    id: string,
    body: { key: string; name: string; description?: string | null; create_private_channel: boolean },
  ) => post<ActivityRole>(`/activities/${id}/roles`, body),
  updateRole: (activityId: string, roleId: string, body: Partial<ActivityRole>) =>
    patch<ActivityRole>(`/activities/${activityId}/roles/${roleId}`, body),
  listMembers: (id: string) => get<ActivityMember[]>(`/activities/${id}/members`),
  appointMember: (
    id: string,
    body: { role_id: string; user_id: string; start_date: string; end_date?: string | null },
  ) => post<ActivityMember>(`/activities/${id}/members`, body),
  removeMember: (activityId: string, memberId: string) =>
    del<void>(`/activities/${activityId}/members/${memberId}`),
};
