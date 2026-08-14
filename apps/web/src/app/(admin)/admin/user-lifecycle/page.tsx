"use client";

import { useCallback, useState } from "react";
import { AlertTriangle, GraduationCap, Lock, RefreshCcw, Search, ShieldOff, UserCheck } from "lucide-react";
import { toast } from "sonner";

import { usePermissions } from "@/hooks/usePermissions";
import {
  userLifecycleApi,
  type LifecycleStatus, apiErrorMessage } from "@/lib/api";

type ActionKind = "freeze" | "archive_alumni" | "restore";

const ACTION_LABEL: Record<ActionKind, string> = {
  freeze: "凍結帳號（停所有任期）",
  archive_alumni: "校友歸檔",
  restore: "解凍 / 恢復",
};

export default function UserLifecyclePage() {
  const { isAdmin } = usePermissions();
  const [userId, setUserId] = useState("");
  const [status, setStatus] = useState<LifecycleStatus | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    const uid = userId.trim();
    if (!uid) {
      toast.error("請填入使用者 UUID");
      return;
    }
    setBusy(true);
    try {
      const s = await userLifecycleApi.status(uid);
      setStatus(s);
    } catch (e) {
      toast.error(apiErrorMessage(e, "讀取失敗"));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }, [userId]);

  const runAction = async (action: ActionKind) => {
    const uid = userId.trim();
    if (!uid) {
      toast.error("請填入使用者 UUID");
      return;
    }
    if (!status) {
      toast.error("請先「載入狀態」確認對象");
      return;
    }
    const confirmInput = window.prompt(
      `即將對 ${status.email} 執行：${ACTION_LABEL[action]}\n` +
        `當前 active 任期：${status.active_positions.length} 個\n\n` +
        `${action === "restore" ? "" : "此動作會結束所有 active 任期。"}\n` +
        `請輸入「確認」以繼續：`,
    );
    if (confirmInput?.trim() !== "確認") {
      toast.info("已取消");
      return;
    }
    setBusy(true);
    try {
      const fn = {
        freeze: userLifecycleApi.freeze,
        archive_alumni: userLifecycleApi.archiveAlumni,
        restore: userLifecycleApi.restore,
      }[action];
      const r = await fn(uid, reason);
      toast.success(
        `完成 ${ACTION_LABEL[action]}：影響 ${r.affected_positions} 個任期`,
      );
      await loadStatus();
    } catch (e) {
      toast.error(apiErrorMessage(e, "操作失敗"));
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

  return (
    <main className="mx-auto max-w-5xl p-4 md:p-6">
      <header className="mb-5">
        <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
          <GraduationCap size={14} aria-hidden />
          學籍 / 帳號生命週期
        </div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">學籍異動</h1>
        <p className="mt-1 max-w-3xl text-xs text-[var(--text-muted)]">
          凍結 / 校友歸檔 / 解凍個別使用者帳號。所有操作會結束 active 任期但保留 audit
          痕跡。需「假名化」請走 <code>/admin/privacy</code>。
        </p>
      </header>

      <section
        className="mb-4 rounded-lg border bg-[var(--bg-surface)] p-4"
        style={{ borderColor: "var(--border)" }}>
        <div className="mb-3 flex flex-wrap gap-2">
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="使用者 UUID（從 /admin/permissions 找）"
            className="input min-w-[24rem] flex-1 font-mono text-xs"
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={loadStatus}
            disabled={busy || !userId.trim()}>
            <Search size={14} aria-hidden />
            載入狀態
          </button>
        </div>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--text-secondary)]">原因（會寫入 audit log）</span>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例：畢業 / 退學 / 轉系 / 申請凍結"
            className="input"
          />
        </label>
      </section>

      {status && (
        <section
          className="mb-4 rounded-lg border bg-[var(--bg-surface)] p-4"
          style={{ borderColor: "var(--border)" }}>
          <div className="mb-3 flex items-start justify-between">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {status.display_name}
              </h2>
              <p className="text-xs text-[var(--text-muted)]">{status.email}</p>
            </div>
            <div className="text-right text-xs">
              <div
                className="inline-block rounded px-2 py-0.5"
                style={{
                  background: status.is_active
                    ? "var(--success-dim)"
                    : "var(--warning-dim)",
                  color: status.is_active ? "var(--success)" : "var(--warning)",
                }}>
                {status.is_active ? "啟用中" : "已凍結"}
              </div>
              <div className="mt-1 text-[var(--text-muted)]">
                Active 任期：{status.active_positions.length}
              </div>
            </div>
          </div>

          {status.active_positions.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">
                列出 active 任期
              </summary>
              <table className="mt-2 w-full text-[11px]">
                <thead className="text-[var(--text-secondary)]">
                  <tr className="border-b border-[var(--border)]">
                    <th className="py-1 text-left">user_position_id</th>
                    <th className="py-1 text-left">position_id</th>
                    <th className="py-1 text-left">起</th>
                    <th className="py-1 text-left">迄</th>
                  </tr>
                </thead>
                <tbody>
                  {status.active_positions.map((p) => (
                    <tr key={p.user_position_id} className="border-b border-[var(--border)]">
                      <td className="py-1 font-mono">{p.user_position_id.slice(0, 8)}</td>
                      <td className="py-1 font-mono">{p.position_id.slice(0, 8)}</td>
                      <td className="py-1">{p.start_date}</td>
                      <td className="py-1">{p.end_date ?? "—（無限期）"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">無 active 任期。</p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => runAction("freeze")}
              disabled={busy || !status.is_active}>
              <ShieldOff size={14} aria-hidden />
              凍結
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => runAction("archive_alumni")}
              disabled={busy}>
              <GraduationCap size={14} aria-hidden />
              校友歸檔
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => runAction("restore")}
              disabled={busy || status.is_active}>
              <UserCheck size={14} aria-hidden />
              解凍 / 恢復
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={loadStatus}
              disabled={busy}>
              <RefreshCcw size={14} aria-hidden />
              重新讀取
            </button>
          </div>
        </section>
      )}

      <div
        className="flex items-start gap-2 rounded-md border px-4 py-3 text-xs"
        style={{
          background: "var(--warning-dim)",
          borderColor: "var(--warning-border)",
          color: "var(--warning)",
        }}>
        <AlertTriangle size={14} aria-hidden className="mt-0.5 flex-shrink-0" />
        <span>
          解凍只恢復 <code>is_active</code> 標記，**不會重建已結束的任期**；
          需請使用者重新指派職位請走 <code>/admin/permissions</code>。
        </span>
      </div>
    </main>
  );
}
