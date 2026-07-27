"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { toast } from "sonner";
import { authApi, mfaApi, apiErrorMessage } from "@/lib/api";
import { cacheCurrentUser } from "@/lib/auth-cache";
import { safeNextPath } from "@/lib/safe-redirect";

export default function MFALoginPage() {
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const [challenge, setChallenge] = useState<string>("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [passkeySubmitting, setPasskeySubmitting] = useState(false);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // challenge token 存放在 server session（不暴露在 URL），需 exchange 取出
    mfaApi.exchangeChallenge()
      .then((data) => {
        setChallenge(data.challenge);
        setPasskeyAvailable(data.passkey_available);
        if (data.passkey_available) void submitWithPasskey(data.challenge);
      })
      .catch(() => {
        window.location.replace("/login?error=" + encodeURIComponent("缺少 2FA 登入挑戰，請重新登入"));
      });
    // challenge token is one-time; re-running this effect would consume a second session challenge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    setSubmitting(true);
    try {
      await mfaApi.verifyLogin(challenge, code.trim());
      const me = await authApi.me();
      cacheCurrentUser(me);
      window.location.replace(next);
    } catch (e) {
      toast.error(apiErrorMessage(e, "驗證失敗，請重新輸入"));
    } finally {
      setSubmitting(false);
    }
  };

  const submitWithPasskey = async (challengeToken = challenge) => {
    if (!challengeToken) return;
    setPasskeySubmitting(true);
    try {
      const optionResult = await mfaApi.authenticationOptions(challengeToken);
      const assertion = await startAuthentication({
        optionsJSON: optionResult.options as unknown as Parameters<typeof startAuthentication>[0]["optionsJSON"],
      });
      await mfaApi.verifyAuthentication(optionResult.transaction_id, assertion);
      const me = await authApi.me();
      cacheCurrentUser(me);
      window.location.replace(next);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Passkey 驗證失敗，請改用驗證器 App"));
      codeInputRef.current?.focus();
    } finally {
      setPasskeySubmitting(false);
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

        {passkeyAvailable && (
          <button
            className="btn btn-primary w-full"
            disabled={passkeySubmitting || submitting || !challenge}
            onClick={() => void submitWithPasskey()}>
            {passkeySubmitting ? "Passkey 驗證中" : "使用 Passkey 驗證"}
          </button>
        )}

        {passkeyAvailable && (
          <div className="my-5 flex items-center gap-3 text-xs" style={{ color: "var(--text-muted)" }}>
            <span className="h-px flex-1" style={{ background: "var(--border)" }} />
            或輸入驗證器 App／備用碼
            <span className="h-px flex-1" style={{ background: "var(--border)" }} />
          </div>
        )}

        <label className="block space-y-1.5">
          <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>驗證碼</span>
          <input
            className="input text-center font-mono text-lg tracking-widest"
            ref={codeInputRef}
            autoFocus
            inputMode="numeric"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && code.trim().length >= 6 && challenge) void submit();
            }}
            placeholder="000000"
          />
        </label>

        <button
          className="btn btn-primary mt-5 w-full"
          disabled={submitting || !challenge || code.trim().length < 6}
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
