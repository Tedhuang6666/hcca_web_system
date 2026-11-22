import type {
  NotificationPreferences, WebPushConfigOut, WebPushSubscriptionOut,
} from "../types";
import { get, post, patch, put, del } from "./core";

// ── 站內通知 ──────────────────────────────────────────────────────────────────

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  related_id: string | null;
  created_at: string;
}

export const notificationsApi = {
  list: (
    unread_only = false,
    limit = 50,
    params?: { date_from?: string; date_to?: string; offset?: number },
  ) => {
    const q = new URLSearchParams();
    q.set("unread_only", String(unread_only));
    q.set("limit", String(limit));
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    return get<NotificationItem[]>(`/notifications/inbox?${q}`);
  },
  count: () => get<{ unread: number; total: number }>("/notifications/inbox/count"),
  markRead: (id: string) => patch<NotificationItem>(`/notifications/inbox/${id}/read`, {}),
  markAllRead: () => post<{ marked_read: number }>("/notifications/inbox/read-all"),
  getPreferences: () => get<NotificationPreferences>("/notifications/preferences"),
  updatePreferences: (body: Partial<NotificationPreferences>) =>
    put<NotificationPreferences>("/notifications/preferences", body),
  getDigestFrequency: () =>
    get<{ frequency: "off" | "daily" | "weekly" }>("/notifications/preferences/digest"),
  setDigestFrequency: (frequency: "off" | "daily" | "weekly") =>
    put<{ frequency: "off" | "daily" | "weekly" }>(
      "/notifications/preferences/digest",
      { frequency },
    ),
  unsubscribe: (token: string) =>
    post<{ status: string; type: string; message: string }>(
      "/notifications/unsubscribe",
      { token },
    ),
  webPushConfig: () => get<WebPushConfigOut>("/notifications/web-push/config"),
  saveWebPushSubscription: (body: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    device_label?: string;
  }) => post<WebPushSubscriptionOut>("/notifications/web-push/subscriptions", body),
  listWebPushSubscriptions: () =>
    get<WebPushSubscriptionOut[]>("/notifications/web-push/subscriptions"),
  deleteWebPushSubscription: (id: string) =>
    del<void>(`/notifications/web-push/subscriptions/${id}`),
  testWebPush: () => post<{ sent: number }>("/notifications/web-push/test", {}),
};
