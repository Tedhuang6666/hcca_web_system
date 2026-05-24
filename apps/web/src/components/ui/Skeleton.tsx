"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * 通用骨架元件 — 取代 spinner、讓使用者預期內容形狀。
 * 透過 `[data-skeleton]` 在 globals.css 控制 shimmer 動畫。
 */
export function Skeleton({
  width,
  height = 16,
  rounded = 6,
  style,
  className,
}: {
  width?: number | string;
  height?: number | string;
  rounded?: number | string;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <span
      data-skeleton="true"
      aria-hidden="true"
      className={className}
      style={{
        display: "inline-block",
        width: width ?? "100%",
        height,
        borderRadius: rounded,
        background:
          "linear-gradient(90deg, var(--bg-elevated) 0%, var(--bg-hover) 50%, var(--bg-elevated) 100%)",
        backgroundSize: "200% 100%",
        animation: "skeleton-shimmer 1.4s ease-in-out infinite",
        ...style,
      }}
    />
  );
}

/**
 * 列表頁通用骨架 — N 行卡片，每行有標題＋兩段描述。
 * 套用於 documents、announcements、meetings、petitions 等列表。
 */
export function ListPageSkeleton({
  rows = 6,
  showHeader = true,
  showFilters = true,
}: {
  rows?: number;
  showHeader?: boolean;
  showFilters?: boolean;
}) {
  return (
    <div
      className="space-y-4"
      role="status"
      aria-live="polite"
      aria-label="列表載入中"
    >
      {showHeader && (
        <div className="space-y-2">
          <Skeleton width={180} height={24} />
          <Skeleton width={280} height={14} />
        </div>
      )}
      {showFilters && (
        <div className="flex flex-wrap gap-2">
          <Skeleton width={120} height={36} rounded={10} />
          <Skeleton width={160} height={36} rounded={10} />
          <Skeleton width={100} height={36} rounded={10} />
        </div>
      )}
      <ul className="space-y-2.5 list-none p-0 m-0">
        {Array.from({ length: rows }).map((_, i) => (
          <li
            key={i}
            className="card p-4 flex items-start justify-between gap-4"
          >
            <div className="flex-1 space-y-2 min-w-0">
              <Skeleton width="55%" height={18} />
              <Skeleton width="80%" height={12} />
              <Skeleton width="40%" height={12} />
            </div>
            <div className="flex flex-col items-end gap-2 flex-shrink-0">
              <Skeleton width={64} height={22} rounded={999} />
              <Skeleton width={80} height={12} />
            </div>
          </li>
        ))}
      </ul>
      <span className="sr-only">內容載入中，請稍候</span>
    </div>
  );
}

/**
 * 卡片內小區塊的骨架 — 用於詳情頁、儀表板的子區塊。
 */
export function SectionSkeleton({
  lines = 3,
  children,
}: {
  lines?: number;
  children?: ReactNode;
}) {
  return (
    <div className="card p-5 space-y-3" role="status" aria-label="區塊載入中">
      <Skeleton width={160} height={18} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "70%" : "100%"} height={14} />
      ))}
      {children}
    </div>
  );
}
