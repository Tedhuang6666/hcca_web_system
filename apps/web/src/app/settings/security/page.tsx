"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ApiError, mfaApi } from "@/lib/api";
import type { MFASetupOut, MFAStatusOut } from "@/lib/types";

export default function SecuritySettingsPage() {
  const [status, setStatus] = useState<MFAStatusOut | null>(null);
  const [setup, setSetup] = useState<MFASetupOut | null>(null);
  const [confirmCode, setConfirmCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [regenerateCode, setRegenerateCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadStatus = () => {
    setLoading(true);
    mfaApi.status()
      .then(setStatus)
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "載入安全設定失敗"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const startSetup = async () => {
    setBusy(true);
    try {
      const result = await mfaApi.setup();
      setSetup(result);
      setConfirmCode("");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "建立 2FA 設定失敗");
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
      loadStatus();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "驗證碼錯誤");
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
      toast.error(e instanceof ApiError ? e.message : "停用失敗");
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
      toast.error(e instanceof ApiError ? e.message : "重產備用碼失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
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
          <div className="flex justify-center py-16">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-t-transparent"
              style={{ borderColor: "var(--border-strong)", borderTopColor: "var(--primary)" }} />
          </div>
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
            <div className="rounded-lg p-4" style={{ background: "var(--bg-hover)" }}>
              <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>手動輸入密鑰</p>
              <p className="mt-2 break-all font-mono text-sm" style={{ color: "var(--text-primary)" }}>
                {setup.secret}
              </p>
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
    </div>
  );
}
