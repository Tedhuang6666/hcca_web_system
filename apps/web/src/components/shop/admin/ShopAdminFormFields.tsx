import type { ReactNode } from "react";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium block mb-1" style={{ color: "var(--text-secondary)" }}>{label}</span>
      {children}
    </label>
  );
}

export function MiniBtn({
  children, onClick, tone = "neutral", disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: "neutral" | "primary" | "danger";
  disabled?: boolean;
}) {
  const style = {
    neutral: { color: "var(--text-secondary)", border: "1px solid var(--border)" },
    primary: { color: "var(--primary-text)", border: "1px solid var(--border-strong)", background: "var(--primary-dim)" },
    danger: { color: "#f87171", border: "1px solid rgba(248,113,113,0.3)" },
  }[tone];
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="min-h-11 px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-45 sm:px-2.5"
      style={style}>
      {children}
    </button>
  );
}
