"use client";
import { useState } from "react";
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

const STATUS_STYLE: Record<string, { colorVar: string; bgVar: string }> = {
  approved: { colorVar: "--success", bgVar: "--success-dim" },
  rejected: { colorVar: "--danger",  bgVar: "--danger-dim"  },
  pending:  { colorVar: "--warning", bgVar: "--warning-dim" },
  waiting:  { colorVar: "--text-muted", bgVar: "--bg-elevated" },
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
  onSetDelegate, onClose,
}: {
  step: ApprovalStepOut;
  users: UserSummary[];
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
    <div className="mt-2 rounded-xl p-3 space-y-2"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border-strong)" }}>
      <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
        設定代理人（代理人可代為審核此步驟）
      </p>
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="搜尋姓名或 Email…"
        className="w-full bg-transparent text-xs px-2 py-1.5 rounded outline-none"
        style={{ border: "1px solid var(--border)" }}
      />
      <div className="max-h-36 overflow-y-auto space-y-0.5">
        {/* 清除代理人 */}
        <button
          onClick={() => setSelectedId(null)}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors"
          style={selectedId === null
            ? { background: "var(--primary-dim)", border: "1px solid var(--border-strong)" }
            : { background: "var(--bg-elevated)", border: "1px solid transparent" }}>
          <span className="w-4 h-4 text-center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>
          <span style={{ color: "var(--text-muted)" }}>不指定代理人</span>
        </button>
        {filtered.slice(0, 20).map(u => (
          <button
            key={u.id}
            onClick={() => setSelectedId(u.id)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors"
            style={selectedId === u.id
              ? { background: "var(--primary-dim)", border: "1px solid var(--border-strong)" }
              : { background: "var(--bg-elevated)", border: "1px solid transparent" }}>
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
              style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
              {u.display_name.charAt(0)}
            </span>
            <div className="flex-1 min-w-0">
              <p className="truncate" style={{ color: "var(--text-primary)" }}>{u.display_name}</p>
              <p className="truncate" style={{ color: "var(--text-muted)" }}>{u.email}</p>
            </div>
            {selectedId === u.id && <span style={{ color: "var(--primary)" }}>✓</span>}
          </button>
        ))}
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="text-xs px-3 py-1.5 rounded"
          style={{ color: "var(--text-muted)" }}>取消</button>
        <button onClick={handleSave} disabled={saving}
          className="text-xs px-3 py-1.5 rounded font-medium disabled:opacity-50"
          style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
          {saving ? "儲存中…" : "確認"}
        </button>
      </div>
    </div>
  );
}

// ── 主元件 ────────────────────────────────────────────────────────────────────

