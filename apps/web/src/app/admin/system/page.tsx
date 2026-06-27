"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Ban,
  Boxes,
  Bug,
  Database,
  Eraser,
  Gauge,
  Lock,
  Plus,
  Power,
  RefreshCcw,
  RotateCcw,
  Save,
  Search,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserX,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { usePermissions } from "@/hooks/usePermissions";
import { useResilientPoll, type PollOutcome } from "@/hooks/useResilientPoll";
import {
  ApiError,
  systemApi,
  type DeadLetterItem,
  type DefenseRule,
  type DefenseRuleType,
  type DefenseSummary,
  type ErrorCategory,
  type IpBlockedItem,
  type LoadShedMode,
  type RateLimitConfig,
  type RecentErrorItem,
  type SystemFeatureFlag,
  type SystemMetricsSnapshot,
  apiErrorMessage,
} from "@/lib/api";
import {
  blockUserAccount,
  previewUserBlock,
  type UserBlockPreview,
} from "@/lib/user-block-api";

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

function ruleTypeLabel(type: DefenseRuleType): string {
  const labels: Record<DefenseRuleType, string> = {
    ip_block: "IP 封鎖",
    cidr_block: "CIDR 封鎖",
    ip_allow: "IP/CIDR 白名單",
    rate_limit_override: "端點限流",
    endpoint_lockdown: "端點鎖定",
    bot_challenge_placeholder: "Bot Challenge 預留",
  };
  return labels[type];
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

export default function SystemDefensePage() {
  const { isAdmin } = usePermissions();
  const [snapshot, setSnapshot] = useState<SystemMetricsSnapshot | null>(null);
  const [summary, setSummary] = useState<DefenseSummary | null>(null);
  const [flags, setFlags] = useState<SystemFeatureFlag[]>([]);
  const [rules, setRules] = useState<DefenseRule[]>([]);
  const [ipList, setIpList] = useState<IpBlockedItem[]>([]);
  const [maintenanceMessage, setMaintenanceMessage] = useState("");
  const [maintenanceUntil, setMaintenanceUntil] = useState("");
  const [maintenanceDirty, setMaintenanceDirty] = useState(false);
  const maintenanceDirtyRef = useRef(false);
  const [ipInput, setIpInput] = useState("");
  const [ipReason, setIpReason] = useState("");
  const [ipTtl, setIpTtl] = useState(3600);
  const [revokeUserId, setRevokeUserId] = useState("");
  const [blockUserIdentifier, setBlockUserIdentifier] = useState("");
  const [blockUserReason, setBlockUserReason] = useState("");
  const [blockUserPreview, setBlockUserPreview] = useState<UserBlockPreview | null>(null);
  const [blockUserEmails, setBlockUserEmails] = useState(true);
  const [blockUserIps, setBlockUserIps] = useState(false);
  const [rateLimit, setRateLimit] = useState<RateLimitConfig>(DEFAULT_RATE_LIMIT);
  const [ruleType, setRuleType] = useState<DefenseRuleType>("ip_block");
  const [ruleTarget, setRuleTarget] = useState("");
  const [ruleReason, setRuleReason] = useState("");
  const [ruleTtlMinutes, setRuleTtlMinutes] = useState(60);
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

      const [summaryResult, flagsResult, rulesResult, ipsResult] = await Promise.allSettled([
        systemApi.defenseSummary(),
        systemApi.listFeatureFlags(),
        systemApi.listDefenseRules({ limit: 100 }),
        systemApi.listIpBlocks(),
      ]);

      if (summaryResult.status === "fulfilled") {
        setSummary(summaryResult.value);
        setRateLimit(summaryResult.value.rate_limit ?? DEFAULT_RATE_LIMIT);
      } else {
        throw summaryResult.reason;
      }

      if (flagsResult.status === "fulfilled") setFlags(flagsResult.value);
      if (rulesResult.status === "fulfilled") setRules(rulesResult.value);
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

  const activeRules = useMemo(() => rules.filter((rule) => rule.is_active), [rules]);
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
      toast.success("限流策略已更新");
      refresh();
    } catch (e) {
      toast.error(apiErrorMessage(e, "更新限流失敗"));
    }
  };

  const createRule = async () => {
    if (!ruleTarget.trim()) return;
    const expiresAt =
      ruleTtlMinutes > 0 ? new Date(Date.now() + ruleTtlMinutes * 60_000).toISOString() : null;
    try {
      await systemApi.createDefenseRule({
        rule_type: ruleType,
        target: ruleTarget.trim(),
        reason: ruleReason.trim(),
        expires_at: expiresAt,
      });
      toast.success("防禦規則已建立");
      setRuleTarget("");
      setRuleReason("");
      refresh();
    } catch (e) {
      toast.error(apiErrorMessage(e, "建立規則失敗"));
    }
  };

  const deactivateRule = async (id: string) => {
    if (!window.confirm("停用這條防禦規則？")) return;
    try {
      await systemApi.deactivateDefenseRule(id);
      toast.success("防禦規則已停用");
      refresh();
    } catch (e) {
      toast.error(apiErrorMessage(e, "停用規則失敗"));
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
      toast.success(`已緊急封鎖 ${ipInput}`);
      setIpInput("");
      setIpReason("");
      refresh();
    } catch (e) {
      toast.error(apiErrorMessage(e, "封鎖失敗"));
    }
  };

  const unblockIp = async (ip: string) => {
    if (!window.confirm(`解除 ${ip} 的緊急封鎖？`)) return;
    try {
      await systemApi.removeIpBlock(ip);
      toast.success(`已解除 ${ip}`);
      refresh();
    } catch (e) {
      toast.error(apiErrorMessage(e, "解除失敗"));
    }
  };

  const revokeUser = async () => {
    if (!revokeUserId.trim()) return;
    if (!window.confirm(`強制登出使用者 ${revokeUserId}？`)) return;
    try {
      const out = await systemApi.revokeUserTokens(revokeUserId.trim());
      toast.success(`已撤銷 ${out.revoked_count} 個 token`);
      setRevokeUserId("");
    } catch (e) {
      toast.error(apiErrorMessage(e, "撤銷失敗"));
    }
  };

  const previewUser = async () => {
    if (!blockUserIdentifier.trim()) return;
    try {
      setBlockUserPreview(await previewUserBlock(blockUserIdentifier.trim()));
    } catch (e) {
      setBlockUserPreview(null);
      toast.error(apiErrorMessage(e, "找不到使用者"));
    }
  };

  const blockUser = async () => {
    if (!blockUserIdentifier.trim() || !blockUserReason.trim()) return;
    if (!window.confirm(`確定封鎖 ${blockUserPreview?.email ?? blockUserIdentifier}？`)) return;
    try {
      const result = await blockUserAccount({
        identifier: blockUserIdentifier.trim(),
        reason: blockUserReason.trim(),
        include_emails: blockUserEmails,
        include_ips: blockUserIps,
      });
      toast.success(`已封鎖 ${result.email}，建立 ${result.rules.length} 條規則`);
      setBlockUserIdentifier("");
      setBlockUserReason("");
      setBlockUserPreview(null);
      refresh();
    } catch (e) {
      toast.error(apiErrorMessage(e, "封鎖使用者失敗"));
    }
  };

  const toggleFlag = async (flag: SystemFeatureFlag) => {
    try {
      await systemApi.setFeatureFlag(flag.key, !flag.enabled);
      toast.success(`${flag.description}：${!flag.enabled ? "已啟用" : "已停用"}`);
      refresh();
    } catch (e) {
      toast.error(apiErrorMessage(e, "切換失敗"));
    }
  };

  if (!isAdmin) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <section className="card p-8 text-center">
          <Lock className="mx-auto mb-3 text-[var(--danger)]" size={32} aria-hidden />
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">需要超級管理員權限</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            系統防護控制台只開放超級管理員檢視與操作。
          </p>
        </section>
      </main>
    );
  }

  if (!snapshot || !summary) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <section className="card p-8">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-1 flex-shrink-0 text-[var(--warning)]" size={24} aria-hidden />
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-[var(--text-primary)]">
                {loading ? "載入防護控制台中" : "防護控制台無法載入"}
              </h1>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                {loadError ?? "正在讀取系統狀態、規則與限流設定。"}
              </p>
              <button type="button" onClick={refresh} className="btn btn-primary mt-4">
                <RefreshCcw size={16} aria-hidden />
                重新整理
              </button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-6">
      <header className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
            <ShieldCheck size={14} aria-hidden />
            超級管理員控制台
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">全站防護管理</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            每 {POLL_INTERVAL_MS / 1000} 秒更新；最後更新{" "}
            {new Date(snapshot.timestamp * 1000).toLocaleTimeString()}
          </p>
        </div>
        <button type="button" onClick={refresh} className="btn btn-ghost">
          <RefreshCcw size={16} aria-hidden />
          重新整理
        </button>
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
                onChange={(e) =>
                  setRateLimit((prev) => ({ ...prev, global_requests: Number(e.target.value) }))
                }
                className="input"
              />
            </Field>
            <Field label="視窗秒數">
              <input
                type="number"
                value={rateLimit.global_window_seconds}
                onChange={(e) =>
                  setRateLimit((prev) => ({
                    ...prev,
                    global_window_seconds: Number(e.target.value),
                  }))
                }
                className="input"
              />
            </Field>
            <Field label="狀態">
              <button
                type="button"
                onClick={() => setRateLimit((prev) => ({ ...prev, enabled: !prev.enabled }))}
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
              <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--bg-hover)] p-2">
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
                  </span>
                ))}
              </div>
            )}
          </div>
          <button type="button" onClick={saveRateLimit} className="btn btn-primary mt-3">
            <Save size={16} aria-hidden />
            儲存限流策略
          </button>
        </Panel>
      </div>

      <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel title="長期防禦規則" icon={<Lock size={18} aria-hidden />}>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[180px_1fr_1fr_120px_auto]">
            <select
              value={ruleType}
              onChange={(e) => setRuleType(e.target.value as DefenseRuleType)}
            >
              {([
                "ip_block",
                "cidr_block",
                "ip_allow",
                "endpoint_lockdown",
              ] as DefenseRuleType[]).map(
                (type) => (
                  <option key={type} value={type}>
                    {ruleTypeLabel(type)}
                  </option>
                ),
              )}
            </select>
            <input
              type="text"
              value={ruleTarget}
              onChange={(e) => setRuleTarget(e.target.value)}
              placeholder="IP / CIDR / UUID / Email / 路徑"
              className="input font-mono"
            />
            <input
              type="text"
              value={ruleReason}
              onChange={(e) => setRuleReason(e.target.value)}
              placeholder="原因"
              className="input"
            />
            <input
              type="number"
              value={ruleTtlMinutes}
              onChange={(e) => setRuleTtlMinutes(Number(e.target.value))}
              className="input"
              title="分鐘，0 表示永久"
            />
            <button
              type="button"
              onClick={createRule}
              disabled={!ruleTarget.trim()}
              className="btn btn-danger"
            >
              <Plus size={16} aria-hidden />
              建立
            </button>
          </div>

          <div className="mt-4 overflow-x-auto">
            {activeRules.length === 0 ? (
              <EmptyRow text="目前沒有有效防禦規則。" />
            ) : (
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-xs text-[var(--text-muted)]">
                  <tr className="border-b border-[var(--border)]">
                    <th className="py-2 text-left font-medium">類型</th>
                    <th className="text-left font-medium">目標</th>
                    <th className="text-left font-medium">原因</th>
                    <th className="text-left font-medium">到期</th>
                    <th className="text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {activeRules.map((rule) => (
                    <tr key={rule.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-2 text-[var(--text-primary)]">{ruleTypeLabel(rule.rule_type)}</td>
                      <td className="font-mono text-xs text-[var(--text-primary)]">{rule.target}</td>
                      <td className="text-[var(--text-secondary)]">{rule.reason || "-"}</td>
                      <td className="text-[var(--text-muted)]">{fmtTime(rule.expires_at)}</td>
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={() => deactivateRule(rule.id)}
                          className="btn-sm btn-danger-ghost"
                        >
                          <Trash2 size={14} aria-hidden />
                          停用
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Panel>

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

      <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel title="使用者與功能處置" icon={<Activity size={18} aria-hidden />}>
          <div className="space-y-2 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-dim)] p-3">
            <div className="text-sm font-semibold text-[var(--danger)]">封鎖使用者</div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={blockUserIdentifier}
                onChange={(e) => {
                  setBlockUserIdentifier(e.target.value);
                  setBlockUserPreview(null);
                }}
                placeholder="使用者 UUID 或任一 Email"
                className="input flex-1"
              />
              <button type="button" onClick={previewUser} className="btn btn-ghost">
                查詢
              </button>
            </div>
            {blockUserPreview && (
              <div className="rounded-md border border-[var(--border)] bg-[var(--bg-surface)] p-3 text-xs">
                <div className="font-medium text-[var(--text-primary)]">
                  {blockUserPreview.display_name} / {blockUserPreview.email}
                </div>
                <div className="mt-1 text-[var(--text-muted)]">
                  使用過的 Email：{blockUserPreview.emails.join("、") || "無"}
                </div>
                <div className="mt-1 text-[var(--text-muted)]">
                  近 30 天登入 IP：{blockUserPreview.ips.join("、") || "無紀錄"}
                </div>
              </div>
            )}
            <input
              type="text"
              value={blockUserReason}
              onChange={(e) => setBlockUserReason(e.target.value)}
              placeholder="封鎖原因（會顯示給使用者）"
              className="input"
            />
            <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--text-secondary)]">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={blockUserEmails}
                  onChange={(e) => setBlockUserEmails(e.target.checked)}
                />
                一併封鎖使用過的 Email
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={blockUserIps}
                  onChange={(e) => setBlockUserIps(e.target.checked)}
                />
                一併封鎖近 30 天登入 IP
              </label>
            </div>
            <button
              type="button"
              onClick={blockUser}
              disabled={!blockUserIdentifier.trim() || !blockUserReason.trim()}
              className="btn btn-danger"
            >
              <Ban size={16} aria-hidden />
              封鎖並強制登出
            </button>
          </div>

          <div className="my-4 border-t border-[var(--border)]" />
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={revokeUserId}
              onChange={(e) => setRevokeUserId(e.target.value)}
              placeholder="user UUID"
              className="input font-mono"
            />
            <button type="button" onClick={revokeUser} className="btn btn-danger">
              <UserX size={16} aria-hidden />
              強制登出
            </button>
          </div>
          <div className="mt-4 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {flags.map((flag) => (
              <div key={flag.key} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--text-primary)]">{flag.description}</div>
                  <div className="truncate font-mono text-xs text-[var(--text-muted)]">{flag.key}</div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleFlag(flag)}
                  className={`btn-sm ${flag.enabled ? "btn-secondary" : "btn-danger-ghost"}`}
                >
                  {flag.enabled ? "啟用" : "停用"}
                </button>
              </div>
            ))}
          </div>
        </Panel>

        <SlowQueriesPanel />
      </section>

      <section className="mt-4">
        <ModulesLinkCard />
      </section>

      <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <RecoveryToolsPanel onChanged={refresh} />
        <RecentErrorsPanel />
        <div className="xl:col-span-2">
          <DeadLetterPanel />
        </div>
      </section>
    </main>
  );
}

