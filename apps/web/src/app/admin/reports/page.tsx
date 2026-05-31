"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3, Download, Eye, Lock, RefreshCcw } from "lucide-react";
import { toast } from "sonner";

import { usePermissions } from "@/hooks/usePermissions";
import {
  ApiError,
  reportsApi,
  type ReportResult,
  type ReportSummary,
} from "@/lib/api";

export default function ReportsPage() {
  const { isAdmin } = usePermissions();
  const [list, setList] = useState<ReportSummary[]>([]);
  const [active, setActive] = useState<ReportResult | null>(null);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const r = await reportsApi.list();
      setList(r);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "讀取報表列表失敗");
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void loadList();
  }, [isAdmin, loadList]);

  const runOne = async (id: string) => {
    setBusy(true);
    try {
      const r = await reportsApi.run(id);
      setActive(r);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "執行失敗");
    } finally {
      setBusy(false);
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

  const columns = active && active.rows.length > 0 ? Object.keys(active.rows[0]) : [];

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-6">
      <header className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
            <BarChart3 size={14} aria-hidden />
            預寫常用報表（10）
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">常用報表</h1>
          <p className="mt-1 max-w-3xl text-xs text-[var(--text-muted)]">
            平台預設的 10 個 read-only 查詢；點報表執行後可下載 CSV（含 UTF-8 BOM，Excel
            直接開啟中文不亂碼）。
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={loadList}>
          <RefreshCcw size={16} aria-hidden />
          重新整理
        </button>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[18rem_1fr]">
        <aside className="space-y-2">
          {list.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => runOne(r.id)}
              disabled={busy}
              className={`w-full rounded-lg border p-3 text-left text-xs transition ${
                active?.id === r.id ? "border-[var(--primary)]" : ""
              }`}
              style={{
                background: "var(--bg-surface)",
                borderColor: active?.id === r.id ? "var(--primary)" : "var(--border)",
              }}>
              <div className="font-semibold text-[var(--text-primary)]">{r.label}</div>
              <div className="mt-1 text-[var(--text-muted)]">{r.description}</div>
            </button>
          ))}
        </aside>

        <section
          className="rounded-lg border bg-[var(--bg-surface)] p-4"
          style={{ borderColor: "var(--border)" }}>
          {!active ? (
            <p className="text-sm text-[var(--text-muted)]">
              <Eye size={14} aria-hidden className="mr-1 inline" />
              從左側挑一個報表執行。
            </p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  {active.label}{" "}
                  <span className="text-xs text-[var(--text-muted)]">
                    ({active.row_count} 筆)
                  </span>
                </h2>
                <a
                  href={reportsApi.csvUrl(active.id)}
                  className="btn-sm btn-primary inline-flex"
                  download>
                  <Download size={12} aria-hidden />
                  下載 CSV
                </a>
              </div>
              {active.rows.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">無資料。</p>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-[11px]">
                    <thead className="text-[var(--text-secondary)]">
                      <tr className="border-b border-[var(--border)]">
                        {columns.map((c) => (
                          <th key={c} className="px-2 py-1 text-left whitespace-nowrap">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {active.rows.map((row, i) => (
                        <tr key={i} className="border-b border-[var(--border)]">
                          {columns.map((c) => (
                            <td key={c} className="px-2 py-1 align-top">
                              {formatCell(row[c])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "是" : "否";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
