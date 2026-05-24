"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function MaintenanceContent() {
  const router = useRouter();
  const params = useSearchParams();
  const kind = params.get("kind") ?? "maintenance";
  const detail = params.get("detail") ?? "";
  const initialRetry = Math.max(5, Math.min(120, parseInt(params.get("retry") ?? "30", 10) || 30));
  const [countdown, setCountdown] = useState(initialRetry);

  useEffect(() => {
    if (countdown <= 0) {
      // 指數退避：每次重試後延長下一輪倒數，避免雷鳴
      router.back();
      return;
    }
    const t = setTimeout(() => setCountdown((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, router]);

  const title = kind === "maintenance" ? "系統維護中" : "伺服器忙碌中";
  const subtitle =
    kind === "maintenance"
      ? "目前正在進行系統維護或緊急處理，請稍後再回來。"
      : "目前同時使用人數過多，已自動將管理員與緊急請求優先處理，請稍後再試。";

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
      <div className="max-w-lg w-full bg-white rounded-xl shadow-lg p-8 text-center">
        <div className="text-6xl mb-4" aria-hidden>
          {kind === "maintenance" ? "🛠" : "⏳"}
        </div>
        <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
        <p className="mt-3 text-slate-600">{subtitle}</p>
        {detail && (
          <p className="mt-4 rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            {decodeURIComponent(detail)}
          </p>
        )}
        <div className="mt-6">
          <div className="text-sm text-slate-500">將在</div>
          <div className="text-4xl font-mono font-bold text-slate-800 my-2">{countdown}s</div>
          <div className="text-sm text-slate-500">後自動重試</div>
        </div>
        <div className="mt-6 flex gap-3 justify-center">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700"
          >
            立即重試
          </button>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="px-4 py-2 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            返回首頁
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MaintenancePage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <MaintenanceContent />
    </Suspense>
  );
}
