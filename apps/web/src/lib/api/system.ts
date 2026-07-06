import { get, post, patch, put, del } from "./core";

// ── 管理員系統狀態（admin/system） ───────────────────────────────────────────

export interface DbPoolView {
  size: number;
  checked_in: number;
  checked_out: number;
  overflow: number;
  utilization: number;
}

export interface WsLimits {
  global_max: number;
  per_ip_max: number;
  per_room_max: number;
}

export interface WsRoomCount {
  room: string;
  connections: number;
}

export interface WsView {
  total: number;
  rooms: number;
  unique_ips: number;
  per_room: WsRoomCount[];
  limits: WsLimits;
}

export interface CeleryQueueView {
  name: string;
  active: number;
  reserved: number;
}

export interface CeleryView {
  queues: CeleryQueueView[];
  error: string | null;
}

export interface RedisView {
  connected_clients: number;
  blocked_clients: number;
  error: string | null;
}

export interface LoadSignalsView {
  active_requests: number;
  recent_5xx_ratio: number;
  recent_5xx_count: number;
  window_seconds: number;
}

export interface MaintenanceView {
  enabled: boolean;
  message: string;
  until: number | null;
}

export type LoadShedMode = "off" | "auto" | "on" | "bypass";

export interface SystemMetricsSnapshot {
  timestamp: number;
  db_pool: DbPoolView;
  redis: RedisView;
  ws: WsView;
  celery: CeleryView;
  load_signals: LoadSignalsView;
  maintenance: MaintenanceView;
  load_shed_mode: LoadShedMode;
}

export interface SystemFeatureFlag {
  key: string;
  description: string;
  enabled: boolean;
}

export type ModuleSeverity = "CRITICAL" | "HIGH" | "NORMAL";

export interface ModuleStatus {
  id: string;
  label: string;
  on: boolean;
  mode: "maintenance" | "closed";
  source: "manual" | "auto" | null;
  reason: string;
  since: number | null;
  until: number | null;
  recent_5xx_count: number;
  severity_breakdown: Record<string, number>;
  trip_count: number;
  max_severity: ModuleSeverity;
}

export interface ModuleRecoverResult {
  module_id: string;
  recovered: boolean;
  probe_ok: boolean;
  probe_reason: string;
}

export interface ModuleTripHistory {
  module_id: string;
  trip_count: number;
  max_severity: ModuleSeverity;
  recent_5xx_count: number;
  severity_breakdown: Record<string, number>;
  recent_events: Array<{
    timestamp: number;
    severity: ModuleSeverity;
    trip_count: number;
    cooldown_s: number;
    escalated: boolean;
  }>;
}

export interface ModuleStatusPublic {
  id: string;
  label: string;
  on: boolean;
  mode: "maintenance" | "closed";
  reason: string;
  until: number | null;
}

export interface AppSettingField {
  key: string;
  category: string;
  type: "bool" | "number" | "list" | "string";
  is_secret: boolean;
  in_file: boolean;
  value: string;
  description: string;
}

export interface AppSettingsListResponse {
  enabled: boolean;
  mfa_enabled: boolean;
  env_path: string;
  fields: AppSettingField[];
}

export interface IpBlockedItem {
  ip: string;
  reason: string;
  expires_at: number | null;
}

export type DefenseRuleType =
  | "ip_block"
  | "cidr_block"
  | "ip_allow"
  | "rate_limit_override"
  | "endpoint_lockdown"
  | "bot_challenge_placeholder";

