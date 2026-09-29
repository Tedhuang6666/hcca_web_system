"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { apiErrorMessage, classApi } from "@/lib/api";
import type { ClassCorrectionRequestOut, SchoolClassListItem } from "@/lib/types";

function classLabel(schoolClass: SchoolClassListItem) {
  const label = schoolClass.label ?? `${schoolClass.academic_year} 學年度 ${schoolClass.class_code} 班`;
  return schoolClass.is_active ? label : `${label}（已停用）`;
}

export default function ClassCorrectionRequestsPanel() {
  const [requests, setRequests] = useState<ClassCorrectionRequestOut[]>([]);
  const [classes, setClasses] = useState<SchoolClassListItem[]>([]);
  const [targetClassIds, setTargetClassIds] = useState<Record<string, string>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [nextRequests, nextClasses] = await Promise.all([
        classApi.correctionRequests(),
        classApi.list(),
      ]);
      setRequests(nextRequests);
      setClasses(nextClasses);
      setTargetClassIds(Object.fromEntries(
        nextRequests.map((request) => [request.id, request.requested_class_id]),
      ));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (request: ClassCorrectionRequestOut, decision: "approved" | "rejected") => {
    setSavingId(request.id);
    try {
      await classApi.reviewCorrectionRequest(request.id, {
        status: decision,
        class_id: decision === "approved" ? targetClassIds[request.id] : null,
        review_note: reviewNotes[request.id]?.trim() || null,
      });
      toast.success(decision === "approved" ? "已核准並更新班級歸戶" : "已退回班級更正申請");
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, "處理申請失敗，請重新載入後再試"));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="class-correction-requests-title">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="class-correction-requests-title" className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            班級更正申請
          </h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            確認使用者資料後，可直接選擇實際歸戶班級並核准。
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="btn btn-ghost min-h-11" disabled={loading}>
          {loading ? "載入中…" : "重新載入"}
        </button>
      </header>

      {loadError && (
        <div className="rounded-md p-4 text-sm" role="alert" style={{ border: "1px solid var(--danger)", color: "var(--danger)" }}>
          無法載入班級更正申請，請重新載入。
        </div>
      )}

      {!loading && !loadError && requests.length === 0 && (
        <div className="rounded-md p-8 text-center text-sm" style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
          目前沒有待審核的班級更正申請。
        </div>
      )}

      {requests.map((request) => (
        <article key={request.id} className="space-y-3 border-b pb-4" style={{ borderColor: "var(--border)" }}>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {request.user_display_name}
              </h3>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                {[request.user_student_id, request.user_email].filter(Boolean).join("・")}
              </p>
            </div>
            <time className="text-xs tabular-nums" dateTime={request.created_at} style={{ color: "var(--text-muted)" }}>
              {new Date(request.created_at).toLocaleString("zh-TW")}
            </time>
          </div>

          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            目前歸戶：{request.reported_class_label ?? "未指定"}　→　使用者希望：{request.requested_class_label}
          </p>
          {request.message && (
            <p className="whitespace-pre-wrap text-sm" style={{ color: "var(--text-primary)" }}>
              {request.message}
            </p>
          )}

          <div className="grid gap-3 md:grid-cols-[minmax(12rem,1fr)_minmax(16rem,2fr)]">
            <label className="grid content-start gap-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              核准後歸戶至
              <select
                value={targetClassIds[request.id] ?? ""}
                onChange={(event) => setTargetClassIds((current) => ({ ...current, [request.id]: event.target.value }))}
                className="min-h-11 rounded-md border px-3 font-normal"
                style={{ background: "var(--card-bg)", borderColor: "var(--border)", color: "var(--text-primary)" }}
              >
                <option value="">請選擇有效班級</option>
                {classes.filter((schoolClass) => schoolClass.is_active).map((schoolClass) => (
                  <option key={schoolClass.id} value={schoolClass.id}>{classLabel(schoolClass)}</option>
                ))}
              </select>
            </label>
            <label className="grid content-start gap-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              給使用者的說明（選填）
              <input
                value={reviewNotes[request.id] ?? ""}
                onChange={(event) => setReviewNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                maxLength={2000}
                className="min-h-11 rounded-md border px-3 font-normal"
                style={{ background: "var(--card-bg)", borderColor: "var(--border)", color: "var(--text-primary)" }}
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void review(request, "approved")}
              disabled={savingId === request.id || !targetClassIds[request.id]}
              className="btn btn-primary min-h-11"
            >
              {savingId === request.id ? "處理中…" : "核准並更改歸戶"}
            </button>
            <button
              type="button"
              onClick={() => void review(request, "rejected")}
              disabled={savingId === request.id}
              className="btn btn-ghost min-h-11"
            >
              退回申請
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
