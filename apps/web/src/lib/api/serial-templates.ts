import type {
  SerialTemplateOut,
} from "../types";
import { get, post, patch, del } from "./core";

// ── 字號模板 ──────────────────────────────────────────────────────────────────

export const serialTemplatesApi = {
  list: (params?: { org_id?: string; active_only?: boolean }) => {
    const p: Record<string, string> = {};
    if (params?.org_id) p.org_id = params.org_id;
    if (params?.active_only !== undefined) p.active_only = String(params.active_only);
    const qs = Object.keys(p).length ? "?" + new URLSearchParams(p).toString() : "";
    return get<SerialTemplateOut[]>(`/document-serial-templates${qs}`);
  },
  get: (id: string) => get<SerialTemplateOut>(`/document-serial-templates/${id}`),
  create: (body: {
    org_id: string; category_char: string;
    year_mode?: "roc" | "ce"; reset_on_new_year?: boolean; description?: string;
    is_default?: boolean; is_default_president_publish?: boolean;
  }) => post<SerialTemplateOut>("/document-serial-templates", body),
  update: (id: string, body: {
    description?: string | null; is_active?: boolean;
    reset_on_new_year?: boolean; year_mode?: "roc" | "ce";
    is_default?: boolean; is_default_president_publish?: boolean;
  }) => patch<SerialTemplateOut>(`/document-serial-templates/${id}`, body),
  deactivate: (id: string) => del<void>(`/document-serial-templates/${id}`),
};
