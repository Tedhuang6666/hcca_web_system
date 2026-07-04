"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ApiError, googleCalendarApi, orgsApi } from "@/lib/api";
import { orgDisplayName } from "@/lib/orgs";
import type { GoogleCalendarStatusOut, OrgRead } from "@/lib/types";

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return "從未";
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "剛剛";
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export default function GoogleCalendarAdminPage() {
  const searchParams = useSearchParams();
  const [orgs, setOrgs] = useState<OrgRead[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [status, setStatus] = useState<GoogleCalendarStatusOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    orgsApi.list({ active_only: true }).then((list) => {
      setOrgs(list);
      if (list.length > 0) setSelectedOrgId(list[0].id);
    });
  }, []);

  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    const orgId = searchParams.get("org_id");
    if (connected === "true") {
      toast.success("Google Calendar 連結成功");
      if (orgId) setSelectedOrgId(orgId);
    } else if (error) {
      const messages: Record<string, string> = {
        session_expired: "Session 已過期，請重新授權",
        oauth_error: "Google 授權失敗",
        encryption_not_configured: "伺服器尚未設定加密金鑰（FIELD_ENCRYPTION_KEYS）",
        save_failed: "儲存 token 失敗，請重試",
      };
      toast.error(messages[error] ?? `授權失敗：${error}`);
    }
  }, [searchParams]);

  const fetchStatus = useCallback(async () => {
    if (!selectedOrgId) return;
    setLoading(true);
    try {
      const data = await googleCalendarApi.getStatus(selectedOrgId);
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleConnect = () => {
    if (!selectedOrgId) return;
    window.location.href = googleCalendarApi.getAuthorizeUrl(selectedOrgId);
  };

  const handleDisconnect = async () => {
    if (!selectedOrgId || !status?.is_connected) return;
    if (!confirm("確定要解除 Google Calendar 連結嗎？解除後同步將停止。")) return;
    setBusy(true);
    try {
      await googleCalendarApi.disconnect(selectedOrgId);
      toast.success("已解除連結");
      await fetchStatus();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "解除連結失敗");
    } finally {
      setBusy(false);
    }
  };

  const handleTriggerPull = async () => {
    if (!selectedOrgId) return;
    setBusy(true);
    try {
      await googleCalendarApi.triggerPull(selectedOrgId);
      toast.success("已排入同步任務，約 30 秒後完成");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "觸發失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Google Calendar 同步設定</h1>
        <p className="text-sm text-muted-foreground mt-1">
          連結後，HCCA 行事曆事件將雙向同步到指定組織的 Google Calendar。
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">選擇組織</label>
        <select
          className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          value={selectedOrgId}
          onChange={(e) => setSelectedOrgId(e.target.value)}
        >
          {orgs.map((org) => (
            <option key={org.id} value={org.id}>
              {orgDisplayName(org, orgs)}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">載入中…</div>
      ) : status ? (
        <div className="border rounded-lg divide-y">
          <div className="p-4 flex items-center justify-between">
            <span className="text-sm font-medium">連結狀態</span>
            <span className={`text-sm font-semibold ${status.is_connected ? "text-green-600" : "text-muted-foreground"}`}>
              {status.is_connected ? "✓ 已連結" : "未連結"}
            </span>
          </div>
          {status.is_connected && (
            <>
              <div className="p-4 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">授權帳號</span>
                <span className="text-sm">{status.authorized_email ?? "—"}</span>
              </div>
              <div className="p-4 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">目標日曆</span>
                <span className="text-sm font-mono">{status.google_calendar_id}</span>
              </div>
              <div className="p-4 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">上次同步</span>
                <span className="text-sm">{formatRelativeTime(status.last_pull_at)}</span>
              </div>
              {status.last_error && (
                <div className="p-4 bg-red-50 dark:bg-red-950/20">
                  <p className="text-sm text-red-600 dark:text-red-400">
                    ✗ 上次同步失敗：{status.last_error}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {!status?.is_connected ? (
          <button
            onClick={handleConnect}
            disabled={busy || !selectedOrgId}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            連結 Google Calendar
          </button>
        ) : (
          <>
            <button
              onClick={handleConnect}
              disabled={busy}
              className="px-4 py-2 text-sm font-medium border rounded-md hover:bg-accent disabled:opacity-50"
            >
              重新授權
            </button>
            <button
              onClick={handleTriggerPull}
              disabled={busy}
              className="px-4 py-2 text-sm font-medium border rounded-md hover:bg-accent disabled:opacity-50"
            >
              立即同步
            </button>
            <button
              onClick={handleDisconnect}
              disabled={busy}
              className="px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50 disabled:opacity-50"
            >
              解除連結
            </button>
          </>
        )}
      </div>

      <div className="text-xs text-muted-foreground space-y-1 border-t pt-4">
        <p>• 僅同步 visibility ≠ 私人 的事件</p>
        <p>• Google Calendar 新增的事件會以「投影」方式顯示（唯讀），在 HCCA 編輯請回到 Google Calendar</p>
        <p>• 自動同步每 5 分鐘執行一次</p>
        <p>• 首次連結需要在 Google Cloud Console 將 <code>{"<你的部署網址>"}/calendar/google/callback</code> 加入 Authorized Redirect URIs</p>
      </div>
    </div>
  );
}
