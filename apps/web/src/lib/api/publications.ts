import type {
  PublicationCampaignOut, PublicationPreviewOut, PublicationStatsOut,
} from "../types";
import { get, post, patch } from "./core";

export const publicationsApi = {
  list: (params?: { activity_id?: string; status?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.activity_id) q.set("activity_id", params.activity_id);
    if (params?.status) q.set("status", params.status);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return get<PublicationCampaignOut[]>(`/publications${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => get<PublicationCampaignOut>(`/publications/${id}`),
  create: (body: {
    title: string; body: string; source_type?: string | null; source_id?: string | null;
    activity_id?: string | null; org_id?: string | null; audience_type?: string;
    audience_filter?: Record<string, unknown>; channels: string[]; scheduled_at?: string | null;
  }) => post<PublicationCampaignOut>("/publications", body),
  update: (id: string, body: Partial<PublicationCampaignOut>) =>
    patch<PublicationCampaignOut>(`/publications/${id}`, body),
  preview: (id: string) => post<PublicationPreviewOut>(`/publications/${id}/preview`, {}),
  send: (id: string) => post<PublicationCampaignOut>(`/publications/${id}/send`, {}),
  stats: (id: string) => get<PublicationStatsOut>(`/publications/${id}/stats`),
};
