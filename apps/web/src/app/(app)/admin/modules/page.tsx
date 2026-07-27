"use client";

import { useCallback, useEffect, useState } from "react";
import { Boxes, RefreshCcw, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { usePermissions } from "@/hooks/usePermissions";
import { systemApi, type ModuleStatus, apiErrorMessage } from "@/lib/api";

const POLL_INTERVAL_MS = 5000;

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg-hover)] px-3 py-6 text-center text-sm text-[var(--text-muted)]">
      {text}
    </div>
  );
}

function StatusPill({ active, mode }: { active: boolean; mode?: string }) {
  if (!active) {
    return (
      <span className="inline-flex items-center rounded-md border border-[var(--success-border)] bg-[var(--success-dim)] px-2.5 py-1 text-xs font-medium text-[var(--success)]">
        正常
      </span>
    );
  }
  if (mode === "closed") {
    return (
      <span className="inline-flex items-center rounded-md border border-[var(--danger-border,var(--danger))] bg-[var(--danger-dim,#fee2e2)] px-2.5 py-1 text-xs font-medium text-[var(--danger)]">
        已關閉
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-md border border-[var(--warning-border,var(--warning))] bg-[var(--warning-dim,#fef3c7)] px-2.5 py-1 text-xs font-medium text-[var(--warning)]">
      維護中
    </span>
  );
}

export default function ModulesPage() {
  const { isAdmin } = usePermissions();
  const [modules, setModules] = useState<ModuleStatus[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      setModules(await systemApi.listModules());
    } catch (e) {
      toast.error(apiErrorMessage(e, "載入模組狀態失敗"));
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const setMaintenance = async (
    mod: ModuleStatus,
    on: boolean,
    mode: "maintenance" | "closed" = "maintenance",
  ) => {
    setBusy(mod.id);
    try {
      await systemApi.setModuleMaintenance(mod.id, {
        on,
        mode,
        reason: reasons[mod.id] ?? "",
      });
      toast.success(
        `${mod.label}：${!on ? "已恢復正常" : mode === "closed" ? "已關閉模組" : "已開啟維護"}`,
      );
      void load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "切換模組維護失敗"));
    } finally {
      setBusy(null);
    }
  };

  const restart = async (mod: ModuleStatus) => {
    if (!window.confirm(`重啟「${mod.label}」？將清除維護狀態並重置錯誤計數，立即恢復服務。`))
      return;
    setBusy(mod.id);
    try {
      await systemApi.restartModule(mod.id);
      toast.success(`${mod.label} 已重啟`);
      void load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "重啟模組失敗"));
    } finally {
      setBusy(null);
    }
  };

  const recover = async (mod: ModuleStatus) => {
    if (
      !window.confirm(
        `嘗試恢復「${mod.label}」？將清除升級計數器並執行 half-open 探測，通過後自動解除維護。`,
      )
    )
      return;
    setBusy(mod.id);
    try {
      const result = await systemApi.recoverModule(mod.id);
      if (result.recovered) {
        toast.success(`${mod.label} 已成功恢復`);
      } else if (result.probe_ok) {
        toast.warning(`${mod.label} 探測通過但需手動解除維護`);
      } else {
        toast.error(`${mod.label} 探測失敗：${result.probe_reason}`);
      }
      void load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "嘗試恢復失敗"));
    } finally {
      setBusy(null);
    }
  };

  const sourceLabel = (mod: ModuleStatus) =>
    !mod.on
      ? "正常"
      : mod.mode === "closed"
        ? "已關閉"
        : mod.source === "auto"
          ? "維護中（自動）"
          : "維護中（手動）";

  const severityLabel = (sev: string) =>
    sev === "CRITICAL" ? "🔴 嚴重" : sev === "HIGH" ? "🟠 高" : "🟡 一般";

  const stateControls = (mod: ModuleStatus) => (
    <div
      className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg-hover)] p-1"
      role="group"
      aria-label={`${mod.label}模組狀態`}
    >
      {(
        [
          { label: "正常", on: false, mode: "maintenance" },
          { label: "維護", on: true, mode: "maintenance" },
          { label: "關閉", on: true, mode: "closed" },
        ] as const
      ).map((option) => {
        const selected =
          option.on === mod.on && (!option.on || option.mode === mod.mode);
        return (
          <button
            key={option.label}
            type="button"
            onClick={() => setMaintenance(mod, option.on, option.mode)}
            disabled={busy === mod.id || selected}
            aria-pressed={selected}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-default"
            style={{
              background: selected
                ? option.mode === "closed"
                  ? "var(--danger)"
                  : option.on
                    ? "var(--warning)"
                    : "var(--success)"
                : "transparent",
              color: selected ? "#fff" : "var(--text-secondary)",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );

  const abnormalCount = modules.filter((m) => m.on).length;

  if (!isAdmin) return null;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-[var(--primary-dim)] text-[var(--primary)]">
            <Boxes size={20} aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">模組維護</h1>
            <p className="text-sm text-[var(--text-muted)]">
              管理各功能模組的上線狀態與健康監控
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {abnormalCount > 0 && (
            <span className="rounded-full bg-[var(--warning-dim,#fef3c7)] px-3 py-1 text-xs font-medium text-[var(--warning)]">
              {abnormalCount} 個模組異常
            </span>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="btn btn-ghost text-xs"
          >
            <RefreshCcw size={13} aria-hidden className={loading ? "animate-spin" : ""} />
            重新整理
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 text-xs text-[var(--text-muted)] leading-relaxed">
        可將單一功能模組設為<strong className="text-[var(--text-secondary)]">維護</strong>或直接
        <strong className="text-[var(--text-secondary)]">關閉</strong>。
        關閉時會隱藏相關導覽，直接連結也只顯示「系統關閉中」；
        維護時只有該模組的 API 與頁面停用，平台其他功能不受影響。
        模組大量錯誤時會自動進入維護（自動，冷卻時間指數退避），冷卻後 half-open 探測通過自動恢復；
        1h 內累計跳閘 3–7 次（依嚴重度）會升級為手動維護，需「嘗試恢復」或「重啟」介入。
      </div>

      {modules.length === 0 ? (
        <EmptyRow text={loading ? "載入中…" : "沒有可管理的模組。"} />
      ) : (
        <>
          {/* 手機版卡片 */}
          <div className="grid gap-3 md:hidden">
            {modules.map((mod) => (
              <article
                key={mod.id}
                className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-medium text-[var(--text-primary)]">{mod.label}</h3>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">{sourceLabel(mod)}</p>
                  </div>
                  <StatusPill active={mod.on} mode={mod.mode} />
                </div>
                <div className="mt-4">{stateControls(mod)}</div>
                <div className="mt-3">
                  <input
                    type="text"
                    value={reasons[mod.id] ?? mod.reason ?? ""}
                    onChange={(e) =>
                      setReasons((prev) => ({ ...prev, [mod.id]: e.target.value }))
                    }
                    placeholder="例如：資料異常修復中（維護原因選填）"
                    className="input w-full text-xs"
                  />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
                  <span>近 60s 5xx：{mod.recent_5xx_count}</span>
                  <span>1h 跳閘：{mod.trip_count}</span>
                  <span>
                    嚴重度：{mod.trip_count > 0 ? severityLabel(mod.max_severity) : "—"}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {mod.on && mod.mode !== "closed" && (
                    <button
                      type="button"
                      onClick={() => recover(mod)}
                      disabled={busy === mod.id}
                      className="btn-sm btn-primary"
                    >
                      <RotateCcw size={13} aria-hidden />
                      嘗試恢復
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => restart(mod)}
                    disabled={busy === mod.id}
                    className="btn-sm btn-ghost"
                  >
                    <RotateCcw size={13} aria-hidden />
                    重啟
                  </button>
                </div>
              </article>
            ))}
          </div>

          {/* 桌面版表格 */}
          <div className="hidden overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-sm md:block">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="border-b border-[var(--border)] bg-[var(--bg-hover)] text-xs text-[var(--text-muted)]">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">模組</th>
                  <th className="px-4 py-3 text-left font-medium">狀態</th>
                  <th className="px-4 py-3 text-right font-medium">近 60s 5xx</th>
                  <th className="px-4 py-3 text-right font-medium">1h 跳閘</th>
                  <th className="px-4 py-3 text-left font-medium">最高嚴重度</th>
                  <th className="px-4 py-3 text-left font-medium">維護原因（選填）</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {modules.map((mod) => (
                  <tr
                    key={mod.id}
                    className={`align-middle transition-colors hover:bg-[var(--bg-hover)] ${mod.on ? "bg-[var(--bg-hover)]" : ""}`}
                  >
                    <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                      <div>{mod.label}</div>
                      <div className="text-xs font-normal text-[var(--text-muted)]">
                        {sourceLabel(mod)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-2">
                        <StatusPill active={mod.on} mode={mod.mode} />
                        {stateControls(mod)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--text-secondary)]">
                      {mod.recent_5xx_count}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--text-secondary)]">
                      {mod.trip_count}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                      {mod.trip_count > 0 ? severityLabel(mod.max_severity) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={reasons[mod.id] ?? mod.reason ?? ""}
                        onChange={(e) =>
                          setReasons((prev) => ({ ...prev, [mod.id]: e.target.value }))
                        }
                        placeholder="例如：資料異常修復中"
                        className="input w-full"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-2">
                        {mod.on && mod.mode !== "closed" && (
                          <button
                            type="button"
                            onClick={() => recover(mod)}
                            disabled={busy === mod.id}
                            className="btn-sm btn-primary"
                            title="清計數器並嘗試探測恢復"
                          >
                            <RotateCcw size={13} aria-hidden />
                            嘗試恢復
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => restart(mod)}
                          disabled={busy === mod.id}
                          className="btn-sm btn-ghost"
                          title="清除所有維護狀態並重置錯誤計數"
                        >
                          <RotateCcw size={13} aria-hidden />
                          重啟
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
