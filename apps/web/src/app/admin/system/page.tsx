"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  ApiError,
  systemApi,
  type IpBlockedItem,
  type LoadShedMode,
  type SystemFeatureFlag,
  type SystemMetricsSnapshot,
} from "@/lib/api";

const POLL_INTERVAL_MS = 5000;

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function utilizationTone(value: number): string {
  if (value >= 0.85) return "bg-red-50 border-red-300 text-red-700";
  if (value >= 0.6) return "bg-amber-50 border-amber-300 text-amber-700";
  return "bg-emerald-50 border-emerald-300 text-emerald-700";
}

function MetricCard({
  title,
  children,
  tone = "default",
}: {
  title: string;
  children: React.ReactNode;
  tone?: "default" | "warning" | "critical" | "ok";
}) {
  const borderTone =
    tone === "critical"
      ? "border-red-300"
      : tone === "warning"
        ? "border-amber-300"
        : tone === "ok"
          ? "border-emerald-300"
          : "border-slate-200";
  return (
    <div className={`bg-white rounded-lg border ${borderTone} p-4 shadow-sm`}>
      <div className="text-sm font-medium text-slate-500 mb-2">{title}</div>
      <div className="text-slate-800">{children}</div>
    </div>
  );
}

export default function SystemStatusPage() {
  const [snapshot, setSnapshot] = useState<SystemMetricsSnapshot | null>(null);
  const [flags, setFlags] = useState<SystemFeatureFlag[]>([]);
  const [ipList, setIpList] = useState<IpBlockedItem[]>([]);
  const [ipInput, setIpInput] = useState("");
  const [ipReason, setIpReason] = useState("");
  const [ipTtl, setIpTtl] = useState(3600);
  const [revokeUserId, setRevokeUserId] = useState("");
  const [maintenanceMessage, setMaintenanceMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [s, f, ips] = await Promise.all([
        systemApi.status(),
        systemApi.listFeatureFlags(),
        systemApi.listIpBlocks(),
      ]);
      setSnapshot(s);
      setFlags(f);
      setIpList(ips);
      setMaintenanceMessage(s.maintenance.message);
    } catch (e) {
      if (e instanceof ApiError && e.status !== 503) {
        toast.error(`讀取系統狀態失敗：${e.message}`);
      }
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const toggleMaintenance = async (enabled: boolean) => {
    try {
      await systemApi.setMaintenance({ enabled, message: maintenanceMessage });
      toast.success(enabled ? "已進入維護模式（非 admin 將被擋）" : "已關閉維護模式");
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "切換失敗");
    }
  };

  const setShedMode = async (mode: LoadShedMode) => {
    try {
      await systemApi.setLoadShedMode(mode);
      toast.success(`Load shed mode → ${mode}`);
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "切換失敗");
    }
  };

  const toggleFlag = async (flag: SystemFeatureFlag) => {
    try {
      await systemApi.setFeatureFlag(flag.key, !flag.enabled);
      toast.success(`${flag.description}：${!flag.enabled ? "已啟用" : "已停用"}`);
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "切換失敗");
    }
  };

  const blockIp = async () => {
    if (!ipInput.trim()) return;
    try {
      await systemApi.addIpBlock({
        ip: ipInput.trim(),
        reason: ipReason.trim(),
        ttl_seconds: ipTtl || null,
      });
      toast.success(`已封鎖 ${ipInput}`);
      setIpInput("");
      setIpReason("");
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "封鎖失敗");
    }
  };

  const unblockIp = async (ip: string) => {
    if (!window.confirm(`解除 ${ip} 的封鎖？`)) return;
    try {
      await systemApi.removeIpBlock(ip);
      toast.success(`已解除 ${ip}`);
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "解除失敗");
    }
  };

  const revokeUser = async () => {
    if (!revokeUserId.trim()) return;
    if (!window.confirm(`強制登出使用者 ${revokeUserId}？\n此操作會使該使用者所有 session 立即失效。`)) return;
    try {
      const out = await systemApi.revokeUserTokens(revokeUserId.trim());
      toast.success(`已撤銷 ${out.revoked_count} 個 token`);
      setRevokeUserId("");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "撤銷失敗");
    }
  };

  if (!snapshot) {
    return <div className="p-8 text-slate-500">載入系統狀態中…</div>;
  }

  const dbTone = utilizationTone(snapshot.db_pool.utilization);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">系統狀態 / 緊急工具</h1>
          <p className="text-sm text-slate-500 mt-1">
            指標每 {POLL_INTERVAL_MS / 1000} 秒更新；最後更新 {new Date(snapshot.timestamp * 1000).toLocaleTimeString()}
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50 text-sm"
        >
          手動重新整理
        </button>
      </header>

      {/* 即時指標 */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="DB 連線池" tone={snapshot.db_pool.utilization >= 0.85 ? "critical" : snapshot.db_pool.utilization >= 0.6 ? "warning" : "ok"}>
          <div className="text-2xl font-bold">{snapshot.db_pool.checked_out} / {snapshot.db_pool.size + snapshot.db_pool.overflow}</div>
          <div className={`mt-1 inline-block px-2 py-0.5 text-xs border rounded ${dbTone}`}>使用率 {pct(snapshot.db_pool.utilization)}</div>
          <div className="text-xs text-slate-500 mt-2">size {snapshot.db_pool.size} · overflow {snapshot.db_pool.overflow}</div>
        </MetricCard>
        <MetricCard title="進行中請求 / 5xx 比例">
          <div className="text-2xl font-bold">{snapshot.load_signals.active_requests}</div>
          <div className="text-xs text-slate-500 mt-1">
            60s 內 5xx：{snapshot.load_signals.recent_5xx_count} 次（{pct(snapshot.load_signals.recent_5xx_ratio)}）
          </div>
        </MetricCard>
        <MetricCard title="Redis">
          <div className="text-2xl font-bold">{snapshot.redis.connected_clients}</div>
          <div className="text-xs text-slate-500 mt-1">
            blocked: {snapshot.redis.blocked_clients}
            {snapshot.redis.error ? ` · ${snapshot.redis.error}` : ""}
          </div>
        </MetricCard>
        <MetricCard title="WebSocket">
          <div className="text-2xl font-bold">{snapshot.ws.total}</div>
          <div className="text-xs text-slate-500 mt-1">
            房間 {snapshot.ws.rooms} · 唯一 IP {snapshot.ws.unique_ips} · 上限 {snapshot.ws.limits.global_max}
          </div>
        </MetricCard>
      </section>

      {/* Celery */}
      <MetricCard title="Celery 任務佇列">
        {snapshot.celery.error ? (
          <div className="text-amber-700">無法取得 Celery 狀態：{snapshot.celery.error}</div>
        ) : snapshot.celery.queues.length === 0 ? (
          <div className="text-slate-500">無 worker 回應</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-slate-500">
              <tr><th className="text-left py-1">Worker</th><th className="text-right">執行中</th><th className="text-right">預留</th></tr>
            </thead>
            <tbody>
              {snapshot.celery.queues.map((q) => (
                <tr key={q.name} className="border-t border-slate-100">
                  <td className="py-1 font-mono">{q.name}</td>
                  <td className="text-right">{q.active}</td>
                  <td className="text-right">{q.reserved}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </MetricCard>

      {/* 緊急開關 */}
      <section className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-4">
        <h2 className="text-lg font-bold text-red-800">⚠ 緊急開關</h2>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">維護模式訊息（顯示給使用者看）</label>
          <input
            type="text"
            value={maintenanceMessage}
            onChange={(e) => setMaintenanceMessage(e.target.value)}
            placeholder="系統維護中，預計 30 分鐘後恢復"
            className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
          />
          <div className="mt-2 flex gap-2 items-center">
            <button
              type="button"
              onClick={() => toggleMaintenance(true)}
              disabled={snapshot.maintenance.enabled}
              className="px-3 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 text-sm"
            >
              進入維護模式
            </button>
            <button
              type="button"
              onClick={() => toggleMaintenance(false)}
              disabled={!snapshot.maintenance.enabled}
              className="px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-sm"
            >
              關閉維護模式
            </button>
            <span className="text-sm">
              目前：
              <span className={snapshot.maintenance.enabled ? "text-red-700 font-bold" : "text-emerald-700"}>
                {snapshot.maintenance.enabled ? "🔴 已啟用" : "🟢 正常運作"}
              </span>
            </span>
          </div>
        </div>

        <div>
          <div className="text-sm font-medium text-slate-700 mb-1">Load Shed Mode（當前：{snapshot.load_shed_mode}）</div>
          <div className="flex gap-2 flex-wrap">
            {(["auto", "off", "on", "bypass"] as LoadShedMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setShedMode(m)}
                className={`px-3 py-1.5 rounded-md text-sm border ${
                  snapshot.load_shed_mode === m
                    ? "bg-blue-600 text-white border-blue-700"
                    : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                }`}
              >
                {m === "auto" && "auto（依指標自動）"}
                {m === "off" && "off（永不 shed）"}
                {m === "on" && "on（強制非 admin → 503）"}
                {m === "bypass" && "bypass（完全略過）"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">強制登出使用者（user_id）</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={revokeUserId}
              onChange={(e) => setRevokeUserId(e.target.value)}
              placeholder="user UUID"
              className="flex-1 px-3 py-2 border border-slate-300 rounded-md text-sm font-mono"
            />
            <button
              type="button"
              onClick={revokeUser}
              className="px-3 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 text-sm"
            >
              撤銷所有 session
            </button>
          </div>
        </div>
      </section>

      {/* Feature Flags */}
      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <h2 className="text-lg font-bold text-slate-800 mb-3">功能開關（Feature Flags）</h2>
        <table className="w-full text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="text-left py-1">功能</th>
              <th className="text-left">Key</th>
              <th className="text-right">狀態</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {flags.map((f) => (
              <tr key={f.key} className="border-t border-slate-100">
                <td className="py-2">{f.description}</td>
                <td className="font-mono text-xs text-slate-500">{f.key}</td>
                <td className="text-right">
                  <span className={`inline-block px-2 py-0.5 text-xs rounded ${f.enabled ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                    {f.enabled ? "啟用中" : "已停用"}
                  </span>
                </td>
                <td className="text-right">
                  <button
                    type="button"
                    onClick={() => toggleFlag(f)}
                    className="px-3 py-1 rounded-md border border-slate-300 hover:bg-slate-50 text-xs"
                  >
                    {f.enabled ? "停用" : "啟用"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* IP 黑名單 */}
      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <h2 className="text-lg font-bold text-slate-800 mb-3">IP 黑名單</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-4">
          <input
            type="text"
            value={ipInput}
            onChange={(e) => setIpInput(e.target.value)}
            placeholder="IP（IPv4 或 IPv6）"
            className="px-3 py-2 border border-slate-300 rounded-md text-sm font-mono"
          />
          <input
            type="text"
            value={ipReason}
            onChange={(e) => setIpReason(e.target.value)}
            placeholder="原因（選填）"
            className="px-3 py-2 border border-slate-300 rounded-md text-sm"
          />
          <input
            type="number"
            value={ipTtl}
            onChange={(e) => setIpTtl(parseInt(e.target.value || "0", 10))}
            placeholder="TTL 秒（空白=永久）"
            className="px-3 py-2 border border-slate-300 rounded-md text-sm"
          />
          <button
            type="button"
            onClick={blockIp}
            disabled={!ipInput.trim()}
            className="px-3 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 text-sm"
          >
            加入黑名單
          </button>
        </div>
        {ipList.length === 0 ? (
          <div className="text-slate-500 text-sm">目前無封鎖中的 IP</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="text-left py-1">IP</th>
                <th className="text-left">原因</th>
                <th className="text-left">到期</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {ipList.map((item) => (
                <tr key={item.ip} className="border-t border-slate-100">
                  <td className="py-2 font-mono">{item.ip}</td>
                  <td>{item.reason || "—"}</td>
                  <td className="text-slate-500">
                    {item.expires_at ? new Date(item.expires_at * 1000).toLocaleString() : "永久"}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => unblockIp(item.ip)}
                      className="px-3 py-1 rounded-md border border-slate-300 hover:bg-slate-50 text-xs"
                    >
                      解除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* WebSocket 房間細節 */}
      {snapshot.ws.per_room.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-lg p-4">
          <h2 className="text-lg font-bold text-slate-800 mb-3">WebSocket 房間</h2>
          <table className="w-full text-sm">
            <thead className="text-slate-500">
              <tr><th className="text-left py-1">房間</th><th className="text-right">連線數</th></tr>
            </thead>
            <tbody>
              {snapshot.ws.per_room.slice(0, 30).map((r) => (
                <tr key={r.room} className="border-t border-slate-100">
                  <td className="py-1 font-mono">{r.room}</td>
                  <td className="text-right">{r.connections}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
