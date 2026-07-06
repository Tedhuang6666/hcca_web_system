import type {
  EntityRelationCreate, EntityRelationOut, MatterCreate, MatterListItem, MatterOut, MatterResourceCreate, MatterResourceOut, MatterResourceUpdate, MatterUpdate, TimelineEventOut,
} from "../types";
import { get, post, patch, del } from "./core";

export const mattersApi = {
  list: (params?: {
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
    return get<MatterListItem[]>(`/matters${qs ? `?${qs}` : ""}`);
  },
  create: (body: MatterCreate) => post<MatterOut>("/matters", body),
  get: (id: string) => get<MatterOut>(`/matters/${id}`),
  update: (id: string, body: MatterUpdate) => patch<MatterOut>(`/matters/${id}`, body),
  timeline: (id: string) => get<TimelineEventOut[]>(`/matters/${id}/timeline`),
  createRelation: (id: string, body: EntityRelationCreate) =>
    post<EntityRelationOut>(`/matters/${id}/relations`, body),
  deleteRelation: (id: string, relationId: string) =>
    del<void>(`/matters/${id}/relations/${relationId}`),
  createResource: (id: string, body: MatterResourceCreate) =>
    post<MatterResourceOut>(`/matters/${id}/resources`, body),
  updateResource: (id: string, resourceId: string, body: MatterResourceUpdate) =>
    patch<MatterResourceOut>(`/matters/${id}/resources/${resourceId}`, body),
  deleteResource: (id: string, resourceId: string) =>
    del<void>(`/matters/${id}/resources/${resourceId}`),
};
