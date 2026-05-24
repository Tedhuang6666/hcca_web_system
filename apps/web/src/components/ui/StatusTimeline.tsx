"use client";
import { Check, Clock, AlertCircle } from "lucide-react";
import type { ReactNode } from "react";

export type TimelineNodeState = "done" | "current" | "pending" | "skipped" | "failed";

export interface TimelineStep {
  key: string;
  label: string;
  description?: ReactNode;
  /** 動作 / 完成時間。 */
  at?: string | Date | null;
  /** 經手人 / 負責人。 */
  by?: string | null;
  /** 狀態。 */
  state: TimelineNodeState;
  /** 此節點專屬的 CTA（當 current 且使用者有權時顯示）。 */
  cta?: ReactNode;
}

interface StatusTimelineProps {
  steps: TimelineStep[];
  /** 緊湊模式（縮小 padding）。 */
  dense?: boolean;
}

const STATE_STYLE: Record<TimelineNodeState, { color: string; bg: string; border: string }> = {
  done:    { color: "var(--success)", bg: "var(--success-dim)", border: "var(--success-border)" },
  current: { color: "var(--primary)", bg: "var(--primary-dim)", border: "var(--info-border)" },
  pending: { color: "var(--text-disabled)", bg: "var(--bg-hover)", border: "var(--border)" },
  skipped: { color: "var(--text-muted)", bg: "var(--bg-hover)", border: "var(--border)" },
  failed:  { color: "var(--danger)", bg: "var(--danger-dim)", border: "var(--danger-border)" },
};

function StateIcon({ state }: { state: TimelineNodeState }) {
  if (state === "done") return <Check size={12} aria-hidden={true} />;
  if (state === "current") return <Clock size={12} aria-hidden={true} />;
  if (state === "failed") return <AlertCircle size={12} aria-hidden={true} />;
  return <span className="block w-2 h-2 rounded-full" style={{ background: "currentColor" }} />;
}

function formatAt(at: string | Date | null | undefined): string | null {
  if (!at) return null;
  const d = typeof at === "string" ? new Date(at) : at;
  if (isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * 通用狀態時間軸：垂直顯示每個流程節點。
 * 用於：會議流程、法規審議流程、公文簽核流程。
 */
export default function StatusTimeline({ steps, dense = false }: StatusTimelineProps) {
  return (
    <ol className="relative" aria-label="狀態時間軸">
      {steps.map((s, idx) => {
        const style = STATE_STYLE[s.state];
        const isLast = idx === steps.length - 1;
        const at = formatAt(s.at);
        const pad = dense ? "pb-3" : "pb-5";

        return (
          <li key={s.key} className={`relative pl-9 ${isLast ? "" : pad}`}>
            {/* 縱向連線 */}
            {!isLast && (
              <span
                aria-hidden="true"
                className="absolute left-3 top-6 bottom-0 w-px"
                style={{
                  background: s.state === "done"
                    ? "var(--success-border)"
                    : "var(--border)",
                }}
              />
            )}
            {/* 節點圓圈 */}
            <span
              aria-hidden="true"
              className="absolute left-0 top-0 w-6 h-6 rounded-full flex items-center justify-center"
              style={{
                background: style.bg,
                color: style.color,
                border: `1px solid ${style.border}`,
              }}>
              <StateIcon state={s.state} />
            </span>

            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-sm font-medium" style={{
                color: s.state === "pending" ? "var(--text-muted)" : "var(--text-primary)",
              }}>
                {s.label}
              </span>
              {at && (
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {at}
                </span>
              )}
              {s.by && (
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  · {s.by}
                </span>
              )}
            </div>

            {s.description && (
              <div className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
                {s.description}
              </div>
            )}

            {s.state === "current" && s.cta && (
              <div className="mt-2">{s.cta}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
