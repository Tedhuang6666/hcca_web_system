"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Ban,
  Boxes,
  Database,
  Eraser,
  Gauge,
  Lock,
  Plus,
  Power,
  RefreshCcw,
  RotateCcw,
  Save,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { usePermissions } from "@/hooks/usePermissions";
import { useResilientPoll, type PollOutcome } from "@/hooks/useResilientPoll";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  ApiError,
  systemApi,
  type DeadLetterItem,
  type DefenseSummary,
  type IpBlockedItem,
  type LoadShedMode,
  type RateLimitConfig,
  type SystemMetricsSnapshot,
  apiErrorMessage,
} from "@/lib/api";

const POLL_INTERVAL_MS = 5000;
const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  enabled: true,
  global_requests: 120,
  global_window_seconds: 60,
  overrides: [],
};

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function fmtTime(seconds: number | null): string {
  return seconds ? new Date(seconds * 1000).toLocaleString() : "永久";
}

function toDateTimeLocal(seconds: number | null): string {
  if (!seconds) return "";
  const date = new Date(seconds * 1000);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fromDateTimeLocal(value: string): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}

function modeLabel(mode: LoadShedMode): string {
  const labels: Record<LoadShedMode, string> = {
    auto: "自動",
    off: "關閉",
    on: "強制",
    bypass: "旁路",
  };
  return labels[mode];
}

function Panel({
  title,
  icon,
  children,
  action,
  wide = false,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <section
      className={`rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-sm ${
        wide ? "p-5" : "p-4"
      }`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-[var(--primary-dim)] text-[var(--primary)]">
            {icon}
          </span>
          <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  detail?: string;
  tone?: "neutral" | "good" | "warn" | "danger";
}) {
  const toneClass = {
    neutral: "text-[var(--text-primary)]",
    good: "text-[var(--success)]",
    warn: "text-[var(--warning)]",
    danger: "text-[var(--danger)]",
  }[tone];
  const barClass = {
    neutral: "bg-[var(--border-strong)]",
    good: "bg-[var(--success)]",
    warn: "bg-[var(--warning)]",
    danger: "bg-[var(--danger)]",
  }[tone];

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-sm">
      <div className={`h-1 ${barClass}`} />
      <div className="p-3">
      <div className="text-xs font-medium text-[var(--text-muted)]">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-semibold leading-tight ${toneClass}`}>
        {value}
      </div>
      {detail && <div className="mt-1 text-xs text-[var(--text-secondary)]">{detail}</div>}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm font-medium text-[var(--text-secondary)]">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg-hover)] px-3 py-6 text-center text-sm text-[var(--text-muted)]">
      {text}
    </div>
  );
}

function StatusPill({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${
        active
          ? "border-[var(--success-border)] bg-[var(--success-dim)] text-[var(--success)]"
          : "border-[var(--border)] bg-[var(--bg-hover)] text-[var(--text-muted)]"
      }`}
    >
      {children}
    </span>
  );
}