function ModulesLinkCard() {
  return (
    <Panel title="模組維護" icon={<Boxes size={18} aria-hidden />}>
      <p className="mb-4 text-xs text-[var(--text-muted)]">
        可將個別功能模組設為維護或關閉，並監控各模組的錯誤率與斷路器狀態。
      </p>
      <a
        href="/admin/modules"
        className="btn btn-secondary inline-flex items-center gap-2 text-sm"
      >
        <Boxes size={15} aria-hidden />
        前往模組維護頁面
      </a>
    </Panel>
  );
}


function SlowQueriesPanel() {
  const [items, setItems] = useState<
    Array<{ template: string; max_ms: number; occurrences: number; last_seen: number }>
  >([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await systemApi.slowQueries(10);
      setItems(data.items);
    } catch (e) {
      toast.error(apiErrorMessage(e, "載入慢查詢失敗"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Panel title="慢查詢監控（最近樣本）" icon={<Gauge size={18} aria-hidden />}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          記憶體 ring buffer，僅保留 SQL 結構模板（已去除字面值），重啟後清空。
        </p>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="btn btn-ghost text-xs"
        >
          <RefreshCcw size={12} aria-hidden /> 重新整理
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm py-6 text-center" style={{ color: "var(--text-muted)" }}>
          {loading ? "載入中…" : "目前沒有 >50ms 的慢查詢樣本"}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-[var(--text-muted)]">
              <tr className="border-b border-[var(--border)]">
                <th className="py-2 text-left font-medium">SQL 模板</th>
                <th className="text-right font-medium">最長 (ms)</th>
                <th className="text-right font-medium">次數</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.template} className="border-b border-[var(--border)] last:border-0 align-top">
                  <td className="py-2 pr-4 font-mono text-[11px] leading-snug break-all"
                    style={{ color: "var(--text-secondary)" }}>
                    {row.template}
                  </td>
                  <td className="text-right text-[var(--text-primary)] tabular-nums">{row.max_ms}</td>
                  <td className="text-right text-[var(--text-secondary)] tabular-nums">{row.occurrences}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

type ErrorTone = "danger" | "warning" | "neutral";

const ERROR_CATEGORY: Record<
  ErrorCategory,
  { label: string; tone: ErrorTone; hint: string }
> = {
  db: { label: "資料庫", tone: "danger", hint: "可試「升級資料庫」或「重啟服務」" },
  unhandled: { label: "未處理例外", tone: "danger", hint: "展開追蹤後修正程式碼" },
  redis: { label: "Redis / 快取", tone: "warning", hint: "可試「清除快取」或「重啟服務」" },
  timeout: { label: "逾時", tone: "warning", hint: "負載可能過高，檢視慢查詢或重啟" },
  http: { label: "5xx 例外", tone: "neutral", hint: "由程式主動拋出的 5xx" },
};

const ERROR_BAR: Record<ErrorTone, string> = {
  danger: "bg-[var(--danger)]",
  warning: "bg-[var(--warning)]",
  neutral: "bg-[var(--border-strong)]",
};

const ERROR_CHIP: Record<ErrorTone, string> = {
  danger: "border-[var(--danger-border)] bg-[var(--danger-dim)] text-[var(--danger)]",
  warning: "border-[var(--warning-border)] bg-[var(--warning-dim)] text-[var(--warning)]",
  neutral: "border-[var(--border)] bg-[var(--bg-hover)] text-[var(--text-muted)]",
};

function ErrorRow({ item }: { item: RecentErrorItem }) {
  const meta = ERROR_CATEGORY[item.category] ?? ERROR_CATEGORY.unhandled;
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
      <div className="flex">
        <div className={`w-1 shrink-0 ${ERROR_BAR[meta.tone]}`} />
        <div className="min-w-0 flex-1 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${ERROR_CHIP[meta.tone]}`}
            >
              {meta.label}
            </span>
            <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">
              {item.exc_type}
            </span>
            <span className="rounded bg-[var(--bg-hover)] px-1.5 py-0.5 font-mono text-xs text-[var(--text-secondary)]">
              {item.status_code}
            </span>
            {item.occurrences > 1 && (
              <span className="rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-xs text-[var(--text-secondary)]">
                ×{item.occurrences}
              </span>
            )}
            <span className="ml-auto text-xs text-[var(--text-muted)]">
              {new Date(item.last_seen * 1000).toLocaleString()}
            </span>
          </div>
          <div className="mt-1.5 font-mono text-xs text-[var(--text-secondary)]">
            <span className="text-[var(--text-muted)]">{item.method}</span> {item.path}
            <span className="ml-2 text-[var(--text-muted)]">id={item.error_id}</span>
            {item.request_id && (
              <span className="ml-2 text-[var(--text-muted)]">request={item.request_id}</span>
            )}
          </div>
          {(item.client_ip || item.user_agent || item.source) && (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
              {item.client_ip && <span>IP：{item.client_ip}</span>}
              {item.source && <span>來源：{item.source === "redis" ? "報告事件" : "即時緩衝"}</span>}
              {item.user_agent && <span className="break-all">UA：{item.user_agent}</span>}
            </div>
          )}
          {item.message && (
            <div className="mt-1 break-words text-sm text-[var(--text-primary)]">{item.message}</div>
          )}
          <div className="mt-1 text-xs text-[var(--text-muted)]">{meta.hint}</div>
          {item.traceback_head && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                展開追蹤 (traceback)
              </summary>
              <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-[var(--bg-hover)] p-2 font-mono text-[11px] leading-snug text-[var(--text-secondary)]">
                {item.traceback_head}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function RecentErrorsPanel() {
  const [items, setItems] = useState<RecentErrorItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [lookupCode, setLookupCode] = useState("");
  const [lookupResult, setLookupResult] = useState<RecentErrorItem | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await systemApi.recentErrors(50);
      setItems(data.items);
    } catch (e) {
      toast.error(apiErrorMessage(e, "載入錯誤紀錄失敗"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const clear = async () => {
    if (!window.confirm("清空目前的錯誤緩衝？")) return;
    try {
      const out = await systemApi.clearErrors();
      toast.success(`已清空 ${out.cleared} 筆錯誤`);
      setItems([]);
    } catch (e) {
      toast.error(apiErrorMessage(e, "清空失敗"));
    }
  };

  const lookup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = lookupCode.trim();
    if (!code) {
      toast.warning("請輸入錯誤代碼");
      return;
    }
    setLookupLoading(true);
    try {
      const item = await systemApi.errorById(code);
      setLookupResult(item);
    } catch (e) {
      setLookupResult(null);
      toast.error(apiErrorMessage(e, "查詢失敗"));
    } finally {
      setLookupLoading(false);
    }
  };

  return (
    <Panel
      title="近期伺服器錯誤"
      icon={<Bug size={18} aria-hidden />}
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
        記憶體 ring buffer，記錄最近的 5xx／未處理例外（相同錯誤聚合計數），重啟後清空。顏色代表類型：
        <span className="mx-1 text-[var(--danger)]">紅＝資料庫/未處理</span>
        <span className="mx-1 text-[var(--warning)]">金＝快取/逾時</span>
        <span className="mx-1 text-[var(--text-muted)]">灰＝主動拋出的 5xx</span>
      </p>
      <form
        onSubmit={lookup}
        className="mb-3 flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 sm:flex-row sm:items-center"
      >
        <label className="text-xs font-medium text-[var(--text-secondary)]" htmlFor="error-code-lookup">
          錯誤代碼查詢
        </label>
        <input
          id="error-code-lookup"
          value={lookupCode}
          onChange={(event) => setLookupCode(event.target.value)}
          placeholder="貼上使用者回報的錯誤代碼"
          className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 font-mono text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary)]"
        />
        <button type="submit" disabled={lookupLoading} className="btn btn-primary text-xs">
          <Search size={13} aria-hidden /> {lookupLoading ? "查詢中…" : "查詢報告"}
        </button>
      </form>
      {lookupResult && (
        <div className="mb-3">
          <div className="mb-1 text-xs font-medium text-[var(--text-secondary)]">
            查詢結果：{lookupResult.error_id}
          </div>
          <ErrorRow item={lookupResult} />
        </div>
      )}
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--text-muted)]">
          {loading ? "載入中…" : "目前沒有錯誤紀錄 🎉"}
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <ErrorRow key={`${item.error_id}-${item.first_seen}`} item={item} />
          ))}
        </div>
      )}
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
    if (!window.confirm("清空 Celery dead-letter 佇列？")) return;
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
        背景排程／worker 任務失敗時寫入 Redis（與自動錯誤報告 email 同一來源）。API 5xx
        不會出現在這裡，背景任務失敗也不會出現在上方「近期伺服器錯誤」——兩者來源不同，請一併檢視。
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
    if (!window.confirm("執行資料庫遷移 alembic upgrade head？建議先確認已備份。")) return;
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
    if (
      !window.confirm(
        "重啟服務？開發環境會觸發熱重載，正式環境會對 gunicorn master 送 SIGHUP 優雅重載 worker。",
      )
    )
      return;
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
