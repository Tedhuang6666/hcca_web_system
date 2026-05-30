"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Info, Lock, RefreshCcw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { usePermissions } from "@/hooks/usePermissions";
import { ApiError, trashApi, type TrashEntry } from "@/lib/api";

const DAYS_OPTIONS = [1, 3, 7, 14, 30, 90];

export default function TrashPage() {
  const { isAdmin } = usePermissions();
  const [rows, setRows] = useState<TrashEntry[]>([]);
  const [days, setDays] = useState(7);
  const [entityType, setEntityType] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<TrashEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const items = await trashApi.list({
        days,
        entity_type: entityType.trim() || undefined,
        limit: 200,
      });
      setRows(items);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "讀取失敗");
    } finally {
      setLoading(false);
    }
  }, [days, entityType]);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

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
      <header className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
            <Trash2 size={14} aria-hidden />
            誤刪救援
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">誤刪救援</h1>
          <p className="mt-1 max-w-3xl text-xs text-[var(--text-muted)]">
            列出最近 N 天稽核軌跡中的刪除類事件。要還原必須由工程師依事件內容處理，
            因每種資源（公文 / 法規 / 組織 / 訂單）的恢復流程不同。
          </p>
        </div>
        <button type="button" onClick={load} className="btn btn-ghost" disabled={loading}>
          <RefreshCcw size={16} aria-hidden />
          {loading ? "讀取中…" : "重新整理"}
        </button>
      </header>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border bg-[var(--bg-surface)] p-3"
        style={{ borderColor: "var(--border)" }}>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--text-secondary)]">時間範圍</span>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="input w-32">
            {DAYS_OPTIONS.map((d) => (
              <option key={d} value={d}>
                過去 {d} 天
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--text-secondary)]">entity_type（選填）</span>
          <input
            type="text"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            placeholder="例：document / announcement / org"
            className="input w-72"
          />
        </label>
        <button type="button" onClick={load} className="btn btn-primary" disabled={loading}>
          <Search size={14} aria-hidden />
          查詢
        </button>
      </div>

      <div
        className="mb-4 flex items-start gap-2 rounded-md border px-4 py-3 text-xs"
        style={{
          background: "var(--info-dim, var(--bg-surface))",
          borderColor: "var(--border)",
          color: "var(--text-secondary)",
        }}>
        <Info size={14} aria-hidden className="mt-0.5 flex-shrink-0" />
        <span>
          顯示 action 包含 delete / remove / purge / discard / withdraw / archive / soft_delete
          關鍵字的稽核紀錄。**還原**需要工程師：把 entity_type + entity_id +
          meta 提供給工程師，由其依資源狀態手動重建。
        </span>
      </div>

      <section className="overflow-hidden rounded-lg border bg-[var(--bg-surface)]"
        style={{ borderColor: "var(--border)" }}>
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-[var(--text-muted)]">
            無符合的刪除事件。
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[var(--text-secondary)]">
              <tr className="border-b border-[var(--border)] bg-[var(--bg-base)]">
                <th className="px-3 py-2 text-left">時間</th>
                <th className="px-3 py-2 text-left">資源</th>
                <th className="px-3 py-2 text-left">動作</th>
                <th className="px-3 py-2 text-left">操作者</th>
                <th className="px-3 py-2 text-left">摘要</th>
                <th className="px-3 py-2 text-right">詳情</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.audit_id} className="border-b border-[var(--border)]">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <code>{r.entity_type}</code>
                    <span className="ml-1 text-[10px] text-[var(--text-muted)]">
                      {r.entity_id.slice(0, 8)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <code className="rounded bg-[var(--bg-base)] px-1 py-0.5 text-[10px]">
                      {r.action}
                    </code>
                  </td>
                  <td className="px-3 py-2 text-[var(--text-secondary)]">
                    {r.actor_email ?? <span className="text-[var(--text-muted)]">—</span>}
                  </td>
                  <td className="px-3 py-2 text-[var(--text-secondary)]">{r.summary ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setSelected(r)}
                      className="btn-sm btn-ghost">
                      展開
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "var(--bg-overlay)" }}
          onClick={() => setSelected(null)}
          role="dialog"
          aria-modal="true">
          <div
            className="max-h-[80vh] w-full max-w-3xl overflow-auto rounded-lg border p-5 shadow-xl"
            style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
            onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 text-base font-semibold text-[var(--text-primary)]">
              事件詳情
            </h3>
            <dl className="grid grid-cols-[6rem_1fr] gap-1 text-xs">
              <dt className="text-[var(--text-secondary)]">時間</dt>
              <dd>{new Date(selected.created_at).toLocaleString()}</dd>
              <dt className="text-[var(--text-secondary)]">資源</dt>
              <dd>
                <code>{selected.entity_type}</code> · <code>{selected.entity_id}</code>
              </dd>
              <dt className="text-[var(--text-secondary)]">動作</dt>
              <dd>
                <code>{selected.action}</code>
              </dd>
              <dt className="text-[var(--text-secondary)]">操作者</dt>
              <dd>{selected.actor_email ?? "—"}</dd>
              <dt className="text-[var(--text-secondary)]">摘要</dt>
              <dd>{selected.summary ?? "—"}</dd>
            </dl>
            <div className="mt-3">
              <div className="text-xs text-[var(--text-secondary)]">meta（提供給工程師還原時用）</div>
              <pre className="mt-1 max-h-72 overflow-auto rounded bg-[var(--bg-base)] p-2 text-[10px] text-[var(--text-muted)]">
                {JSON.stringify(selected.meta, null, 2)}
              </pre>
            </div>
            <div
              className="mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-[11px]"
              style={{
                background: "var(--warning-dim)",
                borderColor: "var(--warning-border)",
                color: "var(--warning)",
              }}>
              <AlertTriangle size={12} aria-hidden className="mt-0.5 flex-shrink-0" />
              <span>
                還原請複製此事件的 entity_type / entity_id / meta 給工程師。本頁不提供 1-click
                還原以避免外鍵衝突與狀態機破壞。
              </span>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setSelected(null)}>
                關閉
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