export default function SystemDefensePanel() {
  const { isAdmin } = usePermissions();
  const confirm = useConfirm();
  const [snapshot, setSnapshot] = useState<SystemMetricsSnapshot | null>(null);
  const [summary, setSummary] = useState<DefenseSummary | null>(null);
  const [ipList, setIpList] = useState<IpBlockedItem[]>([]);
  const [maintenanceMessage, setMaintenanceMessage] = useState("");
  const [maintenanceUntil, setMaintenanceUntil] = useState("");
  const [maintenanceDirty, setMaintenanceDirty] = useState(false);
  const maintenanceDirtyRef = useRef(false);
  const [ipInput, setIpInput] = useState("");
  const [ipReason, setIpReason] = useState("");
  const [ipTtl, setIpTtl] = useState(3600);
  const [rateLimit, setRateLimit] = useState<RateLimitConfig>(DEFAULT_RATE_LIMIT);
  const [rateLimitDirty, setRateLimitDirty] = useState(false);
  const rateLimitDirtyRef = useRef(false);
  const [overridePath, setOverridePath] = useState("");
  const [overrideRequests, setOverrideRequests] = useState(30);
  const [overrideWindowSeconds, setOverrideWindowSeconds] = useState(60);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<PollOutcome> => {
    if (!isAdmin) return "stop";
    setLoading(true);
    try {
      const s = await systemApi.status();
      setSnapshot(s);
      if (!maintenanceDirtyRef.current) {
        setMaintenanceMessage(s.maintenance.message);
        setMaintenanceUntil(toDateTimeLocal(s.maintenance.until));
      }

      const [summaryResult, ipsResult] = await Promise.allSettled([
        systemApi.defenseSummary(),
        systemApi.listIpBlocks(),
      ]);

      if (summaryResult.status === "fulfilled") {
        setSummary(summaryResult.value);
        if (!rateLimitDirtyRef.current) {
          setRateLimit(summaryResult.value.rate_limit ?? DEFAULT_RATE_LIMIT);
        }
      } else {
        throw summaryResult.reason;
      }

      if (ipsResult.status === "fulfilled") setIpList(ipsResult.value);
      setLoadError(null);
    } catch (e) {
      const message = apiErrorMessage(e, "讀取防護狀態失敗");
      setLoadError(message);
      if (e instanceof ApiError && e.status !== 503) toast.error(message);
      if (e instanceof ApiError && [401, 403, 522].includes(e.status)) return "stop";
    } finally {
      setLoading(false);
    }
    return "ok";
  }, [isAdmin]);

  useEffect(() => { void refresh(); }, [refresh]);
  useResilientPoll(refresh, { enabled: isAdmin, intervalMs: POLL_INTERVAL_MS });

  const defenseHits = useMemo(() => {
    if (!summary) return 0;
    return (
      (summary.recent_status_counts["403"] ?? 0)
      + (summary.recent_status_counts["429"] ?? 0)
      + (summary.recent_status_counts["503"] ?? 0)
    );
  }, [summary]);

  const setMaintenance = async (enabled: boolean) => {
    try {
      await systemApi.setMaintenance({
        enabled,
        message: maintenanceMessage,
        until: enabled ? fromDateTimeLocal(maintenanceUntil) : null,
      });
      maintenanceDirtyRef.current = false;
      setMaintenanceDirty(false);
      toast.success(enabled ? "已啟用全站維護模式" : "已關閉維護模式");
      refresh();
    } catch (e) {
      toast.error(apiErrorMessage(e, "切換維護模式失敗"));
    }
  };

  const setShedMode = async (mode: LoadShedMode) => {
    try {
      await systemApi.setLoadShedMode(mode);
      toast.success(`防護模式已切換為${modeLabel(mode)}`);
      refresh();
    } catch (e) {
      toast.error(apiErrorMessage(e, "切換防護模式失敗"));
    }
  };

  const saveRateLimit = async () => {
    try {
      await systemApi.setRateLimit(rateLimit);
      rateLimitDirtyRef.current = false;
      setRateLimitDirty(false);
      toast.success("限流策略已更新");
      refresh();
    } catch (e) {
      toast.error(apiErrorMessage(e, "更新限流失敗"));
    }
  };

  const addRateLimitOverride = () => {
    const path = overridePath.trim();
    if (!path || overrideRequests < 1 || overrideWindowSeconds < 1) return;
    setRateLimit((prev) => ({
      ...prev,
      overrides: [
        ...prev.overrides.filter((item) => item.path_prefix !== path),
        { path_prefix: path, requests: overrideRequests, window_seconds: overrideWindowSeconds },
      ],
    }));
    rateLimitDirtyRef.current = true;
    setRateLimitDirty(true);
    setOverridePath("");
  };

  const removeRateLimitOverride = (path: string) => {
    setRateLimit((prev) => ({
      ...prev,
      overrides: prev.overrides.filter((item) => item.path_prefix !== path),
    }));
    rateLimitDirtyRef.current = true;
    setRateLimitDirty(true);
  };
  const blockIp = async () => {
    if (!ipInput.trim()) return;
    try {
      await systemApi.addIpBlock({
        ip: ipInput.trim(),
        reason: ipReason.trim(),
        ttl_seconds: ipTtl || null,
      });
      toast.success(`已緊急封鎖 ${ipInput}`);
      setIpInput("");
      setIpReason("");
      refresh();
    } catch (e) {
      toast.error(apiErrorMessage(e, "封鎖失敗"));
    }
  };

  const unblockIp = async (ip: string) => {
    if (!(await confirm({
      title: "解除緊急封鎖？",
      description: `IP ${ip} 將能再次存取平台。`,
      confirmLabel: "解除封鎖",
      danger: true,
    }))) return;
    try {
      await systemApi.removeIpBlock(ip);
      toast.success(`已解除 ${ip}`);
      refresh();
    } catch (e) {
      toast.error(apiErrorMessage(e, "解除失敗"));
    }
  };

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl">
        <section className="card p-8 text-center">
          <Lock className="mx-auto mb-3 text-[var(--danger)]" size={32} aria-hidden />
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">需要超級管理員權限</h2>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            系統防護控制台只開放超級管理員檢視與操作。
          </p>
        </section>
      </div>
    );
  }

  if (!snapshot || !summary) {
    return (
      <div className="mx-auto max-w-3xl">
        <section className="card p-8">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-1 flex-shrink-0 text-[var(--warning)]" size={24} aria-hidden />
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                {loading ? "載入防護控制台中" : "防護控制台無法載入"}
              </h2>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                {loadError ?? "正在讀取系統狀態與限流設定。"}
              </p>
              <button type="button" onClick={refresh} className="btn btn-primary mt-4">
                <RefreshCcw size={16} aria-hidden />
                重新整理
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div>
      <header className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
            <ShieldCheck size={14} aria-hidden />
            超級管理員控制台
          </div>
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">全站防護管理</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            每 {POLL_INTERVAL_MS / 1000} 秒更新；最後更新{" "}
            {new Date(snapshot.timestamp * 1000).toLocaleTimeString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/people?section=defense" className="btn btn-secondary">
            使用者與功能處置
          </Link>
          <button type="button" onClick={refresh} className="btn btn-ghost">
            <RefreshCcw size={16} aria-hidden />
            重新整理
          </button>
        </div>
      </header>

      <section className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="DB 連線池"
          value={`${snapshot.db_pool.checked_out}/${snapshot.db_pool.size + snapshot.db_pool.overflow}`}
          detail={`使用率 ${pct(snapshot.db_pool.utilization)}`}
          tone={snapshot.db_pool.utilization > 0.8 ? "danger" : "neutral"}
        />
        <Metric
          label="進行中請求"
          value={snapshot.load_signals.active_requests}
          detail={`5xx ${snapshot.load_signals.recent_5xx_count} 次 / ${pct(snapshot.load_signals.recent_5xx_ratio)}`}
          tone={snapshot.load_signals.recent_5xx_ratio > 0.05 ? "warn" : "neutral"}
        />
        <Metric
          label="有效防禦規則"
          value={summary.active_rule_count}
          detail={`總規則 ${summary.total_rule_count} 條`}
          tone={summary.active_rule_count ? "warn" : "good"}
        />
        <Metric
          label="近 1 小時防護命中"
          value={defenseHits}
          detail={`403 ${summary.recent_status_counts["403"] ?? 0} / 429 ${summary.recent_status_counts["429"] ?? 0} / 503 ${summary.recent_status_counts["503"] ?? 0}`}
          tone={defenseHits ? "warn" : "good"}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel title="全站模式" icon={<Shield size={18} aria-hidden />} wide>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-[var(--text-primary)]">維護模式</p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
              <StatusPill active={snapshot.maintenance.enabled}>
                {snapshot.maintenance.enabled ? "維護中" : "正常開放"}
              </StatusPill>
              {maintenanceDirty && <StatusPill active={false}>尚未套用</StatusPill>}
              <span>
                {snapshot.maintenance.until
                  ? `預計恢復：${fmtTime(snapshot.maintenance.until)}`
                  : "未設定恢復時間"}
              </span>
            </div>
          </div>

          <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_16rem]">
            <Field label="維護模式訊息">
              <input
                type="text"
                value={maintenanceMessage}
                onChange={(e) => {
                  maintenanceDirtyRef.current = true;
                  setMaintenanceDirty(true);
                  setMaintenanceMessage(e.target.value);
                }}
                className="input w-full min-w-0"
                placeholder="系統維護中，請稍後再試"
              />
            </Field>
            <Field label="預計恢復時間">
              <input
                type="datetime-local"
                value={maintenanceUntil}
                onChange={(e) => {
                  maintenanceDirtyRef.current = true;
                  setMaintenanceDirty(true);
                  setMaintenanceUntil(e.target.value);
                }}
                className="input w-full min-w-0"
              />
            </Field>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMaintenance(true)}
                disabled={snapshot.maintenance.enabled}
                className="btn btn-danger"
              >
                <Power size={16} aria-hidden />
                啟用維護
              </button>
              <button
                type="button"
                onClick={() => setMaintenance(false)}
                disabled={!snapshot.maintenance.enabled}
                className="btn btn-ghost"
              >
                關閉
              </button>
              <button
                type="button"
                onClick={() => setMaintenance(true)}
                disabled={!snapshot.maintenance.enabled || !maintenanceDirty}
                className="btn btn-secondary"
              >
                推送更新
              </button>
          </div>

          <div className="mt-5 border-t border-[var(--border)] pt-4">
            <div className="mb-2">
              <p className="text-sm font-medium text-[var(--text-primary)]">負載防護模式</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                控制高負載時的一般流量策略，不影響管理員緊急通道。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(["auto", "off", "on", "bypass"] as LoadShedMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setShedMode(mode)}
                  className={`btn w-full ${
                    snapshot.load_shed_mode === mode ? "btn-primary" : "btn-ghost"
                  }`}
                >
                  {modeLabel(mode)}
                </button>
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="全域限流" icon={<Gauge size={18} aria-hidden />}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="請求數">
              <input
                type="number"
                value={rateLimit.global_requests}
                min={1}
                onChange={(e) => {
                  setRateLimit((prev) => ({ ...prev, global_requests: Number(e.target.value) }));
                  rateLimitDirtyRef.current = true;
                  setRateLimitDirty(true);
                }}
                className="input"
              />
            </Field>
            <Field label="視窗秒數">
              <input
                type="number"
                value={rateLimit.global_window_seconds}
                min={1}
                onChange={(e) => {
                  setRateLimit((prev) => ({
                    ...prev,
                    global_window_seconds: Number(e.target.value),
                  }));
                  rateLimitDirtyRef.current = true;
                  setRateLimitDirty(true);
                }}
                className="input"
              />
            </Field>
            <Field label="狀態">
              <button
                type="button"
                onClick={() => {
                  setRateLimit((prev) => ({ ...prev, enabled: !prev.enabled }));
                  rateLimitDirtyRef.current = true;
                  setRateLimitDirty(true);
                }}
                className={`btn w-full ${rateLimit.enabled ? "btn-secondary" : "btn-ghost"}`}
              >
                <SlidersHorizontal size={16} aria-hidden />
                {rateLimit.enabled ? "啟用中" : "已停用"}
              </button>
            </Field>
          </div>
          <div className="mt-3">
            <div className="mb-1.5 text-xs font-medium text-[var(--text-muted)]">端點覆蓋</div>
            {rateLimit.overrides.length === 0 ? (
              <div className="text-xs text-[var(--text-muted)]">無</div>
            ) : (
              <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--bg-hover)] p-2">
                {rateLimit.overrides.map((override) => (
                  <span
                    key={`${override.path_prefix}-${override.requests}-${override.window_seconds}`}
                    title={`${override.path_prefix} = ${override.requests}/${override.window_seconds}s`}
                    className="inline-flex max-w-full items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-secondary)]"
                  >
                    <span className="max-w-[16rem] truncate font-mono">{override.path_prefix}</span>
                    <span className="shrink-0 text-[var(--text-muted)]">
                      {override.requests}/{override.window_seconds}s
                    </span>
                    <button
                      type="button"
                      onClick={() => removeRateLimitOverride(override.path_prefix)}
                      className="ml-1 rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--danger-dim)] hover:text-[var(--danger)]"
                      aria-label={`移除 ${override.path_prefix} 限流覆蓋`}
                    >
                      <X size={13} aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_auto]">
            <input
              type="text"
              value={overridePath}
              onChange={(e) => setOverridePath(e.target.value)}
              placeholder="新增端點，例如 /api/documents"
              className="input font-mono"
            />
            <input
              type="number"
              min={1}
              value={overrideRequests}
              onChange={(e) => setOverrideRequests(Number(e.target.value))}
              aria-label="端點請求數"
              className="input"
            />
            <input
              type="number"
              min={1}
              value={overrideWindowSeconds}
              onChange={(e) => setOverrideWindowSeconds(Number(e.target.value))}
              aria-label="端點視窗秒數"
              className="input"
            />
            <button type="button" onClick={addRateLimitOverride} className="btn btn-ghost">
              <Plus size={15} aria-hidden />
              加入
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={saveRateLimit} className="btn btn-primary">
              <Save size={16} aria-hidden />
              儲存限流策略
            </button>
            {rateLimitDirty && (
              <span className="text-xs font-medium text-[var(--warning)]">有尚未儲存的變更</span>
            )}
          </div>
        </Panel>
      </div>

      <section className="mt-4 max-w-3xl">
        <Panel title="緊急 IP 封鎖" icon={<Ban size={18} aria-hidden />}>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_110px_auto]">
            <input
              type="text"
              value={ipInput}
              onChange={(e) => setIpInput(e.target.value)}
              placeholder="IP"
              className="input font-mono"
            />
            <input
              type="text"
              value={ipReason}
              onChange={(e) => setIpReason(e.target.value)}
              placeholder="原因"
              className="input"
            />
            <input
              type="number"
              value={ipTtl}
              onChange={(e) => setIpTtl(Number(e.target.value))}
              className="input"
            />
            <button
              type="button"
              onClick={blockIp}
              disabled={!ipInput.trim()}
              className="btn btn-danger"
            >
              封鎖
            </button>
          </div>
          <div className="mt-4 space-y-2">
            {ipList.length === 0 ? (
              <EmptyRow text="目前沒有緊急封鎖 IP。" />
            ) : (
              ipList.map((item) => (
                <div
                  key={item.ip}
                  className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-sm text-[var(--text-primary)]">{item.ip}</div>
                    <div className="text-xs text-[var(--text-muted)]">
                      {item.reason || "-"} / {fmtTime(item.expires_at)}
                    </div>
                  </div>
                  <button type="button" onClick={() => unblockIp(item.ip)} className="btn-sm btn-ghost">
                    解除
                  </button>
                </div>
              ))
            )}
          </div>
        </Panel>
      </section>

      <section className="mt-4">
        <ModulesLinkCard />
      </section>

      <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
        <RecoveryToolsPanel onChanged={refresh} />
        <div className="xl:col-span-2">
          <DeadLetterPanel />
        </div>
      </section>
    </div>
  );
}

