"use client";

import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarRange,
  Eye,
  Lock,
  Play,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

import { usePermissions } from "@/hooks/usePermissions";
import {
  ApiError,
  termRolloverApi,
  type DryRunBody,
  type DryRunOut,
  type ExecuteRolloverOut,
  type NewAssignmentIn,
} from "@/lib/api";

const SAMPLE_ASSIGNMENTS = `# 每行一筆，欄位以 tab 或逗號分隔：
# user_id, position_id, start_date(YYYY-MM-DD), end_date(空白=無期限)
# 範例：
# 00000000-0000-0000-0000-000000000001, 00000000-0000-0000-0000-00000000aaa1, 2026-08-01,
`;

function parseAssignments(text: string): { rows: NewAssignmentIn[]; errors: string[] } {
  const rows: NewAssignmentIn[] = [];
  const errors: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  for (const [i, line] of lines.entries()) {
    const parts = line.split(/[\t,]/).map((p) => p.trim());
    if (parts.length < 3) {
      errors.push(`第 ${i + 1} 行欄位不足（需至少 3 欄）`);
      continue;
    }
    const [user_id, position_id, start_date, end_date_raw] = parts;
    if (!user_id || !position_id || !start_date) {
      errors.push(`第 ${i + 1} 行有空欄位`);
      continue;
    }
    rows.push({
      user_id,
      position_id,
      start_date,
      end_date: end_date_raw ? end_date_raw : null,
    });
  }
  return { rows, errors };
}

