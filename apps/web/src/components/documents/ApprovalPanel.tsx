"use client";
import { useState } from "react";
import { apiErrorMessage } from "@/lib/api-helpers";
import type { ApprovalStepOut } from "@/lib/types";
import type { UserSummary } from "@/lib/api";

const STATUS_ICON: Record<string, React.ReactElement> = {
  approved: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  rejected: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  pending: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  waiting: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  ),
};

const STATUS_STYLE: Record<
  string,
  { colorClass: string; bgClass: string; borderColorClass: string; borderSoftClass: string }
> = {
  approved: {
    colorClass: "text-success!",
    bgClass: "bg-success-soft!",
    borderColorClass: "border-success!",
    borderSoftClass: "border-success-soft!",
  },
  rejected: {
    colorClass: "text-danger!",
    bgClass: "bg-danger-soft!",
    borderColorClass: "border-danger!",
    borderSoftClass: "border-danger-soft!",
  },
  pending: {
    colorClass: "text-warning!",
    bgClass: "bg-warning-soft!",
    borderColorClass: "border-warning!",
    borderSoftClass: "border-warning-soft!",
  },
  waiting: {
    colorClass: "text-fg-muted!",
    bgClass: "bg-elevated!",
    borderColorClass: "border-fg-muted!",
    borderSoftClass: "border-elevated!",
  },
};

const STATUS_LABEL: Record<string, string> = {
  approved: "已核准", rejected: "已退件", pending: "審核中", waiting: "等待中",
};

function formatStepActor(step: ApprovalStepOut) {
  if (!step.delegate) {
    return {
      primary: step.approver.name,
      secondary: step.approver_title ?? null,
    };
  }
  const principal = step.approver_title
    ? `${step.approver.name}（${step.approver_title}）`
    : step.approver.name;
  const delegate = step.delegate_title
    ? `${step.delegate.name}（${step.delegate_title}）`
    : step.delegate.name;
  return {
    primary: `${principal}假 ${delegate}代`,
    secondary: step.delegate_source === "assignment" ? "請假代行職權" : "手動指定代理",
  };
}

// ── 代理人選取器（簡易下拉搜尋）─────────────────────────────────────────────

