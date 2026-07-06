import type {
  WorkItemCreate, WorkItemOut, WorkItemUpdate,
} from "../types";
import { get, post, patch } from "./core";

export const workItemsApi = {
  list: (params?: { assigned_to_id?: string; include_done?: boolean; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.assigned_to_id) search.set("assigned_to_id", params.assigned_to_id);
    if (params?.include_done) search.set("include_done", "true");
    if (params?.limit) search.set("limit", String(params.limit));
    const qs = search.toString();
    return get<WorkItemOut[]>(`/work-items${qs ? `?${qs}` : ""}`);
  },
  create: (body: WorkItemCreate) => post<WorkItemOut>("/work-items", body),
  update: (id: string, body: WorkItemUpdate) => patch<WorkItemOut>(`/work-items/${id}`, body),
  complete: (id: string) => post<WorkItemOut>(`/work-items/${id}/complete`, {}),
};
