"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Info, X } from "lucide-react";

interface OnboardingHintProps {
  /** 唯一識別字串；按 X 後存進 localStorage 永久不再顯示。 */
  id: string;
  children: ReactNode;
  /** 是否強制顯示（無視 dismiss 紀錄）。 */
  force?: boolean;
  /** 圖示（預設 Sparkles）。 */
  icon?: ReactNode;
  /** severity，影響色調。 */
  severity?: "info" | "warning" | "success";
}

const STORAGE_KEY = "dismissed-hints";

function readDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeDismissed(set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* quota — ignore */
  }
}

const SEV_STYLES = {
  info:    { bg: "var(--primary-dim)", border: "var(--info-border)", color: "var(--primary)" },
  warning: { bg: "var(--warning-dim)", border: "var(--warning-border)", color: "var(--warning)" },
  success: { bg: "var(--success-dim)", border: "var(--success-border)", color: "var(--success)" },
};

/**
 * 一次性引導橫條：顯示一次，使用者按 X 後永久關閉（localStorage 記錄）。
 * 用於：新功能上線提示、複雜頁面首次進入引導。
 *
 * 範例：
 * <OnboardingHint id="hint.dashboard.first-visit">
 *   第一次來嗎？點任一卡片可以直接開始
 * </OnboardingHint>
 */
export default function OnboardingHint({
  id,
  children,
  force = false,
  icon,
  severity = "info",
}: OnboardingHintProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (force) { setVisible(true); return; }
    const dismissed = readDismissed();
    setVisible(!dismissed.has(id));
  }, [id, force]);

  const handleDismiss = () => {
    setVisible(false);
    const dismissed = readDismissed();
    dismissed.add(id);
    writeDismissed(dismissed);
  };

  if (!visible) return null;
  const sev = SEV_STYLES[severity];

  return (
    <div
      role="status"
      className="onboarding-hint flex items-start gap-3 px-4 py-3 rounded-lg mb-4 animate-slide-in"
      style={{
        background: sev.bg,
        border: `1px solid ${sev.border}`,
      }}>
      <span className="flex-shrink-0 mt-0.5" style={{ color: sev.color }} aria-hidden="true">
        {icon ?? <Info size={16} aria-hidden={true} />}
      </span>
      <div className="flex-1 text-sm" style={{ color: "var(--text-primary)" }}>
        {children}
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        className="flex-shrink-0 -m-1 p-1 rounded transition-opacity hover:opacity-70"
        style={{ color: "var(--text-muted)", background: "transparent", border: "none" }}
        aria-label="關閉提示">
        <X size={14} aria-hidden={true} />
      </button>
    </div>
  );
}