export default function TermRolloverPage() {
  const { isAdmin } = usePermissions();
  const [newTermStart, setNewTermStart] = useState("");
  const [terminateActive, setTerminateActive] = useState(true);
  const [assignmentsText, setAssignmentsText] = useState(SAMPLE_ASSIGNMENTS);
  const [dryRunResult, setDryRunResult] = useState<DryRunOut | null>(null);
  const [executeResult, setExecuteResult] = useState<ExecuteRolloverOut | null>(null);
  const [busy, setBusy] = useState(false);

  const { rows: assignments, errors: parseErrors } = useMemo(
    () => parseAssignments(assignmentsText),
    [assignmentsText],
  );

  const buildBody = useCallback((): DryRunBody | null => {
    if (!newTermStart) {
      toast.error("請填入新任期起始日");
      return null;
    }
    return {
      new_term_start: newTermStart,
      new_assignments: assignments,
      terminate_active_before: terminateActive,
    };
  }, [newTermStart, assignments, terminateActive]);

  const onDryRun = async () => {
    const body = buildBody();
    if (!body) return;
    if (parseErrors.length > 0) {
      toast.error(`試算表解析失敗：${parseErrors[0]}`);
      return;
    }
    setBusy(true);
    try {
      const r = await termRolloverApi.dryRun(body);
      setDryRunResult(r);
      setExecuteResult(null);
      toast.success(
        `預覽：結束 ${r.summary.terminations} 個、新增 ${r.summary.new_assignments} 個` +
          (r.summary.warnings ? `（警告 ${r.summary.warnings}）` : ""),
      );
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "預覽失敗");
    } finally {
      setBusy(false);
    }
  };

  const onExecute = async () => {
    const body = buildBody();
    if (!body) return;
    if (!dryRunResult) {
      toast.error("請先 dry-run 預覽");
      return;
    }
    if (dryRunResult.warnings.length > 0) {
      toast.error("仍有警告未解決，請先修正試算表");
      return;
    }
    const confirmInput = window.prompt(
      `即將執行換屆：\n` +
        `結束 ${dryRunResult.summary.terminations} 個任期\n` +
        `新增 ${dryRunResult.summary.new_assignments} 個任期\n` +
        `新任期起：${dryRunResult.new_term_start}\n\n` +
        `此動作可透過 batch_id rollback，但請務必確認試算表正確。\n` +
        `請輸入「換屆」以確認：`,
    );
    if (confirmInput?.trim() !== "換屆") {
      toast.info("已取消");
      return;
    }
    setBusy(true);
    try {
      const r = await termRolloverApi.execute(body, "換屆");
      setExecuteResult(r);
      toast.success(`完成 batch=${r.batch_id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "執行失敗");
    } finally {
      setBusy(false);
    }
  };

  const onRollback = async () => {
    if (!executeResult) return;
    const confirmInput = window.prompt(
      `即將復原 batch ${executeResult.batch_id}：\n` +
        `會把所有結束的任期 end_date 還原，並刪除剛建立的 ${executeResult.created_count} 個新任期。\n` +
        `請輸入「復原」以確認：`,
    );
    if (confirmInput?.trim() !== "復原") {
      toast.info("已取消");
      return;
    }
    setBusy(true);
    try {
      const r = await termRolloverApi.rollback(executeResult.batch_id, "復原");
      toast.success(
        `已復原：恢復 ${r.restored_terminations} 個任期、刪除 ${r.deleted_new_assignments} 個新任期`,
      );
      setExecuteResult(null);
      setDryRunResult(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "復原失敗");
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
    <main className="mx-auto max-w-6xl p-4 md:p-6">
      <header className="mb-5">
        <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
          <CalendarRange size={14} aria-hidden />
          換屆精靈
        </div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">換屆精靈</h1>
        <p className="mt-1 max-w-3xl text-xs text-[var(--text-muted)]">
          批次結束舊一屆任期、建立新一屆任期。永遠先「預覽」確認所有變更，再執行。
          執行後可用 batch_id 復原。詳細 SOP：<code>docs/TERM_ROLLOVER_SOP.md</code>。
        </p>
      </header>

      <section
        className="mb-4 grid grid-cols-1 gap-3 rounded-lg border bg-[var(--bg-surface)] p-4 md:grid-cols-[14rem_1fr]"
        style={{ borderColor: "var(--border)" }}>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--text-secondary)]">新任期起始日</span>
          <input
            type="date"
            value={newTermStart}
            onChange={(e) => setNewTermStart(e.target.value)}
            className="input"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={terminateActive}
              onChange={(e) => setTerminateActive(e.target.checked)}
              className="mr-2"
            />
            同時結束「新任期起始日」之前已生效的所有任期
          </span>
          <span className="text-[var(--text-muted)]">
            勾選後，已生效任期的 end_date 會設為新任期起始日 - 1 天。取消後只新增不結束。
          </span>
        </label>
      </section>

      <section
        className="mb-4 rounded-lg border bg-[var(--bg-surface)] p-4"
        style={{ borderColor: "var(--border)" }}>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--text-secondary)]">
            新任期試算表（已解析 {assignments.length} 筆
            {parseErrors.length > 0 ? `；錯誤 ${parseErrors.length} 筆` : ""}）
          </span>
          <textarea
            value={assignmentsText}
            onChange={(e) => setAssignmentsText(e.target.value)}
            rows={10}
            className="input font-mono text-[11px]"
            spellCheck={false}
          />
        </label>
        {parseErrors.length > 0 && (
          <div className="mt-2 text-xs text-[var(--danger)]">
            {parseErrors.map((err, i) => (
              <div key={i}>• {err}</div>
            ))}
          </div>
        )}
      </section>

      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost" onClick={onDryRun} disabled={busy}>
          <Eye size={14} aria-hidden />
          預覽
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onExecute}
          disabled={busy || !dryRunResult || dryRunResult.warnings.length > 0}>
          <Play size={14} aria-hidden />
          執行換屆
        </button>
        {executeResult && (
          <button type="button" className="btn btn-danger" onClick={onRollback} disabled={busy}>
            <RotateCcw size={14} aria-hidden />
            復原此次（{executeResult.batch_id}）
          </button>
        )}
      </div>

      {dryRunResult && (
        <section
          className="mb-4 rounded-lg border bg-[var(--bg-surface)] p-4"
          style={{ borderColor: "var(--border)" }}>
          <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
            預覽結果
          </h2>
          <div className="mb-3 flex flex-wrap gap-3 text-xs">
            <span>新任期起：{dryRunResult.new_term_start}</span>
            <span>將結束：{dryRunResult.summary.terminations}</span>
            <span>將新增：{dryRunResult.summary.new_assignments}</span>
            <span
              className={
                dryRunResult.warnings.length > 0 ? "text-[var(--danger)]" : ""
              }>
              警告：{dryRunResult.warnings.length}
            </span>
          </div>

          {dryRunResult.warnings.length > 0 && (
            <div
              className="mb-3 rounded-md border px-3 py-2 text-xs"
              style={{
                background: "var(--danger-dim)",
                borderColor: "var(--danger-border)",
                color: "var(--danger)",
              }}>
              <AlertTriangle size={12} aria-hidden className="mr-1 inline" />
              修正以下警告才能執行：
              <ul className="mt-1 ml-4 list-disc">
                {dryRunResult.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <details className="mb-2">
            <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">
              將結束的任期（{dryRunResult.terminations.length}）
            </summary>
            <table className="mt-2 w-full text-[11px]">
              <thead className="text-[var(--text-secondary)]">
                <tr className="border-b border-[var(--border)]">
                  <th className="py-1 text-left">使用者</th>
                  <th className="py-1 text-left">職位</th>
                  <th className="py-1 text-left">原 end_date</th>
                  <th className="py-1 text-left">將設為</th>
                </tr>
              </thead>
              <tbody>
                {dryRunResult.terminations.map((t) => (
                  <tr key={t.user_position_id} className="border-b border-[var(--border)]">
                    <td className="py-1">{t.user_email ?? t.user_id.slice(0, 8)}</td>
                    <td className="py-1">
                      {t.position_name}（{t.org_name}）
                    </td>
                    <td className="py-1">{t.current_end_date ?? "—（無限期）"}</td>
                    <td className="py-1">{t.new_end_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>

          <details>
            <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">
              將新增的任期（{dryRunResult.new_assignments.length}）
            </summary>
            <table className="mt-2 w-full text-[11px]">
              <thead className="text-[var(--text-secondary)]">
                <tr className="border-b border-[var(--border)]">
                  <th className="py-1 text-left">使用者</th>
                  <th className="py-1 text-left">職位</th>
                  <th className="py-1 text-left">起</th>
                  <th className="py-1 text-left">迄</th>
                  <th className="py-1 text-left">警告</th>
                </tr>
              </thead>
              <tbody>
                {dryRunResult.new_assignments.map((a, i) => (
                  <tr key={i} className="border-b border-[var(--border)]">
                    <td className="py-1">{a.user_email ?? a.user_id.slice(0, 8)}</td>
                    <td className="py-1">
                      {a.position_name}（{a.org_name}）
                    </td>
                    <td className="py-1">{a.start_date}</td>
                    <td className="py-1">{a.end_date ?? "—"}</td>
                    <td className="py-1 text-[var(--danger)]">{a.warning ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
      )}

      {executeResult && (
        <div
          className="rounded-md border px-4 py-3 text-xs"
          style={{
            background: "var(--success-dim)",
            borderColor: "var(--success-border)",
            color: "var(--success)",
          }}>
          ✅ 換屆完成 · batch_id <code>{executeResult.batch_id}</code> · 結束{" "}
          {executeResult.terminated_count} 個任期 · 新增 {executeResult.created_count}{" "}
          個任期 ·{" "}
          <span className="text-[var(--text-secondary)]">
            如需復原，請按上方「復原此次」按鈕（建議 24 小時內處理）
          </span>
        </div>
      )}
    </main>
  );
}
