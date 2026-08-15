"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { CheckCircle2, KeyRound, ShieldCheck } from "lucide-react";
import { authApi, mfaApi, apiErrorMessage } from "@/lib/api";
import { cacheCurrentUser } from "@/lib/auth-cache";
import { BRANDING } from "@/lib/branding";
import { safeNextPath } from "@/lib/safe-redirect";
import OtpInput from "@/components/auth/OtpInput";

const MFA_THEME_STYLE = {
  "--mfa-accent": BRANDING.themeColor,
  "--mfa-accent-fg": "#ffffff",
} as CSSProperties;

export default function MFALoginPage() {
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const [challenge, setChallenge] = useState<string>("");
  const [code, setCode] = useState("");
  const [codeMode, setCodeMode] = useState<"totp" | "backup">("totp");
  const [submitting, setSubmitting] = useState(false);
  const [passkeySubmitting, setPasskeySubmitting] = useState(false);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [verificationError, setVerificationError] = useState("");
  const [verified, setVerified] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const challengeExchangeStarted = useRef(false);
  const codeLength = codeMode === "totp" ? 6 : 16;
  const codeComplete = code.length === codeLength;

  useEffect(() => {
    if (challengeExchangeStarted.current) return;
    challengeExchangeStarted.current = true;

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

  const submit = async (submittedCode = code) => {
    if (!challenge || submittedCode.length !== codeLength || submitting) return;
    setSubmitting(true);
    setVerificationError("");
    try {
      await mfaApi.verifyLogin(challenge, submittedCode);
      setVerified(true);
      const me = await authApi.me();
      cacheCurrentUser(me);
      await new Promise((resolve) => window.setTimeout(resolve, 420));
      window.location.replace(next);
    } catch (e) {
      setVerificationError(apiErrorMessage(e, "驗證失敗，請重新輸入"));
      setCode("");
      window.setTimeout(() => setVerificationError(""), 520);
      codeInputRef.current?.focus();
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
      setVerificationError(apiErrorMessage(e, "Passkey 驗證失敗，請改用驗證器 App"));
      codeInputRef.current?.focus();
    } finally {
      setPasskeySubmitting(false);
    }
  };

  const switchCodeMode = () => {
    setCodeMode((current) => (current === "totp" ? "backup" : "totp"));
    setCode("");
    setVerificationError("");
    window.requestAnimationFrame(() => codeInputRef.current?.focus());
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center p-4 sm:p-6"
      style={{ ...MFA_THEME_STYLE, background: "var(--bg-base)" }}
    >
      <main
        className="w-full max-w-md animate-slide-in rounded-2xl p-6 sm:p-8"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)" }}
      >
        <div className="mb-8">
          <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl"
            style={{
              background: "color-mix(in srgb, var(--mfa-accent) 12%, var(--bg-surface))",
              color: "var(--mfa-accent)",
            }}>
            <ShieldCheck size={23} aria-hidden="true" />
          </div>
          <p className="text-xs font-semibold tracking-[0.16em]" style={{ color: "var(--mfa-accent)" }}>
            TWO-FACTOR AUTH
          </p>
          <h1 className="mt-1 text-xl font-bold" style={{ color: "var(--text-primary)" }}>
            完成安全驗證
          </h1>
          <p className="mt-2 text-sm leading-6" style={{ color: "var(--text-muted)" }}>
            開啟驗證器 App，輸入目前顯示的 6 位數代碼以繼續登入。
          </p>
        </div>

        {passkeyAvailable && (
          <button
            className="btn btn-secondary w-full"
            style={{
              background: "transparent",
              color: "var(--mfa-accent)",
              borderColor: "var(--mfa-accent)",
            }}
            disabled={passkeySubmitting || submitting || !challenge}
            onClick={() => void submitWithPasskey()}>
            <KeyRound size={16} aria-hidden="true" />
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

        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              {codeMode === "totp" ? "驗證器 App 代碼" : "備用碼"}
            </span>
            <span className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>
              {code.length}/{codeLength}
            </span>
          </div>
          <OtpInput
            value={code}
            onChange={(nextCode) => {
              setCode(nextCode);
              setVerificationError("");
            }}
            mode={codeMode === "totp" ? "numeric" : "backup"}
            label={codeMode === "totp" ? "驗證器 App 6 位數代碼" : "16 位備用碼"}
            describedBy="mfa-code-hint mfa-code-error"
            error={Boolean(verificationError)}
            status={verified ? "success" : "idle"}
            disabled={submitting || passkeySubmitting}
            autoFocus
            firstInputRef={codeInputRef}
            onComplete={(completeCode) => {
              if (challenge && !submitting) void submit(completeCode);
            }}
            onEnter={() => {
              if (challenge && codeComplete) void submit();
            }}
          />
          <p id="mfa-code-hint" className="mt-3 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            {codeMode === "totp"
              ? "代碼每 30 秒更新一次，填滿後會自動驗證。"
              : "備用碼為設定 2FA 時產生的 16 位英數字串。"}
          </p>
          {verificationError && (
            <p id="mfa-code-error" className="mt-3 text-center text-sm" style={{ color: "var(--danger)" }} role="alert" aria-live="assertive">
              {verificationError}
            </p>
          )}
          {verified && (
            <p className="mt-3 flex items-center justify-center gap-1.5 text-sm" style={{ color: "var(--success)" }} role="status">
              <CheckCircle2 size={16} aria-hidden="true" />
              驗證成功，正在完成登入…
            </p>
          )}
        </div>

        <button
          className="btn btn-primary mt-5 w-full"
          style={{
            background: "var(--mfa-accent)",
            borderColor: "var(--mfa-accent)",
            color: "var(--mfa-accent-fg)",
            boxShadow: "0 4px 18px color-mix(in srgb, var(--mfa-accent) 24%, transparent)",
          }}
          disabled={submitting || passkeySubmitting || !challenge || !codeComplete}
          onClick={() => void submit()}>
          {submitting ? "驗證中" : "完成登入"}
        </button>

        <button
          type="button"
          className="mx-auto mt-4 block text-xs font-medium underline underline-offset-4"
          style={{ color: "var(--mfa-accent)" }}
          disabled={submitting || passkeySubmitting}
          onClick={switchCodeMode}
        >
          {codeMode === "totp" ? "改用備用碼" : "改用驗證器 App"}
        </button>

        <Link href="/login" className="mt-4 block text-center text-xs"
          style={{ color: "var(--text-muted)", textDecoration: "none" }}>
          重新登入
        </Link>
      </main>
    </div>
  );
}
