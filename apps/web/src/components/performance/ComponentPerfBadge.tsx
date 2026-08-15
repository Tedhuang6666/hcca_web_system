"use client";

import { useCallback, useSyncExternalStore } from "react";
import { usePerformanceMonitor } from "@/components/providers/PerformanceProvider";

export interface ComponentPerfBadgeProps {
  componentName: string;
  className?: string;
}

export default function ComponentPerfBadge({ componentName, className = "" }: ComponentPerfBadgeProps) {
  const { monitor } = usePerformanceMonitor();
  const subscribe = useCallback((listener: () => void) => monitor.subscribe(listener), [monitor]);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => monitor.getSnapshotVersion(),
    () => 0,
  );
  const metric = monitor.getComponentMetrics().find((item) => item.componentName === componentName);
  void snapshot;

  if (process.env.NODE_ENV !== "development" || !metric) return null;
  const isSlow = metric.avgRenderTime > 16;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${className}`}
      style={{
        color: isSlow ? "var(--danger)" : "var(--text-muted)",
        background: isSlow ? "var(--danger-dim)" : "var(--bg-hover)",
        borderColor: isSlow ? "var(--danger-border)" : "var(--border)",
      }}
      title={`${componentName}：平均 ${metric.avgRenderTime.toFixed(1)} ms，${metric.renderCount} 次渲染`}
    >
      {metric.avgRenderTime.toFixed(1)} ms · {metric.renderCount} 次
    </span>
  );
}
