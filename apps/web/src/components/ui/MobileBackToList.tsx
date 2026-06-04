"use client";

import { ArrowLeft } from "lucide-react";

/**
 * 手機版「返回列表」鈕：master-detail 版面在窄螢幕塌成單欄時，
 * 詳情區頂端提供明確的返回路徑（桌機並排時請以 `xl:hidden` 等隱藏）。
 */
export default function MobileBackToList({
  onBack,
  label = "返回列表",
  className = "",
}: {
  onBack: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onBack}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium ${className}`}
      style={{
        color: "var(--primary)",
        background: "var(--primary-dim)",
        border: "1px solid var(--border-strong)",
      }}
    >
      <ArrowLeft size={16} aria-hidden />
      {label}
    </button>
  );
}
