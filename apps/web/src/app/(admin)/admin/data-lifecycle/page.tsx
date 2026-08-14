"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Download,
  Eye,
  FileArchive,
  Lock,
  Play,
  RefreshCcw,
  Trash2 } from "lucide-react";
import { toast } from "sonner";

import { usePermissions } from "@/hooks/usePermissions";
import {
  lifecycleApi,
  type LifecycleAction,
  type LifecycleArchiveFile,
  type LifecyclePreviewResult,
  type LifecycleRuleSummary, apiErrorMessage } from "@/lib/api";

type RunningKey = string | null;

const DANGER_COLOR: Record<LifecycleRuleSummary["danger_level"], string> = {
  safe: "var(--success)",
  caution: "var(--warning)",
  dangerous: "var(--danger)",
};

const ACTION_LABEL: Record<LifecycleAction, string> = {
  archive: "只歸檔（不刪）",
  purge: "只清除（不歸檔）",
  archive_then_purge: "先歸檔再清除",
};

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export default function DataLifecyclePage() {
  const { isAdmin } = usePermissions();
  const [rules, setRules] = useState<LifecycleRuleSummary[]>([]);
  const [archives, setArchives] = useState<LifecycleArchiveFile[]>([]);
  const [retentionOverride, setRetentionOverride] = useState<Record<string, string>>({});
  const [actionOverride, setActionOverride] = useState<Record<string, LifecycleAction>>({});
  const [previews, setPreviews] = useState<Record<string, LifecyclePreviewResult>>({});
  const [running, setRunning] = useState<RunningKey>(null);
  const [error, setError] = useState<string | null>(null);
  const [archivePreview, setArchivePreview] = useState<{
    path: string;
    rows: Array<Record<string, unknown>>;
  } | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [rs, ar] = await Promise.all([lifecycleApi.listRules(), lifecycleApi.listArchives()]);
      setRules(rs);
      setArchives(ar);
    } catch (e) {
      setError(apiErrorMessage(e, "讀取失敗"));
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void reload();
  }, [isAdmin, reload]);

  const groupedRules = useMemo(() => {
    return [...rules].sort((a, b) => {
      const order = { safe: 0, caution: 1, dangerous: 2 };
      return order[a.danger_level] - order[b.danger_level];
    });
  }, [rules]);

  const onPreview = async (ruleId: string) => {
    setRunning(`preview:${ruleId}`);
    try {
      const days = retentionOverride[ruleId] ? Number(retentionOverride[ruleId]) : undefined;
      const result = await lifecycleApi.preview(ruleId, days);
      setPreviews((prev) => ({ ...prev, [ruleId]: result }));
      toast.success(`預覽：將處理 ${result.matched_count} 筆`);
    } catch (e) {
      toast.error(apiErrorMessage(e, "預覽失敗"));
    } finally {
      setRunning(null);
    }
  };

  const onExecute = async (rule: LifecycleRuleSummary) => {
    const action = actionOverride[rule.id] ?? rule.default_action;
    const preview = previews[rule.id];
    const matched = preview?.matched_count ?? rule.matched_count;
    if (matched <= 0) {
      toast.info("沒有符合條件的資料");
      return;
    }

    const willPurge = action === "purge" || action === "archive_then_purge";
    if (rule.danger_level !== "safe" || willPurge) {
      const confirmInput = window.prompt(
        `即將對「${rule.label}」執行：${ACTION_LABEL[action]}\n` +
          `預估處理筆數：${matched}\n` +
          `${willPurge ? "⚠️ 此動作會永久刪除資料庫紀錄。已歸檔的資料只能從 .jsonl.gz 還原。\n" : ""}\n` +
          `請輸入「確認」以繼續：`,
      );
      if (confirmInput?.trim() !== "確認") {
        toast.info("已取消");
        return;
      }
    }

    setRunning(`exec:${rule.id}`);
    try {
      const days = retentionOverride[rule.id]
        ? Number(retentionOverride[rule.id])
        : undefined;
      const result = await lifecycleApi.execute(rule.id, {
        action,
        retention_days: days,
        batch_size: 1000,
        max_batches: 50,
      });
      toast.success(
        `完成：歸檔 ${result.archived_count}、清除 ${result.purged_count}` +
          (result.archive_file ? `\n檔案：${result.archive_file}` : ""),
      );
      await reload();
    } catch (e) {
      toast.error(apiErrorMessage(e, "執行失敗"));
    } finally {
      setRunning(null);
    }
  };

  const onPreviewArchive = async (path: string) => {
    setRunning(`archive:${path}`);
    try {
      const rows = await lifecycleApi.previewArchive(path, 50);
      setArchivePreview({ path, rows });
    } catch (e) {
      toast.error(apiErrorMessage(e, "讀取歸檔失敗"));
    } finally {
      setRunning(null);
    }
  };

  if (!isAdmin) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <section
          className="rounded-lg border p-8 text-center"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
          <Lock className="mx-auto mb-3 text-[var(--danger)]" size={32} aria-hidden />
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            需要超級管理員權限
          </h1>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-6">
      <header className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
            <Archive size={14} aria-hidden />
            資料生命週期 / 批次歸檔與清理
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">資料生命週期</h1>
          <p className="mt-1 max-w-3xl text-xs text-[var(--text-muted)]">
            把過舊的「已讀通知 / 已處理事件 / 過期 Email / 過期稽核」批次歸檔成 .jsonl.gz
            檔，再從資料庫清除以節省空間。「安全」規則每週一 04:00 自動執行，其餘需手動觸發。
            執行前永遠先「預覽」確認筆數。
          </p>
        </div>
        <button type="button" onClick={reload} className="btn btn-ghost">
          <RefreshCcw size={16} aria-hidden />
          重新整理
        </button>
      </header>

      {error && (
        <div
          className="mb-4 rounded-md border px-4 py-3 text-sm"
          style={{
            background: "var(--danger-dim)",
            borderColor: "var(--danger-border)",
            color: "var(--danger)",
          }}>
          {error}
        </div>
      )}

      <section className="mb-8 space-y-3">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">清理規則</h2>
        {groupedRules.map((rule) => {
          const preview = previews[rule.id];
          const action = actionOverride[rule.id] ?? rule.default_action;
          const dangerColor = DANGER_COLOR[rule.danger_level];
          return (
            <article
              key={rule.id}
              className="overflow-hidden rounded-lg border bg-[var(--bg-surface)]"
              style={{ borderColor: "var(--border)" }}>
              <header className="flex flex-col gap-1 border-b border-[var(--border)] px-4 py-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                      {rule.label}
                    </h3>
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ background: `${dangerColor}22`, color: dangerColor }}>
                      {rule.danger_level === "safe"
                        ? "安全"
                        : rule.danger_level === "caution"
                          ? "注意"
                          : "高危"}
                    </span>
                    <code className="text-[10px] text-[var(--text-muted)]">{rule.id}</code>
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{rule.description}</p>
                  {rule.extra_filter && (
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                      條件：{rule.extra_filter}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-xs text-[var(--text-muted)]">當前可處理</div>
                  <div className="text-2xl font-bold text-[var(--text-primary)]">
                    {rule.matched_count < 0 ? "讀取失敗" : rule.matched_count.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)]">
                    預設保留 {rule.default_retention_days} 天
                  </div>
                </div>
              </header>

              <div className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[1fr_1fr_auto]">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-[var(--text-secondary)]">
                    保留天數（≥ {rule.min_retention_days}）
                  </span>
                  <input
                    type="number"
                    min={rule.min_retention_days}
                    max={10000}
                    placeholder={String(rule.default_retention_days)}
                    value={retentionOverride[rule.id] ?? ""}
                    onChange={(e) =>
                      setRetentionOverride((prev) => ({ ...prev, [rule.id]: e.target.value }))
                    }
                    className="input"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-[var(--text-secondary)]">動作</span>
                  <select
                    value={action}
                    onChange={(e) =>
                      setActionOverride((prev) => ({
                        ...prev,
                        [rule.id]: e.target.value as LifecycleAction,
                      }))
                    }
                    className="input">
                    <option value="archive">{ACTION_LABEL.archive}</option>
                    <option value="purge">{ACTION_LABEL.purge}</option>
                    <option value="archive_then_purge">
                      {ACTION_LABEL.archive_then_purge}
                    </option>
                  </select>
                </label>
                <div className="flex items-end gap-2 self-end">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={running !== null}
                    onClick={() => onPreview(rule.id)}>
                    <Eye size={14} aria-hidden />
                    預覽
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={running !== null || rule.matched_count <= 0}
                    onClick={() => onExecute(rule)}>
                    <Play size={14} aria-hidden />
                    {running === `exec:${rule.id}` ? "執行中…" : "執行"}
                  </button>
                </div>
              </div>

              {preview && (
                <div className="border-t border-[var(--border)] bg-[var(--bg-base)] px-4 py-3 text-xs">
                  <div className="mb-2 flex flex-wrap gap-3">
                    <span>
                      <strong className="text-[var(--text-primary)]">
                        {preview.matched_count.toLocaleString()}
                      </strong>{" "}
                      筆符合
                    </span>
                    <span>截止時間：{new Date(preview.cutoff_at).toLocaleString()}</span>
                    <span>保留 {preview.retention_days} 天</span>
                  </div>
                  {preview.sample.length > 0 ? (
                    <details>
                      <summary className="cursor-pointer text-[var(--text-secondary)]">
                        前 {preview.sample.length} 筆 sample（點開展開）
                      </summary>
                      <pre className="mt-2 max-h-64 overflow-auto rounded bg-[var(--bg-surface)] p-2 text-[10px] text-[var(--text-muted)]">
                        {JSON.stringify(preview.sample, null, 2)}
                      </pre>
                    </details>
                  ) : (
                    <p className="text-[var(--text-muted)]">無 sample（0 筆）</p>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]">
          <FileArchive size={18} aria-hidden />
          歸檔檔案
        </h2>
        <p className="text-xs text-[var(--text-muted)]">
          歸檔產出位置：<code>uploads/archives/</code>。每個檔案 .jsonl.gz 含完整紀錄與
          metadata header。要還原請聯絡工程師依檔案內容重建。
        </p>
        {archives.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">尚無歸檔檔案。</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[var(--text-secondary)]">
              <tr className="border-b border-[var(--border)]">
                <th className="py-2 text-left">路徑</th>
                <th className="py-2 text-right">大小</th>
                <th className="py-2 text-right">修改時間</th>
                <th className="py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {archives.map((a) => (
                <tr key={a.path} className="border-b border-[var(--border)]">
                  <td className="py-2 font-mono text-[10px]">{a.path}</td>
                  <td className="py-2 text-right">{fmtSize(a.size_bytes)}</td>
                  <td className="py-2 text-right">{new Date(a.modified_at).toLocaleString()}</td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onPreviewArchive(a.path)}
                      className="btn-sm btn-ghost mr-1">
                      <Eye size={12} aria-hidden />
                      預覽
                    </button>
                    <a
                      href={lifecycleApi.archiveDownloadUrl(a.path)}
                      className="btn-sm btn-primary inline-flex"
                      download>
                      <Download size={12} aria-hidden />
                      下載
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {archivePreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "var(--bg-overlay)" }}
          onClick={() => setArchivePreview(null)}
          role="dialog"
          aria-modal="true">
          <div
            className="max-h-[80vh] w-full max-w-3xl overflow-auto rounded-lg border p-5 shadow-xl"
            style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
            onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]">
              <Trash2 size={16} aria-hidden />
              歸檔內容 · {archivePreview.path}
            </h3>
            <p className="mb-2 text-xs text-[var(--text-muted)]">
              顯示前 {archivePreview.rows.length} 行（含 metadata header）
            </p>
            <pre className="rounded bg-[var(--bg-base)] p-2 text-[10px] text-[var(--text-muted)]">
              {JSON.stringify(archivePreview.rows, null, 2)}
            </pre>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setArchivePreview(null)}>
                關閉
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className="mt-6 flex items-start gap-2 rounded-md border px-4 py-3 text-xs"
        style={{
          background: "var(--warning-dim)",
          borderColor: "var(--warning-border)",
          color: "var(--warning)",
        }}
        role="status">
        <AlertTriangle size={14} aria-hidden className="mt-0.5 flex-shrink-0" />
        <span>
          所有執行都會寫入稽核軌跡（<code>/audit-logs</code>），下載歸檔檔案也會記錄。
          無法復原大量誤刪 → 從備份還原（見 <code>docs/INCIDENT_RUNBOOK.md</code>）。
        </span>
      </div>
    </main>
  );
}
