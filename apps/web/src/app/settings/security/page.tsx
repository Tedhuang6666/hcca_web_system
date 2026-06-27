"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { toast } from "sonner";
import { discordApi, mfaApi, apiErrorMessage } from "@/lib/api";
import type { DiscordBindingOut, MFASetupOut, MFAStatusOut } from "@/lib/types";
import { SectionSkeleton } from "@/components/ui/Skeleton";
import { safeNextPath } from "@/lib/safe-redirect";

export default function SecuritySettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mfaRequired = searchParams.get("mfa_required") === "1";
  const nextPath = safeNextPath(searchParams.get("next"), "/dashboard");
  const autoStarted = useRef(false);

  const [status, setStatus] = useState<MFAStatusOut | null>(null);
  const [setup, setSetup] = useState<MFASetupOut | null>(null);
  const [confirmCode, setConfirmCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [regenerateCode, setRegenerateCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [discordBinding, setDiscordBinding] = useState<DiscordBindingOut | null>(null);
  const [discordBusy, setDiscordBusy] = useState(false);

  const loadStatus = () => {
    setLoading(true);
    mfaApi.status()
      .then(setStatus)
      .catch((e) => toast.error(apiErrorMessage(e, "載入安全設定失敗")))
      .finally(() => setLoading(false));
  };

  // 被 MFA 守衛攔截後自動展開設定流程
  useEffect(() => {
    if (mfaRequired && !autoStarted.current && status !== null && !status.mfa_enabled && !setup) {
      autoStarted.current = true;
      startSetup();
    }
  }, [mfaRequired, status, setup]);

  useEffect(() => {
    loadStatus();
    discordApi.me().then(setDiscordBinding).catch(() => setDiscordBinding({
      linked: false,
      discord_user_id: null,
      username: null,
      global_name: null,
      linked_at: null,
    }));
  }, []);

  useEffect(() => {
    if (!setup?.qr_uri) {
      setQrDataUrl("");
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(setup.qr_uri, {
      width: 220,
      margin: 2,
      color: { dark: "#111827", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [setup?.qr_uri]);

  const startSetup = async () => {
    setBusy(true);
    try {
      const result = await mfaApi.setup();
      setSetup(result);
      setConfirmCode("");
    } catch (e) {
      toast.error(apiErrorMessage(e, "建立 2FA 設定失敗"));
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async () => {
    setBusy(true);
    try {
      await mfaApi.confirm(confirmCode.trim());
      toast.success("2FA 已啟用");
      setRecoveryCodes(setup?.backup_codes ?? []);
      setSetup(null);
      setConfirmCode("");
      if (mfaRequired) {
        // 從 MFA 守衛引導而來：設定完畢後回原頁
        setTimeout(() => router.replace(nextPath), 1200);
      } else {
        loadStatus();
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, "驗證碼錯誤"));
    } finally {
      setBusy(false);
    }
  };

  const disableMfa = async () => {
    setBusy(true);
    try {
      await mfaApi.disable(disableCode.trim());
      toast.success("2FA 已停用");
      setDisableCode("");
      loadStatus();
    } catch (e) {
      toast.error(apiErrorMessage(e, "停用失敗"));
    } finally {
      setBusy(false);
    }
  };

  const regenerateBackupCodes = async () => {
    setBusy(true);
    try {
      const result = await mfaApi.regenerateBackupCodes(regenerateCode.trim());
      setRecoveryCodes(result.backup_codes);
      setRegenerateCode("");
      toast.success("備用碼已重新產生");
      loadStatus();
    } catch (e) {
      toast.error(apiErrorMessage(e, "重產備用碼失敗"));
    } finally {
      setBusy(false);
    }
  };

  const linkDiscord = () => {
    window.location.href = discordApi.loginUrl("/settings/security");
  };

  const unlinkDiscord = async () => {
    setDiscordBusy(true);
    try {
      await discordApi.unlink();
      setDiscordBinding({
        linked: false,
        discord_user_id: null,
        username: null,
        global_name: null,
        linked_at: null,
      });
      toast.success("Discord 綁定已解除");
    } catch (e) {
      toast.error(apiErrorMessage(e, "解除 Discord 綁定失敗"));
    } finally {
      setDiscordBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* MFA 守衛引導橫幅 */}
      {mfaRequired && (
        <div
          className="flex items-start gap-3 rounded-md px-4 py-3 text-sm"
          style={{
            background: "var(--warning-dim)",
            border: "1px solid var(--warning-border)",
            color: "var(--warning)",
          }}
        >
          <span className="text-base leading-none flex-shrink-0">🔐</span>
          <div>
            <p className="font-semibold">需要設定雙重驗證（2FA）才能繼續</p>
            <p className="mt-0.5 text-xs opacity-80">
              您嘗試存取的功能需要管理員啟用 2FA 保護。請依下方步驟完成設定，完成後將自動返回。
            </p>
          </div>
        </div>
      )}

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--primary)" }}>
            SECURITY
          </p>
          <h1 className="mt-1 text-xl font-semibold">安全設定</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            管理帳號的多因素認證
          </p>
        </div>
        <Link href="/profile" className="btn btn-ghost">
          回個人資料
        </Link>
      </header>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <h2 className="text-sm font-semibold">兩步驟驗證</h2>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              {loading ? "讀取中" : status?.mfa_enabled ? "已啟用" : "未啟用"}
            </p>
          </div>
          <span
            className="rounded-full px-2.5 py-1 text-xs font-medium"
            style={status?.mfa_enabled
              ? { background: "var(--success-dim)", color: "var(--success)" }
              : { background: "var(--bg-hover)", color: "var(--text-muted)" }}>
            {status?.mfa_enabled ? "保護中" : "未設定"}
          </span>
        </div>

        {loading ? (
          <div className="p-5"><SectionSkeleton lines={4} /></div>
        ) : status?.mfa_enabled ? (
          <div className="space-y-4 p-5">
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              目前登入後的敏感操作可使用 TOTP 驗證碼做二次確認。
            </p>
            <div className="rounded-lg p-3" style={{ background: "var(--bg-hover)" }}>
              <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                剩餘備用碼
              </p>
              <p className="mt-1 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                {status.backup_code_count} 組
              </p>
            </div>
            {recoveryCodes.length > 0 && (
              <div className="rounded-lg p-4" style={{ background: "var(--warning-dim)", border: "1px solid var(--warning-border)" }}>
                <p className="text-sm font-semibold" style={{ color: "var(--warning)" }}>
                  請立即保存新的備用碼
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {recoveryCodes.map((item) => (
                    <code key={item} className="rounded-md px-2 py-1 text-center font-mono text-sm"
                      style={{ background: "var(--bg-surface)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
                      {item}
                    </code>
                  ))}
                </div>
              </div>
            )}
            <div className="rounded-lg p-4" style={{ border: "1px solid var(--border)" }}>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  重新產生備用碼
                </span>
                <input
                  className="input"
                  inputMode="numeric"
                  maxLength={8}
                  value={regenerateCode}
                  onChange={(e) => setRegenerateCode(e.target.value)}
                  placeholder="輸入目前 2FA 驗證碼"
                />
              </label>
              <button
                className="btn btn-secondary mt-3"
                disabled={busy || regenerateCode.trim().length < 6}
                onClick={regenerateBackupCodes}>
                重新產生備用碼
              </button>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                停用驗證碼
              </span>
              <input
                className="input"
                inputMode="numeric"
                maxLength={8}
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
                placeholder="輸入 6 位數驗證碼"
              />
            </label>
            <button
              className="btn btn-danger"
              disabled={busy || disableCode.trim().length < 6}
              onClick={disableMfa}>
              停用 2FA
            </button>
          </div>
        ) : setup ? (
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-[240px_1fr]">
              <div className="rounded-lg p-4" style={{ background: "var(--bg-hover)" }}>
                <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>掃描 QRCode</p>
                <div
                  className="mt-3 flex min-h-[220px] items-center justify-center rounded-lg bg-white p-2"
                  style={{ border: "1px solid var(--border)" }}>
                  {qrDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qrDataUrl} alt="2FA TOTP QRCode" className="h-[220px] w-[220px]" />
                  ) : (
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>產生中</span>
                  )}
                </div>
              </div>
              <div className="rounded-lg p-4" style={{ background: "var(--bg-hover)" }}>
                <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>手動輸入密鑰</p>
                <p className="mt-2 break-all font-mono text-sm" style={{ color: "var(--text-primary)" }}>
                  {setup.secret}
                </p>
              </div>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                Authenticator URI
              </span>
              <textarea className="input min-h-24 resize-none font-mono text-xs" readOnly value={setup.qr_uri} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                驗證碼
              </span>
              <input
                className="input"
                inputMode="numeric"
                maxLength={8}
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
                placeholder="輸入 App 產生的 6 位數驗證碼"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary" disabled={busy || confirmCode.trim().length < 6} onClick={confirmSetup}>
                啟用 2FA
              </button>
              <button className="btn btn-ghost" disabled={busy} onClick={() => setSetup(null)}>
                取消
              </button>
            </div>
            <div className="rounded-lg p-4" style={{ background: "var(--warning-dim)", border: "1px solid var(--warning-border)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--warning)" }}>
                啟用後請保存這些備用碼
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {setup.backup_codes.map((item) => (
                  <code key={item} className="rounded-md px-2 py-1 text-center font-mono text-sm"
                    style={{ background: "var(--bg-surface)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
                    {item}
                  </code>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 p-5">
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              使用支援 TOTP 的驗證器 App 產生一次性驗證碼。
            </p>
            <button className="btn btn-primary" disabled={busy} onClick={startSetup}>
              設定 2FA
            </button>
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <div
          className="flex items-center justify-between gap-3 px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div>
            <h2 className="text-sm font-semibold">Discord 登入</h2>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              綁定後可直接使用 Discord 登入平台，並接收 Bot 通知。
            </p>
          </div>
          {discordBinding?.linked ? (
            <button
              className="btn btn-ghost btn-sm"
              disabled={discordBusy}
              onClick={unlinkDiscord}
            >
              解除綁定
            </button>
          ) : (
            <button
              className="btn btn-primary btn-sm"
              disabled={discordBusy}
              onClick={linkDiscord}
            >
              連結 Discord
            </button>
          )}
        </div>
        <div className="px-5 py-5">
          <p className="text-sm" style={{ color: "var(--text-primary)" }}>
            {discordBinding?.linked
              ? `已綁定 ${discordBinding.global_name || discordBinding.username || "Discord 帳號"}`
              : "尚未綁定 Discord"}
          </p>
          {discordBinding?.linked_at && (
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              綁定時間：{new Date(discordBinding.linked_at).toLocaleString()}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
