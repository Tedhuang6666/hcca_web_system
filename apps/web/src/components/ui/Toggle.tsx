"use client";

import type { ReactNode } from "react";

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}

/**
 * 全站唯一的開關。尺寸、顏色與動態都在 globals/10-shared-controls.css 的 `.switch`。
 * 動態：滑塊帶著主色從原位滑到另一側；按住時滑塊朝要去的方向伸長；開啟後在滑塊上畫出勾號，
 * 讓狀態不只靠顏色辨識。
 */
export default function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
  ariaLabel,
  className,
}: ToggleProps) {
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={label ? "switch" : `switch${className ? ` ${className}` : ""}`}
    >
      <span className="switch__ink" aria-hidden="true" />
      <span className="switch__thumb" aria-hidden="true">
        <svg className="switch__check" viewBox="0 0 12 12" focusable="false">
          <path d="M3.1 6.3 5.2 8.3 9 4.1" pathLength={1} />
        </svg>
      </span>
    </button>
  );
  if (!label) return control;
  return (
    <label className={`switch-field${className ? ` ${className}` : ""}`} data-disabled={disabled || undefined}>
      {control}
      <span className="switch-field__label">{label}</span>
    </label>
  );
}
