"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bug,
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Save,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import {
  apiErrorMessage,
  siteReportsApi,
  type SiteReport,
  type SiteReportKind,
  type SiteReportSeverity,
  type SiteReportStatus,
} from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";

const KIND_LABELS: Record<SiteReportKind, string> = {
  vulnerability: "資安漏洞",
  bug: "功能錯誤",
};

const SEVERITY_LABELS: Record<SiteReportSeverity, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "緊急",
};

const SEVERITY_STYLES: Record<SiteReportSeverity, string> = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-orange-100 text-orange-800",
  critical: "bg-red-100 text-red-800",
};

const STATUS_LABELS: Record<SiteReportStatus, string> = {
  new: "待處理",
  triaged: "已分類",
  in_progress: "處理中",
  resolved: "已解決",
  wont_fix: "不處理",
  duplicate: "重複回報",
};

const STATUS_OPTIONS = Object.keys(STATUS_LABELS) as SiteReportStatus[];
const SEVERITY_OPTIONS = Object.keys(SEVERITY_LABELS) as SiteReportSeverity[];

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", { hour12: false });
}

function isExternalUrl(value: string | null): value is string {
  return Boolean(value && /^https?:\/\//i.test(value));
}

function ReportCard({
  report,
  onUpdated,
}: {
  report: SiteReport;
  onUpdated: (report: SiteReport) => void;
}) {
  const [status, setStatus] = useState<SiteReportStatus>(report.status);
  const [severity, setSeverity] = useState<SiteReportSeverity>(report.severity);
  const [adminNote, setAdminNote] = useState(report.admin_note ?? "");
  const [saving, setSaving] = useState(false);
  const dirty =
    status !== report.status
    || severity !== report.severity
    || adminNote.trim() !== (report.admin_note ?? "");

  useEffect(() => {
    setStatus(report.status);
    setSeverity(report.severity);
    setAdminNote(report.admin_note ?? "");
  }, [report]);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await siteReportsApi.update(report.id, {
        status,
        severity,
        admin_note: adminNote.trim() || null,
      });
      onUpdated(updated);
      toast.success(`已更新 ${report.reference_code}`);
    } catch (reason) {
      toast.error(apiErrorMessage(reason, "更新回報失敗"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-hover)] px-2.5 py-1 text-[11px] font-semibold">
              {report.kind === "vulnerability" ? <ShieldAlert size={12} aria-hidden /> : <Bug size={12} aria-hidden />}
              {KIND_LABELS[report.kind]}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${SEVERITY_STYLES[report.severity]}`}>
              {SEVERITY_LABELS[report.severity]}
            </span>
            <span className="font-mono text-[11px] text-[var(--text-muted)]">{report.reference_code}</span>
          </div>
          <h2 className="mt-3 break-words text-lg font-semibold">{report.title}</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {formatDateTime(report.created_at)}
            {report.contact_email ? ` · ${report.contact_email}` : " · 未留下聯絡 Email"}
          </p>
        </div>
        <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-medium">
          {STATUS_LABELS[report.status]}
        </span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 text-sm">
          <div>
            <p className="text-xs font-semibold text-[var(--text-muted)]">問題描述</p>
            <p className="mt-1 whitespace-pre-wrap break-words leading-7">{report.description}</p>
          </div>
          {report.steps_to_reproduce ? (
            <div>
              <p className="text-xs font-semibold text-[var(--text-muted)]">重現步驟</p>
              <p className="mt-1 whitespace-pre-wrap break-words leading-7">{report.steps_to_reproduce}</p>
            </div>
          ) : null}
          {report.affected_url ? (
            <div>
              <p className="text-xs font-semibold text-[var(--text-muted)]">發生網址</p>
              {isExternalUrl(report.affected_url) ? (
                <a
                  href={report.affected_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 break-all text-sm text-[var(--primary)] underline"
                >
                  {report.affected_url}
                  <ExternalLink size={13} aria-hidden />
                </a>
              ) : (
                <code className="mt-1 block break-all rounded bg-[var(--bg-hover)] px-2 py-1 text-xs">
                  {report.affected_url}
                </code>
              )}
            </div>
          ) : null}
          <details className="rounded-lg border border-[var(--border)] p-3">
            <summary className="cursor-pointer text-xs font-semibold text-[var(--text-muted)]">
              技術資訊
            </summary>
            <dl className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
              <div className="flex gap-2">
                <dt className="shrink-0">User agent：</dt>
                <dd className="break-all">{report.user_agent || "未記錄"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="shrink-0">回報者 ID：</dt>
                <dd className="break-all">{report.reporter_id || "匿名"}</dd>
              </div>
              {report.reviewed_at ? (
                <div className="flex gap-2">
                  <dt className="shrink-0">最後處理：</dt>
                  <dd>{formatDateTime(report.reviewed_at)}</dd>
                </div>
              ) : null}
            </dl>
          </details>
        </div>

        <div className="space-y-3 rounded-xl bg-[var(--bg-hover)] p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-semibold text-[var(--text-muted)]">
              處理狀態
              <select
                className="input-sm w-full"
                value={status}
                onChange={(event) => setStatus(event.target.value as SiteReportStatus)}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {STATUS_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold text-[var(--text-muted)]">
              影響程度
              <select
                className="input-sm w-full"
                value={severity}
                onChange={(event) => setSeverity(event.target.value as SiteReportSeverity)}
              >
                {SEVERITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {SEVERITY_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block space-y-1 text-xs font-semibold text-[var(--text-muted)]">
            處理備註（僅內部可見）
            <textarea
              className="input min-h-24 w-full resize-y"
              value={adminNote}
              onChange={(event) => setAdminNote(event.target.value)}
              placeholder="記錄判斷結果、修正版本或回覆內容"
              maxLength={10000}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary min-h-10 w-full"
            onClick={save}
            disabled={saving || !dirty}
          >
            {saving ? <LoaderCircle size={15} className="animate-spin" aria-hidden /> : <Save size={15} aria-hidden />}
            {saving ? "儲存中…" : "儲存處理結果"}
          </button>
        </div>
      </div>
    </article>
  );
}

export default function SiteReportsAdminPage() {
  const { canAny, isReady } = usePermissions();
  const allowed = canAny("site_report:manage", "site:manage");
  const [reports, setReports] = useState<SiteReport[]>([]);
  const [statusFilter, setStatusFilter] = useState<SiteReportStatus | "">("");
  const [kindFilter, setKindFilter] = useState<SiteReportKind | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await siteReportsApi.adminList({
        status: statusFilter,
        kind: kindFilter,
      });
      setReports(data);
    } catch (reason) {
      setError(apiErrorMessage(reason, "無法載入網站回報"));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, kindFilter]);

  useEffect(() => {
    if (!isReady || !allowed) return;
    void load();
  }, [allowed, isReady, load]);

  const replaceReport = (updated: SiteReport) => {
    setReports((current) => current.map((report) => (report.id === updated.id ? updated : report)));
  };

  const openCount = reports.filter((report) => report.status === "new").length;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-5 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--primary)" }}>
            SECURITY REPORTS
          </p>
          <h1 className="mt-1 text-2xl font-semibold">網站回報</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--text-muted)]">
            處理公開網站收到的資安漏洞與功能問題回報。此頁內容僅限具備回報處理權限的成員查看。
          </p>
        </div>
        <button type="button" className="btn btn-secondary min-h-10" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={15} className={loading ? "animate-spin" : undefined} aria-hidden />
          重新整理
        </button>
      </header>

      {!isReady ? (
        <section className="card flex items-center gap-3 p-6 text-sm text-[var(--text-muted)]" role="status">
          <LoaderCircle size={18} className="animate-spin" aria-hidden />
          正在確認權限…
        </section>
      ) : !allowed ? (
        <section className="card p-6" role="alert">
          <h2 className="text-lg font-semibold">沒有查看權限</h2>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            需要「處理網站回報」或「管理公開網站」權限才能查看此頁。
          </p>
        </section>
      ) : (
        <>
          <section className="card flex flex-wrap items-end gap-4 p-4">
            <label className="space-y-1 text-xs font-semibold text-[var(--text-muted)]">
              處理狀態
              <select
                className="input-sm min-w-36"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as SiteReportStatus | "")}
              >
                <option value="">全部</option>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {STATUS_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-semibold text-[var(--text-muted)]">
              回報類型
              <select
                className="input-sm min-w-36"
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value as SiteReportKind | "")}
              >
                <option value="">全部</option>
                {Object.entries(KIND_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <p className="ml-auto flex items-center gap-2 text-sm text-[var(--text-muted)]">
              <CheckCircle2 size={16} aria-hidden />
              共 {reports.length} 筆，待處理 {openCount} 筆
            </p>
          </section>

          {error ? (
            <p className="card p-4 text-sm text-[var(--text-muted)]" role="alert">{error}</p>
          ) : null}

          {loading && reports.length === 0 ? (
            <section className="card flex items-center gap-3 p-6 text-sm text-[var(--text-muted)]" role="status">
              <LoaderCircle size={18} className="animate-spin" aria-hidden />
              正在載入回報…
            </section>
          ) : reports.length === 0 ? (
            <section className="card p-8 text-center text-sm text-[var(--text-muted)]">
              目前沒有符合條件的回報。
            </section>
          ) : (
            <section className="space-y-4">
              {reports.map((report) => (
                <ReportCard key={report.id} report={report} onUpdated={replaceReport} />
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
