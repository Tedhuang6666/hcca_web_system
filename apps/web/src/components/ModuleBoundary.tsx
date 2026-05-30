"use client";
import React, { Component, Suspense, type ReactNode } from "react";
import { useModuleStatus } from "@/contexts/ModuleStatusContext";
import ModuleMaintenance from "@/components/ui/ModuleMaintenance";
import RouteError from "@/components/ui/RouteError";
import type { ModuleId } from "@/lib/modules";

interface ModuleBoundaryProps {
  /** 模組 ID，用於查 ModuleStatusContext 決定是否顯示維護畫面 */
  id: ModuleId;
  /** Suspense fallback；通常傳對應模組的 Skeleton */
  skeleton: ReactNode;
  /** 模組內容（建議用 next/dynamic 動態載入） */
  children: ReactNode;
}

/**
 * 模組進入點包裹元件 — 三層保護：
 *  1. ModuleStatusContext 顯示「模組維護中」（避免反覆觸發 5xx）
 *  2. ErrorBoundary 捕捉內容區崩潰，不波及 shell / 其他模組
 *  3. Suspense 配合 dynamic import 提供骨架屏，主體 shell 先 paint
 */
export default function ModuleBoundary({ id, skeleton, children }: ModuleBoundaryProps) {
  const { isModuleDown } = useModuleStatus();
  if (isModuleDown(id)) {
    return <ModuleMaintenance moduleId={id} />;
  }
  return (
    <ModuleErrorBoundary scope={id}>
      <Suspense fallback={skeleton}>{children}</Suspense>
    </ModuleErrorBoundary>
  );
}

interface BoundaryState {
  error: (Error & { digest?: string }) | null;
}

class ModuleErrorBoundary extends Component<
  { scope: string; children: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ModuleBoundary:${this.props.scope}]`, error, info);
    // 上報到後端 error_audit（best-effort，失敗不影響）
    try {
      void fetch("/admin/system/errors/client", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: this.props.scope,
          message: String(error?.message ?? error),
          stack: String(error?.stack ?? ""),
        }),
      }).catch(() => {});
    } catch {
      /* swallow */
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <RouteError
          error={this.state.error}
          reset={this.reset}
          scope={this.props.scope}
        />
      );
    }
    return this.props.children;
  }
}
