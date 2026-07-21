"use client";
import { useRouter } from "next/navigation";
import { Ban, Home, RotateCcw, Wrench } from "lucide-react";
import { useModuleStatus } from "@/contexts/ModuleStatusContext";
import type { ModuleId } from "@/lib/modules";

/** 模組維護插頁 — 渲染於 AppShell 內容區，保留側邊欄/頂欄供使用者前往其他模組。 */
export default function ModuleMaintenance({ moduleId }: { moduleId: ModuleId }) {
  const router = useRouter();
  const { moduleInfo, refresh } = useModuleStatus();
  const info = moduleInfo(moduleId);
  const label = info?.label ?? "此功能";
  const reason = info?.reason ?? "";
  const until = info?.until ?? null;
  const closed = info?.mode === "closed";
  const Icon = closed ? Ban : Wrench;

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col items-center justify-center text-center">
      <div
        className="grid h-16 w-16 place-items-center rounded-2xl border"
        style={{
          borderColor: closed ? "var(--danger-border)" : "var(--warning-border)",
          background: closed ? "var(--danger-dim)" : "var(--warning-dim)",
          color: closed ? "var(--danger)" : "var(--warning)",
        }}
      >
        <Icon size={28} aria-hidden />
      </div>
      <h1 className="mt-6 text-2xl font-semibold text-[var(--text-primary)] md:text-3xl">
        {closed ? `${label}系統關閉中` : `${label}維護中`}
      </h1>
      <p className="mt-3 max-w-md text-sm leading-7 text-[var(--text-secondary)]">
        {closed
          ? "此模組目前已由系統管理員關閉，平台其他功能不受影響。"
          : "此模組暫時停止服務，平台其他功能不受影響，您可以從左側選單前往其他模組。"}
      </p>
      {reason && (
        <p className="mt-4 max-w-md rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-sm leading-6 text-[var(--text-secondary)] shadow-sm">
          {reason}
        </p>
      )}
      {until && (
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          預計恢復：{new Date(until * 1000).toLocaleString()}
        </p>
      )}
      <div className="mt-7 flex flex-col gap-3 sm:flex-row">
        <button type="button" onClick={() => refresh()} className="btn btn-primary h-11 px-5">
          <RotateCcw size={16} aria-hidden />
          重新整理
        </button>
        <button type="button" onClick={() => router.push("/")} className="btn btn-ghost h-11 px-5">
          <Home size={16} aria-hidden />
          返回首頁
        </button>
      </div>
    </div>
  );
}
