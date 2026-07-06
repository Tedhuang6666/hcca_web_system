import type {
  SurveyListItem, SurveyOut, SurveyQuestionOut, SurveyResponseAdminItem, SurveyResponseOut, SurveyStats,
} from "../types";
import { BASE, get, post, patch, del, csrfHeaders, silentRefresh, errorMessageFromResponse, ApiError, pathSegment } from "./core";

// ── 問卷系統 ──────────────────────────────────────────────────────────────────

export type SurveyQuestionBody = {
  question_text?: string;
  question_type?: string;
  is_required?: boolean;
  options?: string[];
  min_value?: number;
  max_value?: number;
  placeholder?: string;
  image_url?: string;
  min_length?: number;
  max_length?: number;
  validation_rule?: string;
  min_label?: string;
  max_label?: string;
  condition?: { rules: { question_id: string; operator: string; value: string; connector: string }[] } | null;
  option_config?: { exclusive: string[]; other: string[] } | null;
  order_index?: number;
};

export const surveysApi = {
  list: (params?: { status?: string; org_id?: string; activity_id?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.org_id) q.set("org_id", params.org_id);
    if (params?.activity_id) q.set("activity_id", params.activity_id);
    const qs = q.toString();
    return get<SurveyListItem[]>(`/surveys${qs ? `?${qs}` : ""}`);
  },
  /** 公開問卷列表（未登入可用，僅回傳 is_public 且開放/已截止的問卷） */
  listPublic: (params?: { status?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    const qs = q.toString();
    return get<SurveyListItem[]>(`/surveys/public${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => get<SurveyOut>(`/surveys/${pathSegment(id)}`),
  getPublic: (id: string) => get<SurveyOut>(`/surveys/public/${pathSegment(id)}`),
  create: (body: { title: string; description?: string; is_anonymous?: boolean; allow_multiple?: boolean; opens_at?: string; closes_at?: string; org_id: string; activity_id?: string | null; is_public?: boolean; allowed_org_ids?: string[]; allowed_user_ids?: string[]; allowed_domains?: string[] }) =>
    post<SurveyOut>("/surveys", body),
  update: (id: string, body: { title?: string; description?: string; opens_at?: string; closes_at?: string; activity_id?: string | null; is_public?: boolean; allowed_org_ids?: string[]; allowed_user_ids?: string[]; allowed_domains?: string[] }) =>
    patch<SurveyOut>(`/surveys/${pathSegment(id)}`, body),
  open: (id: string) => post<SurveyOut>(`/surveys/${pathSegment(id)}/open`),
  close: (id: string) => post<SurveyOut>(`/surveys/${pathSegment(id)}/close`),
  addQuestion: (id: string, body: SurveyQuestionBody & { question_text: string; question_type: string }) =>
    post<SurveyQuestionOut>(`/surveys/${pathSegment(id)}/questions`, body),
  updateQuestion: (questionId: string, body: SurveyQuestionBody) =>
    patch<SurveyQuestionOut>(`/surveys/questions/${questionId}`, body),
  deleteQuestion: (questionId: string) => del<void>(`/surveys/questions/${questionId}`),
  submit: (id: string, body: { answers: { question_id: string; answer_text?: string; answer_options?: string[]; other_text?: string }[]; anon_token?: string; email_copy?: boolean }) =>
    post<SurveyResponseOut>(`/surveys/${pathSegment(id)}/submit`, body),
  stats: (id: string) => get<SurveyStats>(`/surveys/${pathSegment(id)}/stats`),
  responses: (id: string) =>
    get<SurveyResponseAdminItem[]>(`/surveys/${pathSegment(id)}/responses`),
  uploadImage: async (file: File): Promise<{ url: string; filename: string }> => {
    const fd = new FormData();
    fd.append("file", file);
    const doFetch = () =>
      fetch(`${BASE}/surveys/images`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders("POST"),
        body: fd,
      });
    let res = await doFetch();
    if (res.status === 401) {
      const ok = await silentRefresh();
      if (ok) res = await doFetch();
    }
    if (!res.ok) throw new ApiError(res.status, await errorMessageFromResponse(res));
    return res.json();
  },
  exportSpreadsheet: async (id: string): Promise<Blob> => {
    const doFetch = () =>
      fetch(`${BASE}/surveys/${pathSegment(id)}/export`, { credentials: "include" });
    let res = await doFetch();
    if (res.status === 401) {
      const ok = await silentRefresh();
      if (ok) res = await doFetch();
    }
    if (!res.ok) throw new ApiError(res.status, await errorMessageFromResponse(res));
    return res.blob();
  },
};