function DelegatePicker({
  step, users, currentDelegate,
  loading,
  onSetDelegate, onClose,
}: {
  step: ApprovalStepOut;
  users: UserSummary[];
  loading: boolean;
  currentDelegate: string | null;
  onSetDelegate: (stepOrder: number, delegateId: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(currentDelegate);

  const filtered = users.filter(u =>
    u.id !== step.approver.id &&  // 不能指定自己
    (u.display_name.toLowerCase().includes(search.toLowerCase()) ||
     u.email.toLowerCase().includes(search.toLowerCase()))
  );

  const handleSave = async () => {
    setSaving(true);
    try { await onSetDelegate(step.step_order, selectedId); onClose(); }
    finally { setSaving(false); }
  };

  return (
    <div className="mt-2 space-y-3 rounded-xl border border-border-strong! bg-surface! p-4 sm:p-3"
      >
      <p className="text-sm font-medium text-fg-muted!" >
        設定代理人（代理人可代為審核此步驟）
      </p>
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="搜尋姓名或 Email…"
        className="input min-h-11 w-full bg-transparent px-3 text-sm border border-border!"

      />
      <div className="max-h-48 overflow-y-auto space-y-1">
        {/* 清除代理人 */}
        <button
          onClick={() => setSelectedId(null)}
          className={"flex min-h-11 w-full items-center gap-2 rounded px-2 py-2 text-left text-xs transition-colors " + ((selectedId === null ? "bg-accent-soft! border border-border-strong!" : "bg-elevated! border border-transparent!"))}
          >
          <span className="w-4 h-4 text-center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>
          <span className="text-fg-muted!">不指定代理人</span>
        </button>
        {loading ? (
          <p className="px-2 py-3 text-xs text-fg-muted!" role="status" >
            正在載入使用者…
          </p>
        ) : filtered.slice(0, 20).map(u => (
          <button
            key={u.id}
            onClick={() => setSelectedId(u.id)}
            className={"w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors " + ((selectedId === u.id ? "bg-accent-soft! border border-border-strong!" : "bg-elevated! border border-transparent!"))}
            >
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 bg-accent-soft! text-accent-text!"
              >
              {u.display_name.charAt(0)}
            </span>
            <div className="flex-1 min-w-0">
              <p className="truncate text-fg-primary!" >{u.display_name}</p>
              <p className="truncate text-fg-muted!" >{u.email}</p>
            </div>
            {selectedId === u.id && <span className="text-accent-text!">✓</span>}
          </button>
        ))}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button onClick={onClose} className="min-h-11 px-3 text-sm text-fg-muted!"
          >取消</button>
        <button onClick={handleSave} disabled={saving}
          className="min-h-11 px-4 text-sm font-medium disabled:opacity-50 bg-accent-soft! text-accent-text! border border-border-strong!"
          >
          {saving ? "儲存中…" : "確認"}
        </button>
      </div>
    </div>
  );
}

// ── 主元件 ────────────────────────────────────────────────────────────────────

export function ApprovalPanel({
  steps, canApprove, currentUserId, allUsers,
  onLoadUsers, onApprove, onReject, onSetDelegate,
}: {
  steps: ApprovalStepOut[];
  canApprove: boolean;
  currentUserId: string;
  allUsers: UserSummary[];
  onLoadUsers: () => Promise<void>;
  onApprove: (comment: string) => Promise<void>;
  onReject: (comment: string, mode: "to_creator" | "to_previous") => Promise<void>;
  onSetDelegate: (stepOrder: number, delegateId: string | null) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  const [rejectMode, setRejectMode] = useState<"to_creator" | "to_previous">("to_creator");
  const [approveComment, setApproveComment] = useState("");
  const [delegatePickerStep, setDelegatePickerStep] = useState<number | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const handleApprove = async () => {
    setLoading(true);
    setActionError("");
    try { await onApprove(approveComment); }
    catch (error) { setActionError(apiErrorMessage(error, "核准失敗，請稍後再試。")); }
    finally { setLoading(false); }
  };

  const handleReject = async () => {
    if (!rejectComment.trim()) return;
    setLoading(true);
    setActionError("");
    try { await onReject(rejectComment, rejectMode); setShowReject(false); }
    catch (error) { setActionError(apiErrorMessage(error, "退件失敗，請稍後再試。")); }
    finally { setLoading(false); }
  };

  const toggleDelegatePicker = async (stepOrder: number) => {
    const shouldOpen = delegatePickerStep !== stepOrder;
    setDelegatePickerStep(shouldOpen ? stepOrder : null);
    if (!shouldOpen || allUsers.length > 0) return;
    setLoadingUsers(true);
    try { await onLoadUsers(); } finally { setLoadingUsers(false); }
  };

  return (
    <div className="approval-panel card w-full min-w-0 space-y-4 p-4 sm:space-y-5 sm:p-5">
      <h2 className="text-sm font-semibold text-fg-primary!" >
        審核紀錄
      </h2>

      {/* 步驟進度條 */}
      <div className="flex w-full min-w-0 items-center overflow-x-auto pb-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text!" role="list" tabIndex={0} aria-label="審核步驟，可水平捲動">
        {steps.map((step, i) => {
          const s = STATUS_STYLE[step.status] ?? STATUS_STYLE.waiting;
          return (
            <div key={step.id} className="flex min-w-[5.5rem] flex-1 items-center" role="listitem">
              <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                <div
                  className={"approval-timeline-node w-9 h-9 rounded-full flex items-center justify-center transition-[color,background-color,border-color,opacity,box-shadow,transform] " + ("border-2 " + s.borderColorClass + " " + s.colorClass + " " + s.bgClass + " " + (step.status === "pending" ? "shadow-[0_0_0_4px_var(--warning-dim)]!" : ""))}
                  data-status={step.status}

                  role="img"
                  aria-label={`${step.approver.name}：${STATUS_LABEL[step.status]}`}>
                  {STATUS_ICON[step.status]}
                </div>
                <span className={"text-xs font-medium text-center max-w-16 truncate " + (s.colorClass)}
                  >
                  {step.approver.name}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div
                  className={"approval-timeline-connector flex-1 h-0.5 mx-2 rounded-full transition-[color,background-color,border-color,opacity,box-shadow,transform] " + ((step.status === "approved" ? "bg-success!" : "bg-border-strong!"))}
                  data-complete={step.status === "approved" || undefined}

                  aria-hidden="true"
                />
              )}
            </div>
          );
        })}
      </div>

      {/* 各步驟詳細 */}
      <div className="space-y-2">
        {steps.map((step) => {
          const s = STATUS_STYLE[step.status] ?? STATUS_STYLE.waiting;
          const isMyStep = step.approver.id === currentUserId;
          const isMyTurn = isMyStep && step.status === "pending";
          const canDelegate = isMyStep && (step.status === "pending" || step.status === "waiting");
          const actorDisplay = formatStepActor(step);

          return (
            <div key={step.id}>
              <div
                className={"approval-step-card min-w-0 rounded-xl p-3.5 " + ((isMyTurn ? "bg-warning-soft! border border-warning! shadow-[0_0_0_3px_var(--warning-dim)]!" : "bg-elevated!" + " " + "border " + s.borderSoftClass))}
                data-status={step.status}
                data-current={isMyTurn || undefined}
                >
                {(step.status === "approved" || step.status === "rejected") && (
                  <span
                    className={`approval-formal-seal approval-formal-seal--${step.status}`}
                    aria-hidden="true"
                  >
                    {step.status === "approved" ? "核准" : "退件"}
                  </span>
                )}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={"w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 " + (s.bgClass + " " + s.colorClass)}

                      aria-hidden="true">
                      {step.step_order}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-words text-fg-primary!" >
                        {actorDisplay.primary}
                      </p>
                      {actorDisplay.secondary && (
                        <p className="text-xs text-fg-muted!" >
                          {actorDisplay.secondary}
                        </p>
                      )}
                    </div>
                    <span
                      className={"approval-status-badge badge text-xs " + (s.colorClass + " " + s.bgClass + " " + s.borderColorClass)}
                      >
                      {STATUS_LABEL[step.status]}
                    </span>
                    {isMyTurn && (
                      <span
                        className="badge text-xs font-semibold text-warning! bg-warning-soft! border-warning!"
                        >
                        輪到你
                      </span>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 sm:shrink-0 sm:justify-end">
                    {step.decided_at && (
                      <span className="text-xs text-fg-muted!" >
                        {new Date(step.decided_at).toLocaleDateString("zh-TW")}
                      </span>
                    )}
                    {canDelegate && (
                      <button
                        type="button"
                        onClick={() => void toggleDelegatePicker(step.step_order)}
                        className="min-h-11 rounded px-3 py-2 text-xs transition-[color,background-color,border-color,opacity,box-shadow,transform] text-accent-text! bg-accent-soft!"
                        >
                        {step.delegate ? "變更代理" : "指定代理"}
                      </button>
                    )}
                  </div>
                </div>
                {step.comment ? (
                  <p className="text-xs pl-7 text-fg-secondary!" >
                    {step.comment}
                  </p>
                ) : (
                  <p className="text-xs pl-7 italic text-fg-disabled!" >
                    尚未審核
                  </p>
                )}
              </div>

              {/* 代理人選取器（展開於步驟卡下方） */}
              {delegatePickerStep === step.step_order && (
                <DelegatePicker
                  step={step}
                  users={allUsers}
                  loading={loadingUsers}
                  currentDelegate={step.delegate?.id ?? null}
                  onSetDelegate={onSetDelegate}
                  onClose={() => setDelegatePickerStep(null)}
                />
              )}
            </div>
          );
        })}
      </div>

      {actionError && <p role="alert" className="text-sm text-danger!" >{actionError}</p>}

      {/* 審核操作 */}
      {canApprove && !showReject && (
        <div className="space-y-3 pt-3 border-t border-border!" >
          <textarea
            placeholder="核准意見（選填）"
            value={approveComment}
            onChange={(e) => setApproveComment(e.target.value)}
            rows={2}
            className="input min-h-20 resize-none"
            aria-label="核准意見"
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={handleApprove}
              disabled={loading}
              aria-busy={loading}
              className="approval-action-button motion-action-button motion-action-button--approve btn min-h-11 w-full justify-center sm:flex-1 bg-success-soft! text-success! border border-success-soft!"
              >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {loading ? "處理中…" : "核准"}
            </button>
            <button
              onClick={() => { setActionError(""); setShowReject(true); }}
              className="approval-action-button motion-action-button motion-action-button--reject btn min-h-11 w-full justify-center sm:flex-1 bg-danger-soft! text-danger! border border-danger-soft!"
              >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              退件
            </button>
          </div>
        </div>
      )}

      {/* 退件操作 */}
      {canApprove && showReject && (
        <div className="space-y-3 pt-3 border-t border-border!" >
          <textarea
            placeholder="退件原因（必填）"
            value={rejectComment}
            onChange={(e) => setRejectComment(e.target.value)}
            rows={3}
            className="input resize-none border-danger-soft!"

            aria-label="退件原因"
            aria-required="true"
          />
          <div className="flex flex-col gap-2 text-xs sm:flex-row" role="group" aria-label="退件目標">
            {(["to_creator", "to_previous"] as const).map((m) => {
              const active = rejectMode === m;
              return (
                <button
                  key={m}
                  onClick={() => setRejectMode(m)}
                  aria-pressed={active}
                  className={"min-h-11 flex-1 rounded-xl px-3 py-2 transition-[color,background-color,border-color,opacity,box-shadow,transform] " + ((active ? "bg-danger-soft! text-danger! border border-danger-soft!" : "bg-elevated! text-fg-muted! border border-border!"))}
                  >
                  {m === "to_creator" ? "退回承辦人" : "退回上一關"}
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={handleReject}
              disabled={loading || !rejectComment.trim()}
              className="btn min-h-11 w-full justify-center sm:flex-1 bg-danger! text-white! border-0!"
              >
              {loading ? "處理中…" : "確認退件"}
            </button>
            <button
              onClick={() => { setActionError(""); setShowReject(false); }}
              className="btn btn-ghost min-h-11 w-full justify-center sm:w-auto">
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
