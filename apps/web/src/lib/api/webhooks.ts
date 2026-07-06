import { get, post, patch, del } from "./core";

// ── Webhooks ─────────────────────────────────────────────────────────────
export interface WebhookSubscriptionOut {
  id: string;
  name: string;
  owner_user_id: string;
  url: string;
  events: string[];
  is_active: boolean;
  max_retries: number;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookSubscriptionCreate {
  name: string;
  url: string;
  events: string[];
  description?: string | null;
  max_retries?: number;
}

export interface WebhookSubscriptionUpdate {
  name?: string;
  url?: string;
  events?: string[];
  description?: string | null;
  is_active?: boolean;
  max_retries?: number;
}

export interface WebhookSubscriptionCreatedResponse {
  subscription: WebhookSubscriptionOut;
  signing_secret: string;
}

export interface WebhookDeliveryOut {
  id: string;
  subscription_id: string;
  event_type: string;
  status: string;
  attempt_count: number;
  scheduled_at: string;
  last_attempted_at: string | null;
  succeeded_at: string | null;
  response_status: number | null;
  error_message: string | null;
  created_at: string;
}

export const webhooksApi = {
  list: (only_active = false) =>
    get<WebhookSubscriptionOut[]>(`/webhooks?only_active=${only_active}`),
  create: (body: WebhookSubscriptionCreate) =>
    post<WebhookSubscriptionCreatedResponse>("/webhooks", body),
  update: (id: string, body: WebhookSubscriptionUpdate) =>
    patch<WebhookSubscriptionOut>(`/webhooks/${encodeURIComponent(id)}`, body),
  remove: (id: string) => del<{ ok: boolean }>(`/webhooks/${encodeURIComponent(id)}`),
  deliveries: (id: string, limit = 50) =>
    get<WebhookDeliveryOut[]>(
      `/webhooks/${encodeURIComponent(id)}/deliveries?limit=${limit}`,
    ),
};
