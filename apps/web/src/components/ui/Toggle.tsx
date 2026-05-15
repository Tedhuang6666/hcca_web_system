"use client";

import type { ReactNode } from "react";

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
}

/**
 * 全站統一的膠囊樣式 Toggle Switch。
 * 容器 36×20、滑塊 16×16、padding 2px、translateX 16px 為標準尺寸。
 */
export default function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
  ariaLabel,
}: ToggleProps) {
  const handleClick = () => {
    if (!disabled) onChange(!checked);
  };
  const swatch = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
      disabled={disabled}
      onClick={handleClick}
      className="relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full overflow-hidden transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
      style={{
        background: checked ? "var(--primary)" : "var(--border-strong)",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span
        aria-hidden="true"
        className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? "translateX(18px)" : "translateX(2px)" }}
      />
    </button>
  );
  if (!label) return swatch;
  return (
    <label
      className="inline-flex items-center gap-2 cursor-pointer select-none"
      style={{ cursor: disabled ? "not-allowed" : "pointer" }}
    >
      {swatch}
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
    </label>
  );
}
