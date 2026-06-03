"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ApiError, authApi, mfaApi } from "@/lib/api";
import { cacheCurrentUser } from "@/lib/auth-cache";
import { safeNextPath } from "@/lib/safe-redirect";

export default function MFALoginPage() {
  const searchParams = useSearchParams();
  const challenge = searchParams.get("challenge") ?? "";
  const next = safeNextPath(searchParams.get("next"));
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!challenge) {
      window.location.replace("/login?error=缺少 2FA 登入挑戰，請重新登入");
    }
  }, [challenge]);

  const submit = async () => {
    setSubmitting(true);
    try {
      await mfaApi.verifyLogin(challenge, code.trim());
      const me = await authApi.me();
      cacheCurrentUser(me);
      window.location.replace(next);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "驗證失敗，請重新輸入");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--bg-base)" }}>
      <main className="w-full max-w-sm rounded-2xl p-8 animate-slide-in"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)" }}>
        <div className="mb-6">
          <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--primary)" }}>
            TWO-FACTOR AUTH
          </p>
          <h1 className="mt-1 text-xl font-bold">輸入 2FA 驗證碼</h1>
          <p className="mt-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
            請輸入驗證器 App 的 6 位數代碼，或使用一組未使用過的備用碼。
          </p>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>驗證碼</span>
          <input
            className="input text-center font-mono text-lg tracking-widest"
            autoFocus
            inputMode="numeric"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && code.trim().length >= 6) void submit();
            }}
            placeholder="000000"
          />
        </label>

        <button
          className="btn btn-primary mt-5 w-full"
          disabled={submitting || code.trim().length < 6}
          onClick={submit}>
          {submitting ? "驗證中" : "完成登入"}
        </button>

        <Link href="/login" className="mt-4 block text-center text-xs"
          style={{ color: "var(--text-muted)", textDecoration: "none" }}>
          重新登入
        </Link>
      </main>
    </div>
  );
}
