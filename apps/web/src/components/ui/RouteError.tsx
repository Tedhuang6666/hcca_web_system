"use client";
import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/**
 * Next.js App Router 共用錯誤邊界元件。
 * 在各 route segment 的 error.tsx 中呼叫即可，無須重寫樣板。
 */
export default function RouteError({
  error,
  reset,
  scope = "頁面",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  scope?: string;
}) {
  useEffect(() => {
    console.error(`[${scope}] route error`, error);
  }, [error, scope]);

  return (
    <div className="max-w-md mx-auto py-20 text-center flex flex-col items-center gap-4">
      <AlertTriangle size={48} className="opacity-40" style={{ color: "var(--danger)" }} aria-hidden={true} />
      <div>
        <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
          {scope}載入失敗
        </h2>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          可能是網路暫時不穩，或伺服器有狀況。
        </p>
        {error.digest && (
          <p className="text-xs mt-2 font-mono" style={{ color: "var(--text-disabled)" }}>
            錯誤代碼：{error.digest}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={reset} className="btn btn-primary">重新嘗試</button>
        <Link href="/" className="btn" style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
          返回首頁
        </Link>
      </div>
    </div>
  );
}
