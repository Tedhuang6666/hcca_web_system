"use client";

import type { ReactNode } from "react";

interface DrawerProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 抽屜浮現方向：right（右側 - 預設）、left、bottom */
  side?: "right" | "left" | "bottom";
  maxWidthClassName?: string;
}

/**
 * 全站統一抽屜（Drawer）元件。
 * 支援右側、左側、底部三個方向；內建 overflow-y-auto 與 viewport 高度限制。
 * 與共用 Modal.tsx 互補：modal 用於置中對話框、drawer 用於側邊細節面板。
 */
export default function Drawer({
  title,
  onClose,
  children,
  side = "right",
  maxWidthClassName = "max-w-2xl",
}: DrawerProps) {
  const containerClass = (() => {
    if (side === "left") return "items-start justify-start sm:items-stretch";
    if (side === "bottom") return "items-end justify-center";
    return "items-start justify-end sm:items-stretch";
  })();

  const panelClass = (() => {
    if (side === "bottom") return `w-full ${maxWidthClassName} max-h-[88vh] rounded-t-2xl sm:rounded-2xl`;
    return `w-full ${maxWidthClassName} max-h-[100vh] sm:max-h-[calc(100vh-2rem)] sm:my-4 rounded-2xl`;
  })();

  return (
    <div
      className={`fixed inset-0 z-50 flex overflow-y-auto p-3 sm:p-4 ${containerClass}`}
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className={`flex flex-col overflow-hidden shadow-2xl ${panelClass}`}
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        <header
          className="flex flex-shrink-0 items-center justify-between gap-3 px-5 py-4"
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
      </aside>
    </div>
  );
}
