"use client";

import { useEffect, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import { apiErrorMessage, mfaApi } from "@/lib/api";
import { getAuthItem } from "@/lib/auth-cache";
import type { PasskeyRegistrationOptionsOut } from "@/lib/types";

const PASSKEY_ENABLED_KEY = "hcca_passkey_enabled";
const PASSKEY_PROMPTED_KEY = "hcca_passkey_prompted";

function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));
}

async function supportsPlatformAuthenticator(): Promise<boolean> {
  const publicKey = window.PublicKeyCredential;
  if (!publicKey || typeof publicKey.isUserVerifyingPlatformAuthenticatorAvailable !== "function") {
    return false;
  }
  return publicKey.isUserVerifyingPlatformAuthenticatorAvailable();
}

function userKey(suffix: string, userId: string): string {
  return `${suffix}:${userId}`;
}

export default function PasskeySetupPrompt() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<PasskeyRegistrationOptionsOut | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function prepare() {
      if (!isMobileDevice()) return;
      const userId = getAuthItem("user_id");
      if (!userId) return;
      if (
        localStorage.getItem(PASSKEY_ENABLED_KEY) === "1"
        || localStorage.getItem(userKey(PASSKEY_PROMPTED_KEY, userId)) === "1"
      ) {
        return;
      }
      if (!(await supportsPlatformAuthenticator())) return;

      try {
        const existing = await mfaApi.passkeys();
        if (existing.length > 0) {
          localStorage.setItem(PASSKEY_ENABLED_KEY, "1");
          return;
        }
        const result = await mfaApi.registrationOptions();
        if (!cancelled) {
          // 問過一次就不再重複打擾；即使使用者稍後取消或設定失敗，也可到安全設定頁手動重試。
          localStorage.setItem(userKey(PASSKEY_PROMPTED_KEY, userId), "1");
          setOptions(result);
          setVisible(true);
        }
      } catch {
        // Passkey is optional; a failed capability check must not interrupt login.
      }
    }

    void prepare();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = () => {
    const userId = getAuthItem("user_id");
    if (userId) localStorage.setItem(userKey(PASSKEY_PROMPTED_KEY, userId), "1");
    setVisible(false);
  };

  const enable = async () => {
    if (!options) return;
    setBusy(true);
    try {
      const credential = await startRegistration({
        optionsJSON: options.options as unknown as Parameters<typeof startRegistration>[0]["optionsJSON"],
      });
      await mfaApi.verifyRegistration(options.transaction_id, credential, "手機生物辨識");
      localStorage.setItem(PASSKEY_ENABLED_KEY, "1");
      const userId = getAuthItem("user_id");
      if (userId) localStorage.setItem(userKey(PASSKEY_PROMPTED_KEY, userId), "1");
      setVisible(false);
      toast.success("已啟用手機生物辨識，下次可快速登入");
    } catch (error) {
      toast.error(apiErrorMessage(error, "生物辨識啟用失敗，仍可使用 Google 或 Discord 登入"));
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal title="啟用手機生物辨識" onClose={dismiss} size="sm" mobileFullscreen={false}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={dismiss}>
            之後再說
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !options} onClick={enable}>
            {busy ? "設定中" : "啟用指紋／臉部辨識"}
          </button>
        </>
      )}
    >
      <p className="text-sm leading-6" style={{ color: "var(--text-secondary)" }}>
        這台手機支援生物辨識。啟用後，之後可在登入頁使用指紋或臉部辨識快速登入；
        一般登入仍可使用 Google 或 Discord。
      </p>
    </Modal>
  );
}
