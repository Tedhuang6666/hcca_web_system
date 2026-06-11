"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, FileCheck2, RefreshCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { policiesApi, privacyRequestsApi, apiErrorMessage } from "@/lib/api";
import type {
  PolicyConsentOut,
  PrivacyRequestOut,
  PrivacyRequestType,
} from "@/lib/types";

const REQUEST_TYPES: Array<{ value: PrivacyRequestType; label: string; hint: string }> = [
  { value: "access", label: "查詢/閱覽", hint: "了解平台保存了哪些與我有關的資料。" },
  { value: "copy_export", label: "資料匯出", hint: "申請完整資料 ZIP，由管理員驗證後提供。" },
  { value: "rectification", label: "更正資料", hint: "姓名、班級、聯絡方式或其他資料不正確。" },
  { value: "erasure", label: "刪除/假名化", hint: "停用帳號並移除可識別欄位，治理紀錄依法保留。" },
  { value: "objection", label: "異議", hint: "對特定資料處理目的提出異議。" },
  { value: "other", label: "其他", hint: "其他個資權利或處理需求。" },
];

const STATUS_LABEL: Record<string, string> = {
  received: "已送出",
  in_review: "審查中",
  fulfilled: "已完成",
  rejected: "已駁回",
  cancelled: "已取消",
};

function fmtDate(value: string) {
  return new Date(value).toLocaleString("zh-TW");
}

export default function PrivacySettingsPage() {
  const [items, setItems] = useState<PrivacyRequestOut[]>([]);
  const [consents, setConsents] = useState<PolicyConsentOut[]>([]);
  const [requestType, setRequestType] = useState<PrivacyRequestType>("access");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      privacyRequestsApi.listMine().catch(() => []),
      policiesApi.myConsents().catch(() => []),
    ])
      .then(([requests, consentRows]) => {
        setItems(requests);
        setConsents(consentRows);
      })
      .catch((e) => {
        toast.error(apiErrorMessage(e, "載入隱私設定失敗"));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async () => {
    if (subject.trim().length < 4 || description.trim().length < 10) {
      toast.error("請補齊請求主旨與說明");
      return;
    }
    setSubmitting(true);
    try {
      const row = await privacyRequestsApi.create({
        request_type: requestType,
        subject: subject.trim(),
        description: description.trim(),
      });
      setItems((prev) => [row, ...prev]);
      setSubject("");
      setDescription("");
      toast.success("已送出個資權利請求");
    } catch (e) {
      toast.error(apiErrorMessage(e, "送出失敗"));
    } finally {
      setSubmitting(false);
    }
  };

  const cancelRequest = async (id: string) => {
    const reason = window.prompt("取消原因（可留空）：");
    if (reason === null) return;
    try {
      const row = await privacyRequestsApi.cancelMine(id, reason);
      setItems((prev) => prev.map((item) => (item.id === id ? row : item)));
      toast.success("已取消請求");
    } catch (e) {
      toast.error(apiErrorMessage(e, "取消失敗"));
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--primary)" }}>
            PRIVACY
          </p>
          <h1 className="mt-1 text-xl font-semibold">隱私與資料請求</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            查閱政策同意紀錄，並依個資權利送出資料請求。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/legal/privacy" className="btn btn-ghost">
            隱私政策
          </Link>
          <button type="button" className="btn btn-ghost" onClick={load} disabled={loading}>
            <RefreshCcw size={14} aria-hidden />
            重新整理
          </button>
        </div>
      </header>

      <section className="card p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck size={20} aria-hidden style={{ color: "var(--primary)" }} />
          <div>
            <h2 className="text-sm font-semibold">你可以行使的資料權利</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
              平台會驗證身分、留下稽核紀錄，並依資料保留政策處理。公文、法規、會議與稽核紀錄等具公共利益或法定保存價值的資料，通常不會直接刪除，但可進行假名化或限制處理。
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold">提出請求</h2>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              請求類型
            </span>
            <select
              value={requestType}
              onChange={(e) => setRequestType(e.target.value as PrivacyRequestType)}
              className="input">
              {REQUEST_TYPES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
              {REQUEST_TYPES.find((item) => item.value === requestType)?.hint}
            </span>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              主旨
            </span>
            <input
              className="input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="例如：申請匯出我的平台資料"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              說明
            </span>
            <textarea
              className="input min-h-32 resize-y"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="請描述你要查詢、更正、匯出或限制處理的資料範圍。"
            />
          </label>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="btn btn-primary">
            <Download size={14} aria-hidden />
            送出請求
          </button>
        </div>

        <div className="card overflow-hidden">
          <header className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
            <h2 className="text-sm font-semibold">政策同意紀錄</h2>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              顯示你已同意過的政策版本與時間。
            </p>
          </header>
          {consents.length === 0 ? (
            <p className="p-5 text-sm" style={{ color: "var(--text-muted)" }}>
              {loading ? "載入中…" : "目前沒有同意紀錄。"}
            </p>
          ) : (
            <ul>
              {consents.map((item) => (
                <li
                  key={item.id}
                  className="px-5 py-3 text-sm"
                  style={{ borderBottom: "1px solid var(--border)" }}>
                  <div className="flex items-center gap-2">
                    <FileCheck2 size={14} aria-hidden style={{ color: "var(--success)" }} />
                    <span className="text-sm font-medium">
                      {item.policy_title ?? item.policy_document_id}
                    </span>
                  </div>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {item.policy_kind && item.policy_version
                      ? `${item.policy_kind} v${item.policy_version} · `
                      : ""}
                    同意時間：{fmtDate(item.agreed_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card overflow-hidden">
        <header className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <h2 className="text-sm font-semibold">我的請求紀錄</h2>
        </header>
        {items.length === 0 ? (
          <p className="p-5 text-sm" style={{ color: "var(--text-muted)" }}>
            {loading ? "載入中…" : "尚未送出任何資料請求。"}
          </p>
        ) : (
          <ul>
            {items.map((item) => (
              <li
                key={item.id}
                className="px-5 py-4"
                style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{item.subject}</p>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                      {REQUEST_TYPES.find((r) => r.value === item.request_type)?.label}
                      {" · "}
                      {fmtDate(item.created_at)}
                    </p>
                  </div>
                  <span
                    className="rounded-full px-2.5 py-1 text-xs font-medium"
                    style={{
                      background: "var(--primary-dim)",
                      color: "var(--primary)",
                      border: "1px solid var(--warning-border)",
                    }}>
                    {STATUS_LABEL[item.status] ?? item.status}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-line text-sm" style={{ color: "var(--text-secondary)" }}>
                  {item.description}
                </p>
                {item.response_message && (
                  <div
                    className="mt-3 rounded-lg border p-3 text-sm"
                    style={{
                      background: "var(--bg-hover)",
                      borderColor: "var(--border)",
                      color: "var(--text-secondary)",
                    }}>
                    {item.response_message}
                  </div>
                )}
                {(item.status === "received" || item.status === "in_review") && (
                  <button
                    type="button"
                    className="btn-sm btn-danger-ghost mt-3"
                    onClick={() => cancelRequest(item.id)}>
                    取消請求
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
