"use client";
import { useState } from "react";
import type { ApprovalStepOut } from "@/lib/types";

const STATUS_ICON: Record<string, string> = { approved: "✓", rejected: "✕", pending: "○", waiting: "…" };
const STATUS_COLOR: Record<string, string> = {
  approved: "#22d3ee", rejected: "#f87171", pending: "#fb923c", waiting: "#475569",
};
const STATUS_LABEL: Record<string, string> = {
  approved: "已核准", rejected: "已退件", pending: "審核中", waiting: "等待中",
};

export function ApprovalPanel({
  steps, canApprove, onApprove, onReject,
}: {
  steps: ApprovalStepOut[];
  canApprove: boolean;
  onApprove: (comment: string) => Promise<void>;
  onReject: (comment: string, mode: "to_creator" | "to_previous") => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  const [rejectMode, setRejectMode] = useState<"to_creator" | "to_previous">("to_creator");
  const [approveComment, setApproveComment] = useState("");

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
    <div className="glass p-5 space-y-5">
      <h3 className="text-sm font-semibold text-slate-200">審核工作流</h3>

      {/* 進度條 */}
      <div className="flex items-center">
        {steps.map((step, i) => (
          <div key={step.id} className="flex items-center flex-1">
            <div className="flex flex-col items-center gap-1">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                style={{
                  border: `2px solid ${STATUS_COLOR[step.status]}`,
                  color: STATUS_COLOR[step.status],
                  background: `${STATUS_COLOR[step.status]}20`,
                  boxShadow: step.status === "pending" ? `0 0 12px ${STATUS_COLOR.pending}40` : "none",
                }}>
                {STATUS_ICON[step.status]}
              </div>
              <span className="text-xs whitespace-nowrap" style={{ color: STATUS_COLOR[step.status] }}>
                {step.approver.name}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="flex-1 h-0.5 mx-2 rounded-full"
                style={{ background: step.status === "approved" ? "var(--accent)" : "var(--border)" }} />
            )}
          </div>
        ))}
      </div>

      {/* 詳細意見 */}
      <div className="space-y-2">
        {steps.map((step) => (
          <div key={step.id} className="rounded-lg p-3"
            style={{ background: "var(--bg-elevated)", border: `1px solid ${STATUS_COLOR[step.status]}20` }}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: `${STATUS_COLOR[step.status]}20`, color: STATUS_COLOR[step.status] }}>
                  {step.step_order}
                </span>
                <span className="text-sm font-medium text-slate-200">{step.approver.name}</span>
                <span className="text-xs px-1.5 py-0.5 rounded" style={{ color: "var(--muted)", background: "var(--bg-surface)" }}>
                  {STATUS_LABEL[step.status]}
                </span>
              </div>
              {step.decided_at && (
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {new Date(step.decided_at).toLocaleDateString("zh-TW")}
                </span>
              )}
            </div>
            {step.comment
              ? <p className="text-xs text-slate-400 ml-7">{step.comment}</p>
              : <p className="text-xs italic ml-7" style={{ color: "var(--muted)" }}>尚未審核</p>}
          </div>
        ))}
      </div>

      {/* 審核操作 */}
      {canApprove && !showReject && (
        <div className="space-y-2 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
          <textarea placeholder="核准意見（選填）" value={approveComment}
            onChange={(e) => setApproveComment(e.target.value)} rows={2}
            className="w-full bg-transparent text-slate-300 text-sm p-2 rounded outline-none resize-none"
            style={{ border: "1px solid var(--border)" }} />
          <div className="flex gap-2">
            <button onClick={handleApprove} disabled={loading}
              className="flex-1 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: "rgba(34,211,238,0.15)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.3)" }}>
              ✓ 核准
            </button>
            <button onClick={() => setShowReject(true)}
              className="flex-1 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-80"
              style={{ background: "rgba(248,113,113,0.15)", color: "#f87171", border: "1px solid rgba(248,113,113,0.3)" }}>
              ✕ 退件
            </button>
          </div>
        </div>
      )}

      {/* 退件模態 */}
      {canApprove && showReject && (
        <div className="space-y-3 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
          <textarea placeholder="退件原因（必填）" value={rejectComment}
            onChange={(e) => setRejectComment(e.target.value)} rows={3}
            className="w-full bg-transparent text-slate-300 text-sm p-2 rounded outline-none resize-none"
            style={{ border: "1px solid rgba(248,113,113,0.4)" }} />
          <div className="flex gap-2 text-xs">
            {(["to_creator", "to_previous"] as const).map((m) => (
              <button key={m} onClick={() => setRejectMode(m)}
                className="flex-1 py-1.5 rounded transition-all"
                style={rejectMode === m
                  ? { background: "rgba(248,113,113,0.2)", color: "#f87171", border: "1px solid rgba(248,113,113,0.4)" }
                  : { background: "var(--bg-elevated)", color: "var(--muted)", border: "1px solid var(--border)" }}>
                {m === "to_creator" ? "退回承辦人" : "退回上一關"}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={handleReject} disabled={loading || !rejectComment.trim()}
              className="flex-1 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              style={{ background: "rgba(248,113,113,0.15)", color: "#f87171", border: "1px solid rgba(248,113,113,0.3)" }}>
              確認退件
            </button>
            <button onClick={() => setShowReject(false)}
              className="px-4 py-2 rounded-lg text-sm" style={{ color: "var(--muted)" }}>
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
