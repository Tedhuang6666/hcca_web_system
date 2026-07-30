import type {
  SupportApproval,
  SupportAuditEntry,
  SupportDashboard,
  SupportGuide,
  SupportTicket,
  SupportUserDetail,
  SupportUserSummary,
} from "../types";
import { del, get, patch, post } from "./core";

const queryString = (params: Record<string, string | number | boolean | undefined>) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
};

export const supportApi = {
  dashboard: () => get<SupportDashboard>("/support/dashboard"),
  searchUsers: (keyword?: string) =>
    get<SupportUserSummary[]>(`/support/users${queryString({ keyword, limit: 100 })}`),
  getUser: (id: string, diagnose = false) =>
    get<SupportUserDetail>(`/support/users/${id}${queryString({ diagnose })}`),
  revealSensitive: (id: string, body: { ticket_id: string; reason: string }) =>
    post<{ user_id: string; email: string; linked_emails: string[]; student_id: string | null; reason: string }>(
      `/support/users/${id}/sensitive`,
      body,
    ),
  diagnose: (id: string, body: { ticket_id: string; reason: string }) =>
    post<SupportUserDetail["diagnostics"]>(`/support/users/${id}/diagnose`, body),
  updateProfile: (id: string, body: Record<string, unknown>) =>
    patch<SupportUserDetail>(`/support/users/${id}/profile`, body),
  updateContact: (id: string, body: { ticket_id: string; reason: string; email: string; confirm_change: boolean }) =>
    patch<SupportUserDetail>(`/support/users/${id}/contact`, body),
  repair: (id: string, action: string, body: { ticket_id: string; reason: string }) =>
    post<Record<string, unknown>>(`/support/users/${id}/actions/${action}`, body),
  listTickets: (params?: { status?: string; priority?: string; user_id?: string; keyword?: string }) =>
    get<SupportTicket[]>(`/support/tickets${queryString({ ...params, limit: 100 })}`),
  getTicket: (id: string) => get<SupportTicket>(`/support/tickets/${id}`),
  createTicket: (body: Record<string, unknown>) => post<SupportTicket>("/support/tickets", body),
  updateTicket: (id: string, body: Record<string, unknown>) => patch<SupportTicket>(`/support/tickets/${id}`, body),
  addTicketEvent: (id: string, body: { body: string; event_type: string }) => post<SupportTicket>(`/support/tickets/${id}/events`, body),
  listApprovals: (status?: string) => get<SupportApproval[]>(`/support/approvals${queryString({ status })}`),
  requestRoleApproval: (userId: string, body: Record<string, unknown>) => post<Record<string, unknown>>(`/support/users/${userId}/approvals`, body),
  reviewApproval: (id: string, body: { approved: boolean; note: string }) => post<Record<string, unknown>>(`/support/approvals/${id}/review`, body),
  startImpersonation: (body: { target_user_id: string; ticket_id: string; reason: string; mode: "read_only" | "interactive"; minutes: number }) =>
    post<{ token: string; session_id: string; expires_at: string; target_user_id: string; target_email: string; target_display_name: string; actor_email: string; actor_display_name: string; read_only: boolean }>("/support/impersonation/start", body),
  endImpersonation: (id: string, token: string, body: { ticket_id: string; reason: string }) =>
    post<void>(`/support/impersonation/${id}/end${queryString({ token })}`, body),
  createAssistance: (body: Record<string, unknown>) => post<Record<string, unknown>>("/support/assistance", body),
  getAssistance: (id: string) => get<Record<string, unknown>>(`/support/assistance/${id}`),
  closeAssistance: (id: string, body: { ticket_id: string; reason: string }) => post<void>(`/support/assistance/${id}/close`, body),
  listGuides: () => get<SupportGuide[]>("/support/guides"),
  createGuide: (body: Record<string, unknown>) => post<SupportGuide>("/support/guides", body),
  updateGuide: (id: string, body: Record<string, unknown>) => patch<SupportGuide>(`/support/guides/${id}`, body),
  listAudit: (params?: { actor_user_id?: string; target_user_id?: string; ticket_id?: string; action?: string; risk_level?: string }) =>
    get<SupportAuditEntry[]>(`/support/audit${queryString({ ...params, limit: 200 })}`),
};

export { del };