export interface DefenseRule {
  id: string;
  rule_type: DefenseRuleType;
  target: string;
  is_active: boolean;
  reason: string;
  config: Record<string, unknown>;
  expires_at: number | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DefenseRuleCreate {
  rule_type: DefenseRuleType;
  target: string;
  reason?: string;
  config?: Record<string, unknown>;
  expires_at?: string | null;
}

export interface DefenseRuleUpdate {
  rule_type?: DefenseRuleType;
  target?: string;
  is_active?: boolean;
  reason?: string;
  config?: Record<string, unknown>;
  expires_at?: string | null;
}

export interface RateLimitOverride {
  path_prefix: string;
  requests: number;
  window_seconds: number;
}

export interface RateLimitConfig {
  enabled: boolean;
  global_requests: number;
  global_window_seconds: number;
  overrides: RateLimitOverride[];
}

export interface DefenseSummary {
  active_rule_count: number;
  total_rule_count: number;
  active_by_type: Record<string, number>;
  active_rules: DefenseRule[];
  rate_limit: RateLimitConfig;
  recent_status_counts: Record<string, number>;
}

export type ErrorCategory = "db" | "redis" | "timeout" | "http" | "unhandled";

export interface RecentErrorItem {
  error_id: string;
  request_id?: string | null;
  client_ip?: string | null;
  user_agent?: string | null;
  category: ErrorCategory;
  exc_type: string;
  message: string;
  method: string;
  path: string;
  status_code: number;
  traceback_head: string;
  first_seen: number;
  last_seen: number;
  occurrences: number;
  source?: string;
}

export interface RecentErrorsResponse {
  count: number;
  items: RecentErrorItem[];
}

export interface DeadLetterItem {
  timestamp?: string | null;
  status?: string | null;
  task?: string | null;
  task_id?: string | null;
  queue?: string | null;
  retries?: number | null;
  exception_type?: string | null;
  exception?: string | null;
  args?: string[];
  kwargs?: Record<string, string>;
}

export interface DeadLetterResponse {
  key: string;
  items: DeadLetterItem[];
}

export interface DbUpgradeResult {
  ok: boolean;
  error?: string;
  before_revision?: string | null;
  head_revision?: string | null;
  changed?: boolean;
}

export interface SystemDiagnostics {
  timestamp: number;
  version: string;
  uptime_seconds: number;
  db: { ok: boolean; detail?: string | null };
  redis: { ok: boolean; detail?: string | null };
  celery: { ok: boolean; detail?: string | null };
  workers: { name: string; active: number; reserved: number }[];
  queue_depths: { name: string; pending: number }[];
  email_queue_pending: number;
  email_outbox: Record<string, number>;
  ws: WsView;
}

export const systemApi = {
  status: () => get<SystemMetricsSnapshot>("/admin/system/status"),
  defenseSummary: () => get<DefenseSummary>("/admin/system/defense/summary"),
  listDefenseRules: (params?: { active_only?: boolean; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.active_only !== undefined) q.set("active_only", String(params.active_only));
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    const qs = q.toString();
    return get<DefenseRule[]>(`/admin/system/defense/rules${qs ? `?${qs}` : ""}`);
  },
  createDefenseRule: (body: DefenseRuleCreate) =>
    post<DefenseRule>("/admin/system/defense/rules", body),
  updateDefenseRule: (id: string, body: DefenseRuleUpdate) =>
    patch<DefenseRule>(`/admin/system/defense/rules/${encodeURIComponent(id)}`, body),
  deactivateDefenseRule: (id: string) =>
    del<DefenseRule>(`/admin/system/defense/rules/${encodeURIComponent(id)}`),
  rateLimit: () => get<RateLimitConfig>("/admin/system/rate-limit"),
  setRateLimit: (body: RateLimitConfig) => put<RateLimitConfig>("/admin/system/rate-limit", body),
  maintenance: () => get<MaintenanceView>("/admin/system/maintenance"),
  setMaintenance: (body: { enabled: boolean; message?: string; until?: number | null }) =>
    put<MaintenanceView>("/admin/system/maintenance", body),
  listFeatureFlags: () => get<SystemFeatureFlag[]>("/admin/system/feature-flags"),
  setFeatureFlag: (key: string, enabled: boolean) =>
    patch<SystemFeatureFlag>(`/admin/system/feature-flags/${encodeURIComponent(key)}`, { enabled }),
  setLoadShedMode: (mode: LoadShedMode) =>
    put<{ mode: LoadShedMode }>("/admin/system/load-shed", { mode }),
  moduleStatuses: () => get<ModuleStatusPublic[]>("/system/module-status"),
  diagnostics: () => get<SystemDiagnostics>("/admin/system/diagnostics"),
  listModules: () => get<ModuleStatus[]>("/admin/system/modules"),
  setModuleMaintenance: (
    id: string,
    body: { on: boolean; mode?: "maintenance" | "closed"; reason?: string },
  ) =>
    put<ModuleStatus>(`/admin/system/modules/${encodeURIComponent(id)}/maintenance`, body),
  restartModule: (id: string) =>
    post<{ ok: boolean; module: string }>(
      `/admin/system/modules/${encodeURIComponent(id)}/restart`,
      {},
    ),
  recoverModule: (id: string) =>
    post<ModuleRecoverResult>(
      `/admin/system/modules/${encodeURIComponent(id)}/recover`,
      {},
    ),
  moduleTripHistory: (id: string) =>
    get<ModuleTripHistory>(`/admin/system/modules/${encodeURIComponent(id)}/trip-history`),
  listAppSettings: () => get<AppSettingsListResponse>("/admin/system/settings"),
  revealAppSettings: (mfa_code: string, keys: string[]) =>
    post<{ values: Record<string, string> }>("/admin/system/settings/reveal", {
      mfa_code,
      keys,
    }),
  saveAppSettings: (mfa_code: string, changes: Record<string, string>) =>
    put<{ updated: string[]; restart_required: boolean }>("/admin/system/settings", {
      mfa_code,
      changes,
    }),
  listIpBlocks: () => get<IpBlockedItem[]>("/admin/system/ip-blocklist"),
  addIpBlock: (body: { ip: string; reason?: string; ttl_seconds?: number | null }) =>
    post<IpBlockedItem>("/admin/system/ip-blocklist", body),
  removeIpBlock: (ip: string) =>
    del<{ ip: string; removed: boolean }>(`/admin/system/ip-blocklist/${encodeURIComponent(ip)}`),
  revokeUserTokens: (user_id: string) =>
    post<{ user_id: string; revoked_count: number }>("/admin/system/revoke-user-tokens", { user_id }),
  wsRooms: () =>
    get<{
      stats: { total: number; rooms: number; unique_ips: number; limits: WsLimits };
      rooms: WsRoomCount[];
      ips: { ip: string; connections: number }[];
    }>("/admin/system/ws/rooms"),
  slowQueries: (top = 10) =>
    get<{
      top: number;
      items: Array<{ template: string; max_ms: number; occurrences: number; last_seen: number }>;
    }>(`/admin/system/metrics/slow-queries?top=${top}`),
  recentErrors: (top = 50) =>
    get<RecentErrorsResponse>(`/admin/system/errors?top=${top}`),
  errorById: (errorId: string) =>
    get<RecentErrorItem>(`/admin/system/errors/${encodeURIComponent(errorId)}`),
  clearErrors: () => post<{ cleared: number }>("/admin/system/errors/clear", {}),
  deadLetters: (limit = 50) =>
    get<DeadLetterResponse>(`/admin/system/dead-letters?limit=${limit}`),
  clearDeadLetters: () =>
    del<{ cleared: boolean; key: string }>("/admin/system/dead-letters"),
  clearCache: () =>
    post<{ ok: boolean; cleared: number; patterns: string[] }>(
      "/admin/system/recovery/clear-cache",
      {},
    ),
  dbUpgrade: () => post<DbUpgradeResult>("/admin/system/recovery/db-upgrade", {}),
  restartService: () =>
    post<{ scheduled: boolean; environment: string }>("/admin/system/recovery/restart", {}),
};
