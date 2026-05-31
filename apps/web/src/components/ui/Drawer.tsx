"use client";

import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";

interface DrawerProps {
  /** 由父層控制開關，false → 觸發收起動畫後 unmount。 */
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 底部 sticky 動作列。 */
  footer?: ReactNode;
  /**
   * 開啟方向：
   * - `auto`（預設）：桌面右側、手機底部 sheet。
   * - `right` / `left`：兩側固定。
   * - `bottom`：底部 sheet。
   */
  side?: "right" | "left" | "bottom" | "auto";
  /** 桌面寬度（CSS length）。auto / right / left 時生效。 */
  width?: string;
  /** Bottom sheet 高度（CSS length）。auto / bottom 時生效。 */
  sheetHeight?: string;
  /** 點擊背景是否關閉（預設 true）。 */
  closeOnBackdrop?: boolean;
  ariaLabel?: string;
}

/**
 * 共用抽屜元件。
 * - `auto` 模式：桌面（>=1024px）由右側滑入、手機由底部 sheet 滑入，響應式由 globals.css `.drawer-panel` 規則處理。
 * - 240ms 滑入 / 淡出動畫。controlled by `open`，關閉時延遲 unmount 以播放動畫。
 */
export default function Drawer({
  open,
  title,
  onClose,
  children,
  footer,
  side = "auto",
  width = "480px",
  sheetHeight = "85vh",
  closeOnBackdrop = true,
  ariaLabel,
}: DrawerProps) {
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(id);
    }
    if (mounted) {
      setEntered(false);
      const timer = window.setTimeout(() => setMounted(false), 240);
      return () => window.clearTimeout(timer);
    }
    return;
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mounted]);

  if (!mounted) return null;

  const panelStyle: CSSProperties = {
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    // 透過 CSS variable 給 .drawer-panel 規則使用
    ["--drawer-width" as string]: width,
    ["--drawer-sheet-height" as string]: sheetHeight,
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? title}
    >
      <div
        className="absolute inset-0 transition-opacity"
        style={{
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(4px)",
          opacity: entered ? 1 : 0,
          transitionDuration: "240ms",
        }}
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />
      <aside
        data-side={side}
        data-entered={entered ? "true" : "false"}
        className="drawer-panel flex flex-col overflow-hidden shadow-2xl"
        style={panelStyle}
      >
        {/* Sheet handle bar (僅 bottom / auto-mobile) */}
        {(side === "bottom" || side === "auto") && (
          <div className="drawer-handle flex justify-center pt-2 pb-1">
            <div
              aria-hidden="true"
              className="h-1 w-10 rounded-full"
              style={{ background: "var(--border-strong)" }}
            />
          </div>
        )}
        <header
          className="flex flex-shrink-0 items-center justify-between gap-3 px-5 py-3.5"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:opacity-70"
            style={{ color: "var(--text-muted)" }}
            aria-label="關閉"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div
            className="flex flex-shrink-0 items-center justify-end gap-2 px-5 py-3 flex-wrap"
            style={{ borderTop: "1px solid var(--border)", background: "var(--bg-elevated)" }}
          >
            {footer}
          </div>
        )}
      </aside>
    </div>,
    document.body,
  );
}
