import { get, post, patch, del } from "./core";
import { apiUrl } from "../config";

export const googleCalendarApi = {
  getStatus: (orgId: string) =>
    get<import("@/lib/types").GoogleCalendarStatusOut>(`/calendar/google/status/${orgId}`),
  getAuthorizeUrl: (orgId: string): string =>
    apiUrl(`/calendar/google/authorize?org_id=${orgId}`),
  disconnect: (orgId: string) =>
    del<void>(`/calendar/google/disconnect/${orgId}`),
  triggerPull: (orgId: string) =>
    post<{ status: string }>(`/calendar/google/trigger-pull/${orgId}`, {}),
  listCalendars: (orgId: string) =>
    get<import("@/lib/types").GoogleCalendarItem[]>(`/calendar/google/calendars/${orgId}`),
  updateConfig: (orgId: string, googleCalendarId: string) =>
    patch<import("@/lib/types").GoogleCalendarStatusOut>(`/calendar/google/config/${orgId}`, {
      google_calendar_id: googleCalendarId,
    }),
};
