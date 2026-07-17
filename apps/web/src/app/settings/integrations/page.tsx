"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  CalendarDays,
  CheckCircle,
  ExternalLink,
  Link2,
  Link2Off,
  Loader2,
  MessageCircle,
  RefreshCw,
  Table2,
} from "lucide-react";
import { discordApi, googleTasksApi, lineApi, type GoogleTasksStatus } from "@/lib/api";
import type { DiscordBindingOut, LineBindingOut, LineLinkCodeOut } from "@/lib/types";

export default function IntegrationsPage() {
  const [status, setStatus] = useState<GoogleTasksStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [discord, setDiscord] = useState<DiscordBindingOut | null>(null);
  const [line, setLine] = useState<LineBindingOut | null>(null);
  const [discordBusy, setDiscordBusy] = useState(false);
  const [lineBusy, setLineBusy] = useState(false);
  const [lineCode, setLineCode] = useState<LineLinkCodeOut | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "true") {
      toast.success("Google Tasks 已成功連結");
      window.history.replaceState({}, "", "/settings/integrations");
    }
    const err = params.get("error");
    if (err) {
      const messages: Record<string, string> = {
        session_expired: "授權工作階段已過期，請重試",
        oauth_error: "Google 授權失敗，請重試",
        encryption_not_configured: "伺服器加密未設定，請聯絡管理員",
        save_failed: "儲存 token 失敗，請重試",
      };
      toast.error(messages[err] ?? "連結失敗");
      window.history.replaceState({}, "", "/settings/integrations");
    }

    Promise.allSettled([
      googleTasksApi.status(),
      discordApi.me(),
      lineApi.me(),
    ])
      .then(([googleTasks, discordBinding, lineBinding]) => {
        if (googleTasks.status === "fulfilled") setStatus(googleTasks.value);
        else toast.error("無法載入 Google Tasks 整合狀態");
        if (discordBinding.status === "fulfilled") setDiscord(discordBinding.value);
        if (lineBinding.status === "fulfilled") setLine(lineBinding.value);
      })
      .finally(() => setLoading(false));
  }, []);

  function handleConnect() {
    window.location.href = googleTasksApi.authorizeUrl();
  }

  async function handleDisconnect() {
    if (!confirm("確定要解除 Google Tasks 連結？未來的工作項目將不再同步。")) return;
    setDisconnecting(true);
    try {
      await googleTasksApi.disconnect();
      setStatus((prev) => prev ? { ...prev, is_connected: false, authorized_email: null } : null);
      toast.success("已解除 Google Tasks 連結");
    } catch {
      toast.error("解除連結失敗");
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const result = await googleTasksApi.sync();
      toast.success(
        `同步完成：推送 ${result.pushed} 筆，從 Google 匯入 ${result.pulled_created} 筆`
      );
      const newStatus = await googleTasksApi.status();
      setStatus(newStatus);
    } catch {
      toast.error("同步失敗，請確認 Google Tasks 授權是否有效");
    } finally {
      setSyncing(false);
    }
  }

  function connectDiscord() {
    window.location.href = discordApi.loginUrl("/settings/integrations");
  }

  async function disconnectDiscord() {
    setDiscordBusy(true);
    try {
      await discordApi.unlink();
      setDiscord({
        linked: false,
        discord_user_id: null,
        username: null,
        global_name: null,
        linked_at: null,
      });
      toast.success("已解除 Discord 連結");
    } catch {
      toast.error("解除 Discord 連結失敗");
    } finally {
      setDiscordBusy(false);
    }
  }

  async function createLineCode() {
    setLineBusy(true);
    try {
      setLineCode(await lineApi.createLinkCode());
      toast.success("LINE 綁定碼已產生");
    } catch {
      toast.error("產生 LINE 綁定碼失敗");
    } finally {
      setLineBusy(false);
    }
  }

  async function disconnectLine() {
    setLineBusy(true);
    try {
      await lineApi.unlink();
      setLine({ linked: false, line_display_name: null, linked_at: null });
      setLineCode(null);
      toast.success("已解除 LINE 連結");
    } catch {
      toast.error("解除 LINE 連結失敗");
    } finally {
      setLineBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          外部整合
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          連結第三方服務，將個人通知與工作流程同步到您慣用的工具。
        </p>
      </div>

      <div
        className="rounded-xl p-5 space-y-4"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "#e8f0fe", border: "1px solid #c5d8ff" }}
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path fill="#4285F4" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                <path fill="#fff" d="M8 10h8v1.5H8zm0 2.5h8V14H8zm0 2.5h5.5V16.5H8z" />
                <path fill="#fff" d="M7 7.5h10v2H7z" />
              </svg>
            </div>
            <div>
              <p className="font-medium" style={{ color: "var(--text-primary)" }}>
                Google Tasks
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                工作項目雙向同步至 Google Tasks 清單「HCCA 工作」
              </p>
            </div>
          </div>

          {loading ? (
            <Loader2 size={18} className="animate-spin flex-shrink-0" style={{ color: "var(--text-muted)" }} />
          ) : status?.is_connected ? (
            <span
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full flex-shrink-0"
              style={{ background: "var(--success-dim)", color: "var(--success)", border: "1px solid var(--success-border, var(--border))" }}
            >
              <CheckCircle size={12} aria-hidden={true} />
              已連結
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full flex-shrink-0"
              style={{ background: "var(--bg-hover)", color: "var(--text-muted)", border: "1px solid var(--border)" }}
            >
              未連結
            </span>
          )}
        </div>

        {!loading && status?.is_connected && (
          <div
            className="rounded-lg px-4 py-3 space-y-1 text-sm"
            style={{ background: "var(--bg-muted)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center justify-between">
              <span style={{ color: "var(--text-muted)" }}>授權帳號</span>
              <span style={{ color: "var(--text-primary)" }}>{status.authorized_email ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ color: "var(--text-muted)" }}>上次同步</span>
              <span style={{ color: "var(--text-primary)" }}>
                {status.last_sync_at
                  ? new Date(status.last_sync_at).toLocaleString("zh-TW")
                  : "尚未同步"}
              </span>
            </div>
            {status.last_error && (
              <div className="flex items-start gap-2 mt-1">
                <span className="text-xs mt-0.5" style={{ color: "var(--danger)" }}>
                  {status.last_error}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {!loading && !status?.is_connected && (
            <button
              type="button"
              onClick={handleConnect}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
              style={{ background: "var(--primary)", color: "#fff" }}
            >
              <Link2 size={15} aria-hidden={true} />
              連結 Google Tasks
            </button>
          )}

          {!loading && status?.is_connected && (
            <>
              <button
                type="button"
                onClick={handleSync}
                disabled={syncing}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60"
                style={{
                  background: "var(--primary-dim)",
                  color: "var(--primary)",
                  border: "1px solid var(--info-border)",
                }}
              >
                {syncing ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden={true} />
                ) : (
                  <RefreshCw size={14} aria-hidden={true} />
                )}
                立即同步
              </button>

              <button
                type="button"
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60"
                style={{
                  background: "var(--danger-dim)",
                  color: "var(--danger)",
                  border: "1px solid var(--danger-border)",
                }}
              >
                {disconnecting ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden={true} />
                ) : (
                  <Link2Off size={14} aria-hidden={true} />
                )}
                解除連結
              </button>

              <a
                href="https://tasks.google.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
                style={{
                  background: "transparent",
                  color: "var(--text-muted)",
                  border: "1px solid var(--border)",
                  textDecoration: "none",
                }}
              >
                <ExternalLink size={13} aria-hidden={true} />
                開啟 Google Tasks
              </a>
            </>
          )}
        </div>

        <p className="text-xs" style={{ color: "var(--text-disabled)" }}>
          連結後，您指派給自己的工作項目將自動同步到 Google Tasks 的「HCCA 工作」清單。
          在 Google Tasks 中建立的任務也可手動匯入。
        </p>
      </div>

      <div
        className="rounded-xl p-5 space-y-4"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "#5865f2", color: "#fff" }}
              aria-hidden="true"
            >
              <MessageCircle size={20} />
            </div>
            <div>
              <p className="font-medium" style={{ color: "var(--text-primary)" }}>Discord</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                綁定帳號以同步組織身分組與 Discord 通知。
              </p>
            </div>
          </div>
          {loading ? (
            <Loader2 size={18} className="animate-spin flex-shrink-0" style={{ color: "var(--text-muted)" }} />
          ) : discord?.linked ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full flex-shrink-0" style={{ background: "var(--success-dim)", color: "var(--success)", border: "1px solid var(--success-border, var(--border))" }}>
              <CheckCircle size={12} aria-hidden={true} />
              已連結
            </span>
          ) : (
            <span className="inline-flex text-xs font-medium px-2 py-1 rounded-full flex-shrink-0" style={{ background: "var(--bg-hover)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>未連結</span>
          )}
        </div>
        {!loading && discord?.linked && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            已連結：{discord.global_name || discord.username || "Discord 帳號"}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {!loading && !discord?.linked ? (
            <button type="button" onClick={connectDiscord} className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium" style={{ background: "#5865f2", color: "#fff" }}>
              <Link2 size={15} aria-hidden={true} />
              連結 Discord
            </button>
          ) : !loading ? (
            <button type="button" onClick={disconnectDiscord} disabled={discordBusy} className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60" style={{ background: "var(--danger-dim)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>
              {discordBusy ? <Loader2 size={14} className="animate-spin" /> : <Link2Off size={14} aria-hidden={true} />}
              解除連結
            </button>
          ) : null}
        </div>
      </div>

      <div
        className="rounded-xl p-5 space-y-4"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#06c755", color: "#fff" }} aria-hidden="true">
              <MessageCircle size={20} />
            </div>
            <div>
              <p className="font-medium" style={{ color: "var(--text-primary)" }}>LINE</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                綁定 LINE Bot，接收即時通知與快速登入連結。
              </p>
            </div>
          </div>
          {loading ? (
            <Loader2 size={18} className="animate-spin flex-shrink-0" style={{ color: "var(--text-muted)" }} />
          ) : line?.linked ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full flex-shrink-0" style={{ background: "var(--success-dim)", color: "var(--success)", border: "1px solid var(--success-border, var(--border))" }}>
              <CheckCircle size={12} aria-hidden={true} />
              已連結
            </span>
          ) : (
            <span className="inline-flex text-xs font-medium px-2 py-1 rounded-full flex-shrink-0" style={{ background: "var(--bg-hover)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>未連結</span>
          )}
        </div>
        {!loading && line?.linked && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            已連結：{line.line_display_name || "LINE 帳號"}
          </p>
        )}
        {!loading && lineCode && !line?.linked && (
          <div className="rounded-lg px-4 py-3 text-sm" style={{ background: "var(--bg-muted)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
            <p>{lineCode.instructions}</p>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              有效至 {new Date(lineCode.expires_at).toLocaleString("zh-TW")}
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {!loading && !line?.linked ? (
            <button type="button" onClick={createLineCode} disabled={lineBusy} className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60" style={{ background: "#06c755", color: "#fff" }}>
              {lineBusy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={15} aria-hidden={true} />}
              產生綁定碼
            </button>
          ) : !loading ? (
            <button type="button" onClick={disconnectLine} disabled={lineBusy} className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60" style={{ background: "var(--danger-dim)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>
              {lineBusy ? <Loader2 size={14} className="animate-spin" /> : <Link2Off size={14} aria-hidden={true} />}
              解除連結
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl p-5 space-y-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "#e8f0fe", color: "#4285f4" }} aria-hidden="true"><CalendarDays size={20} /></div>
            <div>
              <p className="font-medium" style={{ color: "var(--text-primary)" }}>Google 日曆</p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>組織行事曆雙向同步</p>
            </div>
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>由具日曆管理權限的成員為組織連結及選擇同步日曆。</p>
          <Link href="/admin/calendar/google" className="inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: "var(--primary)" }}>
            管理 Google 日曆 <ExternalLink size={13} aria-hidden={true} />
          </Link>
        </div>
        <div className="rounded-xl p-5 space-y-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "#e6f4ea", color: "#188038" }} aria-hidden="true"><Table2 size={20} /></div>
            <div>
              <p className="font-medium" style={{ color: "var(--text-primary)" }}>Google 試算表</p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>財務總帳匯出與同步</p>
            </div>
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>與組織 Google 授權共用；完成日曆授權後即可在財務總帳輸出資料。</p>
          <Link href="/admin/calendar/google" className="inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: "var(--primary)" }}>
            前往組織 Google 授權 <ExternalLink size={13} aria-hidden={true} />
          </Link>
        </div>
      </div>
    </div>
  );
}
