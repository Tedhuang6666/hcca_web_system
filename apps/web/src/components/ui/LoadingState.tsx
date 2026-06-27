"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { ListPageSkeleton, SectionSkeleton, Skeleton } from "./Skeleton";

export function LoadingState({
  title = "正在載入",
  description = "請稍候，資料正在整理中。",
  compact = false,
}: {
  title?: string;
  description?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`loading-state ${compact ? "loading-state-compact" : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className="loading-orbit" aria-hidden="true">
        <Loader2 size={compact ? 18 : 24} />
      </span>
      <span className="loading-state-copy">
        <span className="loading-state-title">{title}</span>
        {!compact && <span className="loading-state-description">{description}</span>}
      </span>
    </div>
  );
}

export function PageLoading({
  title = "頁面載入中",
  description = "正在取得最新資料與權限狀態。",
  rows = 5,
  showFilters = true,
}: {
  title?: string;
  description?: string;
  rows?: number;
  showFilters?: boolean;
}) {
  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-5">
        <LoadingState title={title} description={description} />
      </div>
      <ListPageSkeleton rows={rows} showHeader showFilters={showFilters} />
    </div>
  );
}

export function DetailPageLoading({
  title = "詳情載入中",
  description = "正在準備內容、附件與操作狀態。",
  aside,
}: {
  title?: string;
  description?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-5">
        <LoadingState title={title} description={description} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-4">
          <SectionSkeleton lines={5}>
            <Skeleton width="45%" height={34} rounded={10} />
          </SectionSkeleton>
          <SectionSkeleton lines={7} />
        </div>
        <div className="space-y-4">{aside ?? <SectionSkeleton lines={4} />}</div>
      </div>
    </div>
  );
}
