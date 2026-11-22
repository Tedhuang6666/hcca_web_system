"use client";

import { Suspense } from "react";
import { ModuleStatusProvider } from "@/contexts/ModuleStatusContext";
import ModuleMaintenance from "@/components/ui/ModuleMaintenance";
import { FE_MODULES, type ModuleId } from "@/lib/modules";
import { useSearchParams } from "next/navigation";

function isModuleId(value: string | null): value is ModuleId {
  return Boolean(value && value in FE_MODULES);
}

function ModuleStatusContent() {
  const params = useSearchParams();
  const moduleId = params.get("module");

  if (!isModuleId(moduleId)) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--bg-base)] px-5 text-center">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">找不到模組狀態</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">請返回上一頁後再試一次。</p>
        </div>
      </main>
    );
  }

  return (
    <ModuleStatusProvider authenticated={false}>
      <main className="min-h-screen bg-[var(--bg-base)] px-5 text-[var(--text-primary)] md:px-8">
        <div className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center">
          <ModuleMaintenance moduleId={moduleId} />
        </div>
      </main>
    </ModuleStatusProvider>
  );
}

export default function ModuleStatusPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--bg-base)]" />}>
      <ModuleStatusContent />
    </Suspense>
  );
}
