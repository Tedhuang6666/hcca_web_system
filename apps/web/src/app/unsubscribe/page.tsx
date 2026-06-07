"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import BrandEmblem from "@/components/brand/BrandEmblem";
import { ApiError, notificationsApi } from "@/lib/api";

type Status = "idle" | "loading" | "done" | "error";

function UnsubscribeInner() {
  const token = useSearchParams().get("token") ?? "";
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  const handleUnsubscribe = async () => {
    setStatus("loading");
    try {
      const res = await notificationsApi.unsubscribe(token);
      setMessage(res.message);
      setStatus("done");
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "退訂失敗，連結可能已失效");
      setStatus("error");
    }
  };

  return (
    <main
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: "var(--bg-base)" }}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-3 px-6 py-5" style={{ background: "#1a1a2e" }}>
          <BrandEmblem size={40} />
          <div>
            <p className="text-sm font-semibold text-white">校園自治整合平台</p>
            <p className="text-[10px] font-medium tracking-widest" style={{ color: "#c9a84c" }}>
              HCCA
            </p>
          </div>
        </div>

        <div className="px-6 py-7">
          <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            退訂 Email 通知
          </h1>

          {!token ? (
            <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
              退訂連結無效或缺少參數，請從 Email 中重新點擊連結。
            </p>
          ) : status === "done" ? (
            <p className="mt-3 text-sm" style={{ color: "var(--success)" }}>
              {message}
            </p>
          ) : status === "error" ? (
            <p className="mt-3 text-sm" style={{ color: "var(--danger)" }}>
              {message}
            </p>
          ) : (
            <>
              <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
                確認後將關閉此類通知的 Email 寄送。您仍可在登入後的「通知設定」中隨時重新開啟，
                站內通知不受影響。
              </p>
              <button
                type="button"
                className="btn btn-primary mt-5 w-full"
                disabled={status === "loading"}
                onClick={handleUnsubscribe}
              >
                {status === "loading" ? "處理中…" : "確認退訂"}
              </button>
            </>
          )}

          <div className="mt-6 flex gap-4 text-sm">
            <Link href="/settings/notifications" style={{ color: "var(--primary)" }}>
              通知設定
            </Link>
            <Link href="/" style={{ color: "var(--text-muted)" }}>
              回首頁
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={null}>
      <UnsubscribeInner />
    </Suspense>
  );
}
