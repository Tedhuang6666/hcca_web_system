import type {
  CalendarChecklistCreate, CalendarChecklistOut, CalendarEventCreate, CalendarEventListItem, CalendarEventOut, CalendarEventType, CalendarLinkCreate, CalendarLinkOut, CalendarParticipantOut, CalendarParticipantResponse, CalendarParticipantRole, CalendarVisibility,
} from "../types";
import { get, post, patch, del } from "./core";

// ── 行事曆 ────────────────────────────────────────────────────────────────────

export const calendarApi = {
  list: (params?: {
    start?: string;
    end?: string;
    org_id?: string;
    type?: CalendarEventType;
    visibility?: CalendarVisibility;
    mine?: boolean;
  }) => {
    const q = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") q.set(key, String(value));
    });
    const qs = q.toString();
    return get<CalendarEventListItem[]>(`/calendar/events${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => get<CalendarEventOut>(`/calendar/events/${id}`),
  create: (body: CalendarEventCreate) => post<CalendarEventOut>("/calendar/events", body),
  update: (id: string, body: Partial<CalendarEventCreate>) =>
    patch<CalendarEventOut>(`/calendar/events/${id}`, body),
  delete: (id: string) => del<void>(`/calendar/events/${id}`),
  upsertParticipant: (
    id: string,
    body: {
      user_id: string;
      role?: CalendarParticipantRole;
      response?: CalendarParticipantResponse;
    },
  ) => post<CalendarParticipantOut>(`/calendar/events/${id}/participants`, body),
  updateParticipant: (
    id: string,
    participantId: string,
    body: Partial<{ role: CalendarParticipantRole; response: CalendarParticipantResponse }>,
  ) => patch<CalendarParticipantOut>(
    `/calendar/events/${id}/participants/${participantId}`,
    body,
  ),
  deleteParticipant: (id: string, participantId: string) =>
    del<void>(`/calendar/events/${id}/participants/${participantId}`),
  createChecklistItem: (id: string, body: CalendarChecklistCreate) =>
    post<CalendarChecklistOut>(`/calendar/events/${id}/checklist`, body),
  updateChecklistItem: (
    id: string,
    itemId: string,
    body: Partial<CalendarChecklistCreate & { is_done: boolean }>,
  ) => patch<CalendarChecklistOut>(`/calendar/events/${id}/checklist/${itemId}`, body),
  deleteChecklistItem: (id: string, itemId: string) =>
    del<void>(`/calendar/events/${id}/checklist/${itemId}`),
  createLink: (id: string, body: CalendarLinkCreate) =>
    post<CalendarLinkOut>(`/calendar/events/${id}/links`, body),
  deleteLink: (id: string, linkId: string) =>
    del<void>(`/calendar/events/${id}/links/${linkId}`),
};
