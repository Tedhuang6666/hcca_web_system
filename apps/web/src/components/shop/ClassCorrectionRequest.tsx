"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { apiErrorMessage, classApi } from "@/lib/api";
import type {
  ClassCorrectionRequestOut,
  MyClassContext,
  SchoolClassListItem,
} from "@/lib/types";

function classLabel(schoolClass: SchoolClassListItem) {
  return schoolClass.label ?? `${schoolClass.academic_year} 學年度 ${schoolClass.class_code} 班`;
}

export default function ClassCorrectionRequest({ currentClass }: { currentClass: MyClassContext }) {
  const [classes, setClasses] = useState<SchoolClassListItem[]>([]);
  const [requests, setRequests] = useState<ClassCorrectionRequestOut[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [nextClasses, nextRequests] = await Promise.all([
        classApi.recipientOptions(),
        classApi.myCorrectionRequests(),
      ]);
      setClasses(nextClasses);
      setRequests(nextRequests);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const availableClasses = useMemo(
    () => classes.filter((schoolClass) => schoolClass.id !== currentClass.id),
    [classes, currentClass.id],
  );
  const latestRequest = requests[0] ?? null;
  const hasPendingRequest = latestRequest?.status === "pending";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedClassId) return;
    setSubmitting(true);
    try {
      const request = await classApi.createCorrectionRequest({
        requested_class_id: selectedClassId,
        message: message.trim() || null,
      });
      setRequests((current) => [request, ...current]);
      setMessage("");
      setSelectedClassId("");
      setOpen(false);
      toast.success("班級更正申請已送出");
    } catch (error) {
      toast.error(apiErrorMessage(error, "送出申請失敗，請稍後再試"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="shop-class-correction">
      {hasPendingRequest ? (
        <p className="shop-class-correction-status" role="status">
          更正申請已送出，等待管理員審核。你申請的班級：{latestRequest.requested_class_label}
        </p>
      ) : latestRequest?.status === "rejected" ? (
        <div className="shop-class-correction-status" role="status">
          <p>上次申請未通過{latestRequest.review_note ? `：${latestRequest.review_note}` : ""}</p>
        </div>
      ) : latestRequest?.status === "approved" ? (
        <p className="shop-class-correction-status" role="status">
          班級更正已完成，帳號已歸戶至「{latestRequest.resolved_class_label ?? latestRequest.requested_class_label}」。
        </p>
      ) : null}

      {!hasPendingRequest && (
        <button
          type="button"
          className="shop-class-correction-toggle"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          {open ? "收起班級更正申請" : "班級有誤？告知我們"}
        </button>
      )}

      {loadError && (
        <div className="shop-class-correction-error" role="alert">
          <span>無法載入班級更正資料。</span>
          <button type="button" onClick={() => void load()}>重新載入</button>
        </div>
      )}

      {open && !loadError && (
        <form className="shop-class-correction-form" onSubmit={submit}>
          <label htmlFor="shop-correction-target">你認為正確的班級</label>
          <select
            id="shop-correction-target"
            value={selectedClassId}
            onChange={(event) => setSelectedClassId(event.target.value)}
            required
            disabled={loading || submitting || availableClasses.length === 0}
          >
            <option value="">請選擇班級</option>
            {availableClasses.map((schoolClass) => (
              <option key={schoolClass.id} value={schoolClass.id}>{classLabel(schoolClass)}</option>
            ))}
          </select>
          {availableClasses.length === 0 && !loading && (
            <p className="shop-class-correction-help">目前沒有其他可選的班級，請聯繫班級管理員。</p>
          )}

          <label htmlFor="shop-correction-message">補充說明（選填）</label>
          <textarea
            id="shop-correction-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="例如：我已轉到二年 8 班。"
            disabled={submitting}
          />
          <p className="shop-class-correction-help">管理員審核後會更新你的班級歸戶。</p>
          <div className="shop-class-correction-actions">
            <button
              type="submit"
              disabled={loading || submitting || !selectedClassId}
              className="shop-class-correction-submit"
            >
              {submitting ? "送出中…" : "送出更正申請"}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={submitting}>
              取消
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
