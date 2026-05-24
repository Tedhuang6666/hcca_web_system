"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 標準尺寸（會自動對應 max-width）。優先於 maxWidthClassName。 */
  size?: ModalSize;
  /** 行動裝置（<640px）自動全屏（預設 true）。 */
  mobileFullscreen?: boolean;
  /** 底部 sticky 動作列。 */
  footer?: ReactNode;
  /** @deprecated 使用 size 取代。為了不破壞既有 callers 而保留。 */
  maxWidthClassName?: string;
}

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
  full: "max-w-full",
};

export default function Modal({
  title,
  onClose,
  children,
  size,
  mobileFullscreen = true,
  footer,
  maxWidthClassName,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // ESC 鍵關閉
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!mounted) return null;

  const widthClass = size ? SIZE_CLASS[size] : (maxWidthClassName ?? "max-w-lg");

  // 行動裝置全屏：sm: 之下用 100% / 100vh
  const mobileClass = mobileFullscreen
    ? "h-full max-h-full sm:my-auto sm:h-auto sm:max-h-[calc(100vh-2rem)]"
    : "my-auto max-h-[calc(100vh-2rem)]";
  const mobileRadius = mobileFullscreen ? "rounded-none sm:rounded-2xl" : "rounded-2xl";

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex justify-center overflow-y-auto sm:items-center ${mobileFullscreen ? "items-stretch p-0 sm:p-4" : "items-start p-4"}`}
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={`flex w-full ${widthClass} flex-col shadow-2xl ${mobileClass} ${mobileRadius}`}
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        <div
          className="flex flex-shrink-0 items-center justify-between gap-3 p-5 pb-3"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:opacity-70"
            style={{ color: "var(--text-muted)" }}
            aria-label="關閉"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 pt-4">{children}</div>
        {footer && (
          <div
            className="flex flex-shrink-0 items-center justify-end gap-2 px-5 py-3 flex-wrap"
            style={{ borderTop: "1px solid var(--border)", background: "var(--bg-elevated)" }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
