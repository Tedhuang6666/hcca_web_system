"use client";

import { useEffect, useState } from "react";

import { apiErrorMessage } from "@/lib/api-helpers";

export default function PasskeyLogin({ nextPath }: { nextPath: string }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      setReady(localStorage.getItem("hcca_passkey_enabled") === "1");
    } catch {
      setReady(false);
    }
  }, []);

  if (!ready) return null;

  const handlePasskeyLogin = async () => {
    setBusy(true);
    try {
      const [webauthn, { mfaApi }, { authApi }, { cacheCurrentUser }, { safeNextPath }] =
        await Promise.all([
          import("@simplewebauthn/browser"),
          import("@/lib/api/mfa"),
          import("@/lib/api/auth"),
          import("@/lib/auth-cache"),
          import("@/lib/safe-redirect"),
        ]);
      const optionResult = await mfaApi.authenticationOptions();
      const assertion = await webauthn.startAuthentication({
        optionsJSON: optionResult.options as unknown as Parameters<
          typeof webauthn.startAuthentication
        >[0]["optionsJSON"],
      });
      await mfaApi.verifyAuthentication(optionResult.transaction_id, assertion);
      cacheCurrentUser(await authApi.me());
      window.location.replace(safeNextPath(nextPath, "/dashboard"));
    } catch (error) {
      window.history.replaceState(null, "", window.location.pathname);
      alert(apiErrorMessage(error, "生物辨識快速登入失敗，請改用 Google 或 Discord 登入"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="my-7 flex items-center gap-4">
        <div className="h-px flex-1" style={{ background: "var(--border)" }} />
        <span className="text-[11px] tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
          本機快速登入
        </span>
        <div className="h-px flex-1" style={{ background: "var(--border)" }} />
      </div>
      <button
        type="button"
        className="flex h-13 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{
          background: "var(--bg-surface)",
          color: "var(--text-primary)",
          border: "1px solid var(--border-strong)",
          boxShadow: "var(--shadow-sm)",
        }}
        disabled={busy}
        onClick={handlePasskeyLogin}
      >
        <span aria-hidden="true">🔐</span>
        {busy ? "生物辨識驗證中" : "使用指紋／臉部辨識快速登入"}
      </button>
    </>
  );
}
