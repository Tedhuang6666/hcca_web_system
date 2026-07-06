import type {
  ExamGradeTrack, ExamPaperDownloadOut, ExamPaperListItem, ExamPaperOut, ExamPaperUpdate, ExamTraceInspectOut,
} from "../types";
import { BASE, get, patch, del, csrfHeaders, silentRefresh, errorMessageFromResponse, ApiError } from "./core";

// ── 段考題庫 ────────────────────────────────────────────────────────────────

export const examPapersApi = {
  list: (params?: {
    include_unpublished?: boolean;
    subject?: string;
    academic_year?: number;
    semester?: number;
    grade?: number;
    grade_track?: ExamGradeTrack | null;
    exam_number?: number;
  }) => {
    const q = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") q.set(key, String(value));
    });
    const qs = q.toString();
    return get<ExamPaperListItem[]>(`/exam-papers${qs ? `?${qs}` : ""}`);
  },
  create: async (body: {
    file: File;
    title: string;
    subject: string;
    academic_year: number;
    semester: number;
    grade: number;
    grade_track?: ExamGradeTrack | null;
    exam_number: number;
    is_published: boolean;
  }): Promise<ExamPaperOut> => {
    const fd = new FormData();
    fd.append("file", body.file);
    fd.append("title", body.title);
    fd.append("subject", body.subject);
    fd.append("academic_year", String(body.academic_year));
    fd.append("semester", String(body.semester));
    fd.append("grade", String(body.grade));
    if (body.grade_track) fd.append("grade_track", body.grade_track);
    fd.append("exam_number", String(body.exam_number));
    fd.append("is_published", String(body.is_published));
    const doFetch = () =>
      fetch(`${BASE}/exam-papers`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders("POST"),
        body: fd,
      });
    let res = await doFetch();
    if (res.status === 401 && await silentRefresh()) res = await doFetch();
    if (!res.ok) throw new ApiError(res.status, await errorMessageFromResponse(res));
    return res.json();
  },
  update: (id: string, body: ExamPaperUpdate) => patch<ExamPaperOut>(`/exam-papers/${id}`, body),
  delete: (id: string) => del<void>(`/exam-papers/${id}`),
  downloadUrl: (id: string) => `${BASE}/exam-papers/${id}/download`,
  downloads: (id: string) => get<ExamPaperDownloadOut[]>(`/exam-papers/${id}/downloads`),
  inspectTrace: async (file: File): Promise<ExamTraceInspectOut> => {
    const fd = new FormData();
    fd.append("file", file);
    const doFetch = () =>
      fetch(`${BASE}/exam-papers/trace/inspect`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders("POST"),
        body: fd,
      });
    let res = await doFetch();
    if (res.status === 401 && await silentRefresh()) res = await doFetch();
    if (!res.ok) throw new ApiError(res.status, await errorMessageFromResponse(res));
    return res.json();
  },
};
