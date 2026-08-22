"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";

export default function PublicRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("公開頁面載入失敗", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[52vh] w-full max-w-6xl items-center px-4 sm:px-6">
      <EmptyState
        icon={<AlertTriangle size={40} aria-hidden />}
        title="暫時無法載入這個頁面"
        description="請檢查網路後重試；若問題持續發生，請稍後再回來。"
        action={{ label: "重新載入", onClick: reset }}
      />
    </main>
  );
}