function ModulesLinkCard() {
  return (
    <Panel title="模組維護" icon={<Boxes size={18} aria-hidden />}>
      <p className="mb-4 text-xs text-[var(--text-muted)]">
        可將個別功能模組設為維護或關閉，並監控各模組的錯誤率與斷路器狀態。
      </p>
      <Link
        href="/admin/system?tab=modules"
        className="btn btn-secondary inline-flex items-center gap-2 text-sm"
      >
        <Boxes size={15} aria-hidden />
        前往模組維護頁面
      </Link>
    </Panel>
  );
}


function DeadLetterRow({ item }: { item: DeadLetterItem }) {
  const when = item.timestamp ? new Date(item.timestamp).toLocaleString() : "—";
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
      <div className="flex">
        <div className="w-1 shrink-0 bg-[var(--danger)]" />
        <div className="min-w-0 flex-1 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">
              {item.task ?? "（未知 task）"}
            </span>
            {item.queue && (
              <span className="rounded bg-[var(--bg-hover)] px-1.5 py-0.5 font-mono text-xs text-[var(--text-secondary)]">
                {item.queue}
              </span>
            )}
            {typeof item.retries === "number" && item.retries > 0 && (
              <span className="rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-xs text-[var(--text-secondary)]">
                retry ×{item.retries}
              </span>
            )}
            <span className="ml-auto text-xs text-[var(--text-muted)]">{when}</span>
          </div>
          {item.task_id && (
            <div className="mt-1.5 font-mono text-xs text-[var(--text-muted)]">id={item.task_id}</div>
          )}
          <div className="mt-1 break-words text-sm text-[var(--text-primary)]">
            <span className="font-mono font-medium text-[var(--danger)]">{item.exception_type}</span>
            {item.exception ? `: ${item.exception}` : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

function DeadLetterPanel() {
  const confirm = useConfirm();
  const [items, setItems] = useState<DeadLetterItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await systemApi.deadLetters(50);
      setItems(data.items);
    } catch (e) {
      toast.error(apiErrorMessage(e, "載入 Celery 失敗紀錄失敗"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const clear = async () => {
    if (!(await confirm({
      title: "清空 Dead Letter 佇列？",
      description: "失敗背景任務的可追查紀錄會被永久移除。",
      confirmLabel: "清空佇列",
      danger: true,
    }))) return;
    try {
      await systemApi.clearDeadLetters();
      toast.success("已清空 Celery dead-letter");
      setItems([]);
    } catch (e) {
      toast.error(apiErrorMessage(e, "清空失敗"));
    }
  };

  return (
    <Panel
      title="Celery 背景任務失敗 (Dead Letter)"
      icon={<AlertTriangle size={18} aria-hidden />}
      action={
        <div className="flex items-center gap-2">
          <button type="button" onClick={load} disabled={loading} className="btn btn-ghost text-xs">
            <RefreshCcw size={12} aria-hidden /> 重新整理
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={items.length === 0}
            className="btn-sm btn-danger-ghost"
          >
            <Trash2 size={12} aria-hidden /> 清空
          </button>
        </div>
      }
    >
      <p className="mb-3 text-xs text-[var(--text-muted)]">
        背景排程／worker 任務失敗時寫入 Redis；這裡只顯示 Celery 失敗，不包含 API 5xx。
        其他錯誤與慢查詢請前往{" "}
        <Link href="/admin/system?tab=observability" className="font-medium text-[var(--primary)] underline underline-offset-2">
          系統可觀測性
        </Link>
        。
      </p>
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--text-muted)]">
          {loading ? "載入中…" : "目前沒有 Celery 失敗紀錄 🎉"}
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item, idx) => (
            <DeadLetterRow key={`${item.task_id ?? "dl"}-${item.timestamp ?? idx}`} item={item} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function Action({
  icon,
  title,
  desc,
  onClick,
  btnClass,
  actionKey,
  label,
  busy,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
  btnClass: string;
  actionKey: string;
  label: string;
  busy: string | null;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
        {icon}
        {title}
      </div>
      <p className="mt-1 text-xs text-[var(--text-muted)]">{desc}</p>
      <button
        type="button"
        onClick={onClick}
        disabled={busy !== null}
        className={`btn ${btnClass} mt-3 w-full`}
      >
        {busy === actionKey ? "執行中…" : label}
      </button>
    </div>
  );
}

function RecoveryToolsPanel({ onChanged }: { onChanged: () => void }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const clearCache = async () => {
    setBusy("cache");
    try {
      const out = await systemApi.clearCache();
      const msg = `已清除 ${out.cleared} 個應用層快取鍵`;
      toast.success(msg);
      setLastResult(msg);
      onChanged();
    } catch (e) {
      toast.error(apiErrorMessage(e, "清除快取失敗"));
    } finally {
      setBusy(null);
    }
  };

  const dbUpgrade = async () => {
    if (!(await confirm({
      title: "執行資料庫遷移？",
      description: "將執行 alembic upgrade head。請先確認資料庫已備份。",
      confirmLabel: "執行遷移",
      danger: true,
    }))) return;
    setBusy("db");
    try {
      const out = await systemApi.dbUpgrade();
      if (!out.ok) {
        toast.error("資料庫升級失敗");
        setLastResult(`升級失敗：${out.error ?? "未知錯誤"}`);
        return;
      }
      const msg = out.changed
        ? `已升級：${out.before_revision ?? "—"} → ${out.head_revision ?? "—"}`
        : `已是最新版本（${out.head_revision ?? "—"}）`;
      toast.success(msg);
      setLastResult(msg);
      onChanged();
    } catch (e) {
      toast.error(apiErrorMessage(e, "資料庫升級失敗"));
    } finally {
      setBusy(null);
    }
  };

  const restart = async () => {
    if (!(await confirm({
      title: "重啟服務？",
      description: "正式環境會對 Gunicorn master 送出 SIGHUP，優雅重載 worker。",
      confirmLabel: "重啟服務",
      danger: true,
    }))) return;
    setBusy("restart");
    try {
      const out = await systemApi.restartService();
      const msg = `重啟已排程（環境：${out.environment}）`;
      toast.success(msg);
      setLastResult(msg);
    } catch (e) {
      toast.error(apiErrorMessage(e, "重啟失敗"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="快速復原工具" icon={<Wrench size={18} aria-hidden />}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Action
          icon={<Eraser size={16} aria-hidden />}
          title="清除快取"
          desc="清應用層快取（組織/權限/公文列表），不影響登入與防護狀態。"
          onClick={clearCache}
          btnClass="btn-secondary"
          actionKey="cache"
          label="清除快取"
          busy={busy}
        />
        <Action
          icon={<Database size={16} aria-hidden />}
          title="升級資料庫"
          desc="執行 alembic upgrade head，套用未完成的遷移。"
          onClick={dbUpgrade}
          btnClass="btn-secondary"
          actionKey="db"
          label="升級資料庫"
          busy={busy}
        />
        <Action
          icon={<RotateCcw size={16} aria-hidden />}
          title="重啟服務"
          desc="dev 熱重載；prod 對 gunicorn master 送 SIGHUP 優雅重載。"
          onClick={restart}
          btnClass="btn-danger"
          actionKey="restart"
          label="重啟服務"
          busy={busy}
        />
      </div>
      {lastResult && (
        <div className="mt-3 break-words rounded-md border border-[var(--border)] bg-[var(--bg-hover)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          最近結果：{lastResult}
        </div>
      )}
    </Panel>
  );
}