export function ApprovalPanel({
  steps, canApprove, currentUserId, allUsers,
  onApprove, onReject, onSetDelegate,
}: {
  steps: ApprovalStepOut[];
  canApprove: boolean;
  currentUserId: string;
  allUsers: UserSummary[];
  onApprove: (comment: string) => Promise<void>;
  onReject: (comment: string, mode: "to_creator" | "to_previous") => Promise<void>;
  onSetDelegate: (stepOrder: number, delegateId: string | null) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  const [rejectMode, setRejectMode] = useState<"to_creator" | "to_previous">("to_creator");
  const [approveComment, setApproveComment] = useState("");
  const [delegatePickerStep, setDelegatePickerStep] = useState<number | null>(null);

  const handleApprove = async () => {
    setLoading(true);
    try { await onApprove(approveComment); } finally { setLoading(false); }
  };

  const handleReject = async () => {
    if (!rejectComment.trim()) return;
    setLoading(true);
    try { await onReject(rejectComment, rejectMode); setShowReject(false); } finally { setLoading(false); }
  };

  return (
    <div className="card p-5 space-y-5">
      <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        審核工作流
      </h3>

      {/* 步驟進度條 */}
      <div className="flex items-center" role="list" aria-label="審核步驟">
        {steps.map((step, i) => {
          const s = STATUS_STYLE[step.status] ?? STATUS_STYLE.waiting;
          return (
            <div key={step.id} className="flex items-center flex-1" role="listitem">
              <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
                  style={{
                    border: `2px solid var(${s.colorVar})`,
                    color: `var(${s.colorVar})`,
                    background: `var(${s.bgVar})`,
                    boxShadow: step.status === "pending"
                      ? `0 0 0 4px var(${s.bgVar})`
                      : "none",
                  }}
                  aria-label={`${step.approver.name}：${STATUS_LABEL[step.status]}`}>
                  {STATUS_ICON[step.status]}
                </div>
                <span className="text-[11px] font-medium text-center max-w-16 truncate"
                  style={{ color: `var(${s.colorVar})` }}>
                  {step.approver.name}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div
                  className="flex-1 h-0.5 mx-2 rounded-full transition-all"
                  style={{
                    background: step.status === "approved"
                      ? "var(--success)"
                      : "var(--border-strong)",
                  }}
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
          const canDelegate = isMyStep && (step.status === "pending" || step.status === "waiting");
          const actorDisplay = formatStepActor(step);

          return (
            <div key={step.id}>
              <div
                className="rounded-xl p-3.5"
                style={{
                  background: "var(--bg-elevated)",
                  border: `1px solid var(${s.bgVar})`,
                }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{ background: `var(${s.bgVar})`, color: `var(${s.colorVar})` }}
                      aria-hidden="true">
                      {step.step_order}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-words" style={{ color: "var(--text-primary)" }}>
                        {actorDisplay.primary}
                      </p>
                      {actorDisplay.secondary && (
                        <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                          {actorDisplay.secondary}
                        </p>
                      )}
                    </div>
                    <span
                      className="badge text-[10px]"
                      style={{
                        color: `var(${s.colorVar})`,
                        background: `var(${s.bgVar})`,
                        borderColor: `var(${s.colorVar})`,
                      }}>
                      {STATUS_LABEL[step.status]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {step.decided_at && (
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {new Date(step.decided_at).toLocaleDateString("zh-TW")}
                      </span>
                    )}
                    {canDelegate && (
                      <button
                        onClick={() => setDelegatePickerStep(delegatePickerStep === step.step_order ? null : step.step_order)}
                        className="text-[10px] px-2 py-0.5 rounded transition-all"
                        style={{ color: "var(--primary)", background: "var(--primary-dim)" }}>
                        {step.delegate ? "變更代理" : "指定代理"}
                      </button>
                    )}
                  </div>
                </div>
                {step.comment ? (
                  <p className="text-xs pl-7" style={{ color: "var(--text-secondary)" }}>
                    {step.comment}
                  </p>
                ) : (
                  <p className="text-xs pl-7 italic" style={{ color: "var(--text-disabled)" }}>
                    尚未審核
                  </p>
                )}
              </div>

              {/* 代理人選取器（展開於步驟卡下方） */}
              {delegatePickerStep === step.step_order && (
                <DelegatePicker
                  step={step}
                  users={allUsers}
                  currentDelegate={step.delegate?.id ?? null}
                  onSetDelegate={onSetDelegate}
                  onClose={() => setDelegatePickerStep(null)}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* 審核操作 */}
      {canApprove && !showReject && (
        <div className="space-y-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
          <textarea
            placeholder="核准意見（選填）"
            value={approveComment}
            onChange={(e) => setApproveComment(e.target.value)}
            rows={2}
            className="input resize-none"
            aria-label="核准意見"
          />
          <div className="flex gap-2">
            <button
              onClick={handleApprove}
              disabled={loading}
              className="btn flex-1"
              style={{
                background: "var(--success-dim)",
                color: "var(--success)",
                border: "1px solid var(--success-dim)",
              }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {loading ? "處理中…" : "核准"}
            </button>
            <button
              onClick={() => setShowReject(true)}
              className="btn flex-1"
              style={{
                background: "var(--danger-dim)",
                color: "var(--danger)",
                border: "1px solid var(--danger-dim)",
              }}>
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
        <div className="space-y-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
          <textarea
            placeholder="退件原因（必填）"
            value={rejectComment}
            onChange={(e) => setRejectComment(e.target.value)}
            rows={3}
            className="input resize-none"
            style={{ borderColor: "var(--danger-dim)" }}
            aria-label="退件原因"
            aria-required="true"
          />
          <div className="flex gap-2 text-xs" role="group" aria-label="退件目標">
            {(["to_creator", "to_previous"] as const).map((m) => {
              const active = rejectMode === m;
              return (
                <button
                  key={m}
                  onClick={() => setRejectMode(m)}
                  aria-pressed={active}
                  className="flex-1 py-2 rounded-xl transition-all"
                  style={
                    active
                      ? { background: "var(--danger-dim)", color: "var(--danger)", border: "1px solid var(--danger-dim)" }
                      : { background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border)" }
                  }>
                  {m === "to_creator" ? "退回承辦人" : "退回上一關"}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleReject}
              disabled={loading || !rejectComment.trim()}
              className="btn flex-1"
              style={{ background: "var(--danger)", color: "#fff", border: "none" }}>
              {loading ? "處理中…" : "確認退件"}
            </button>
            <button
              onClick={() => setShowReject(false)}
              className="btn btn-ghost">
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
