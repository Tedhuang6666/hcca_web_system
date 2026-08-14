import { API_BASE, apiUrl } from "../config";
import { ApiError } from "../api-helpers";
import { clearAuthCache, clearImpersonationSession, getImpersonationSession } from "../auth-cache";
import { reportClientError } from "../client-error-reporter";

export { ApiError };

export const BASE = API_BASE;
void apiUrl;

export type HccaRequestInit = RequestInit & { skipImpersonation?: boolean };

// ── 核心 fetch 包裝 ────────────────────────────────────────────────────────────

type RefreshStatus = "ok" | "invalid" | "unavailable";

let refreshPromise: Promise<RefreshStatus> | null = null;
let sessionExpiryRedirectStarted = false;

const AUTH_REFRESH_TIMEOUT_MS = 8_000;
const AUTH_REFRESH_LOCK_NAME = "hcca-auth-refresh";
const AUTH_REFRESH_LOCK_KEY = "hcca:auth-refresh-lock";
const AUTH_REFRESH_STATE_KEY = "hcca:auth-refresh-state";
const AUTH_REFRESH_LOCK_TTL_MS = AUTH_REFRESH_TIMEOUT_MS + 2_000;
const AUTH_REFRESH_WAIT_TIMEOUT_MS = AUTH_REFRESH_TIMEOUT_MS + 3_000;
const AUTH_REFRESH_STATE_TTL_MS = 15_000;

type RefreshState = { completedAt: number; status: RefreshStatus };
type RefreshLock = { owner: string; expiresAt: number };

const refreshOwner = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function formatErrorDetail(detail: unknown, fallback: string): string {
  if (!detail) return fallback;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return String(item);
        const record = item as Record<string, unknown>;
        const msg = typeof record.msg === "string" ? record.msg : undefined;
        const loc = Array.isArray(record.loc)
          ? record.loc.filter((part) => part !== "body").join(".")
          : undefined;
        if (msg && loc) return `${loc}: ${msg}`;
        if (msg) return msg;
        return JSON.stringify(record);
      })
      .filter(Boolean);
    return messages.length ? messages.join("；") : fallback;
  }
  if (typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    for (const key of ["message", "msg", "error", "detail"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    try {
      return JSON.stringify(record);
    } catch {
      return fallback;
    }
  }
  return String(detail);
}

interface ResponseErrorDetail {
  message: string;
  requestId: string | null;
  errorId: string | null;
  traceId: string | null;
}

async function errorDetailFromResponse(res: Response): Promise<ResponseErrorDetail> {
  let detail: unknown = res.statusText;
  let errorId: string | null = null;
  let traceId = res.headers.get("X-Trace-ID");
  try {
    const payload: unknown = await res.json();
    if (payload && typeof payload === "object") {
      const record = payload as { detail?: unknown; error_id?: unknown; errors?: unknown };
      detail = record.errors ?? record.detail ?? payload;
      errorId = typeof record.error_id === "string" ? record.error_id : null;
      if (!traceId && payload && typeof payload === "object") {
        const payloadTraceId = (payload as { trace_id?: unknown }).trace_id;
        traceId = typeof payloadTraceId === "string" ? payloadTraceId : null;
      }
    } else {
      detail = payload;
    }
  } catch {
    // ignore non-JSON error bodies
  }
  const message = formatErrorDetail(detail, res.statusText || "請求失敗");
  const requestId = res.headers.get("X-Request-ID");
  const codes = [
    errorId ? `錯誤代碼 ${errorId}` : null,
    requestId ? `請求代碼 ${requestId}` : null,
  ].filter(Boolean);
  return {
    message: codes.length > 0 ? `${message}（${codes.join("，")}）` : message,
    requestId,
    errorId,
    traceId,
  };
}

export async function errorMessageFromResponse(res: Response): Promise<string> {
  return (await errorDetailFromResponse(res)).message;
}

async function apiErrorFromResponse(res: Response): Promise<ApiError> {
  const detail = await errorDetailFromResponse(res);
  return new ApiError(res.status, detail.message, detail.requestId, detail.errorId, detail.traceId);
}

function createTraceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replaceAll("-", "");
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.padEnd(32, "0").slice(0, 32);
}

function createSpanId(): string {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  return (Date.now().toString(16) + Math.random().toString(16).slice(2))
    .slice(-16)
    .padStart(16, "0");
}

async function refreshOnce(): Promise<RefreshStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_REFRESH_TIMEOUT_MS);
  const nextRefresh = fetch(apiUrl("/auth/refresh"), {
    method: "POST",
    credentials: "include",
    headers: csrfHeaders("POST"),
    signal: controller.signal,
  })
    .then((res): RefreshStatus => {
      if (res.ok) return "ok";
      return res.status >= 500 ? "unavailable" : "invalid";
    })
    .catch((): RefreshStatus => "unavailable")
    .finally(() => {
      clearTimeout(timeout);
    });
  return nextRefresh;
}

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function readRefreshState(): RefreshState | null {
  const storage = browserStorage();
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(AUTH_REFRESH_STATE_KEY) ?? "null") as Partial<RefreshState>;
    if (
      typeof value.completedAt !== "number"
      || !Number.isFinite(value.completedAt)
      || !["ok", "invalid", "unavailable"].includes(value.status ?? "")
    ) {
      return null;
    }
    return { completedAt: value.completedAt, status: value.status as RefreshStatus };
  } catch {
    return null;
  }
}

function writeRefreshState(status: RefreshStatus): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(AUTH_REFRESH_STATE_KEY, JSON.stringify({ completedAt: Date.now(), status }));
  } catch {
    // Storage may be disabled; the in-tab promise lock still protects this tab.
  }
}

function recentRefreshSince(observedAt: number): RefreshStatus | null {
  const state = readRefreshState();
  if (!state || state.completedAt <= observedAt) return null;
  return Date.now() - state.completedAt <= AUTH_REFRESH_STATE_TTL_MS ? state.status : null;
}

async function refreshWithNavigatorLock(observedAt: number): Promise<RefreshStatus | null> {
  if (typeof navigator === "undefined" || !("locks" in navigator)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_REFRESH_WAIT_TIMEOUT_MS);
  try {
    return await navigator.locks.request(
      AUTH_REFRESH_LOCK_NAME,
      { signal: controller.signal },
      async () => {
        const recent = recentRefreshSince(observedAt);
        if (recent) return recent;
        const status = await refreshOnce();
        writeRefreshState(status);
        return status;
      },
    );
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timeout);
  }
}

function readRefreshLock(): RefreshLock | null {
  const storage = browserStorage();
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(AUTH_REFRESH_LOCK_KEY) ?? "null") as Partial<RefreshLock>;
    if (typeof value.owner !== "string" || typeof value.expiresAt !== "number") return null;
    return value as RefreshLock;
  } catch {
    return null;
  }
}

function tryAcquireRefreshLock(): boolean {
  const storage = browserStorage();
  if (!storage) return false;
  const now = Date.now();
  const current = readRefreshLock();
  if (current && current.owner !== refreshOwner && current.expiresAt > now) return false;
  try {
    storage.setItem(
      AUTH_REFRESH_LOCK_KEY,
      JSON.stringify({ owner: refreshOwner, expiresAt: now + AUTH_REFRESH_LOCK_TTL_MS }),
    );
    return readRefreshLock()?.owner === refreshOwner;
  } catch {
    return false;
  }
}

function releaseRefreshLock(): void {
  const storage = browserStorage();
  if (!storage || readRefreshLock()?.owner !== refreshOwner) return;
  try {
    storage.removeItem(AUTH_REFRESH_LOCK_KEY);
  } catch {
    // Ignore cleanup failures; the lock has a short expiry as a safety net.
  }
}

async function refreshWithStorageLock(observedAt: number): Promise<RefreshStatus> {
  if (!browserStorage()) return refreshOnce();

  const deadline = Date.now() + AUTH_REFRESH_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (tryAcquireRefreshLock()) {
      try {
        const recent = recentRefreshSince(observedAt);
        if (recent) return recent;
        const status = await refreshOnce();
        writeRefreshState(status);
        return status;
      } finally {
        releaseRefreshLock();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  return "unavailable";
}

async function refreshWithStatus(): Promise<RefreshStatus> {
  if (refreshPromise) return refreshPromise;

  const observedAt = readRefreshState()?.completedAt ?? 0;
  const nextRefresh = (async () => {
    const lockedStatus = await refreshWithNavigatorLock(observedAt);
    return lockedStatus ?? refreshWithStorageLock(observedAt);
  })().finally(() => {
    refreshPromise = null;
  });
  refreshPromise = nextRefresh;
  return nextRefresh;
}

export async function silentRefresh(): Promise<boolean> {
  return (await refreshWithStatus()) === "ok";
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length) ?? null;
}

export function csrfHeaders(method?: string): Record<string, string> {
  const normalized = (method ?? "GET").toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(normalized)) return {};
  const token = getCookie("csrf_token");
  return token ? { "X-CSRF-Token": decodeURIComponent(token) } : {};
}

function redirectToLoginAfterExpiry(): void {
  if (typeof window === "undefined") return;

  clearAuthCache();
  if (window.location.pathname === "/login" || sessionExpiryRedirectStarted) return;

  sessionExpiryRedirectStarted = true;
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`/login?next=${encodeURIComponent(next)}`);
}

/** 供上傳、下載等不能直接使用 request() 的 API 呼叫沿用代行身分。 */
export function authFetch(input: RequestInfo | URL, init: HccaRequestInit = {}): Promise<Response> {
  const { skipImpersonation: _skipImpersonation, ...requestInit } = init;
  const impersonation = _skipImpersonation ? null : getImpersonationSession();
  const headers = new Headers(requestInit.headers);
  if (impersonation) headers.set("Authorization", `Bearer ${impersonation.token}`);
  return fetch(input, { ...requestInit, headers });
}

// GET 在網路錯誤時最多重試 N 次，間隔逐步加長
const GET_NETWORK_RETRIES = 2;

const RETRY_BACKOFF_MS = [400, 900];

// ── 端點熔斷器 ────────────────────────────────────────────────────────────────
// 同一路徑連續「硬失敗」（網路斷線 / 5xx / 5字頭閘道）達門檻就短暫開斷，
// 開斷期間直接快速失敗，不再對著掛掉的後端雪崩式重打。伺服器只要回得了
// （含 4xx）就算可達 → 重置。與後端 mem_limit/healthcheck 形成前後端雙層保護。
const CIRCUIT_THRESHOLD = 3;

const CIRCUIT_OPEN_MS = 60_000;

const circuits = new Map<string, { failures: number; openUntil: number }>();

function circuitKey(path: string): string {
  const q = path.indexOf("?");
  return q === -1 ? path : path.slice(0, q);
}

function circuitOpen(key: string): boolean {
  const c = circuits.get(key);
  return c ? c.openUntil > Date.now() : false;
}

function recordHardFailure(key: string): void {
  const c = circuits.get(key) ?? { failures: 0, openUntil: 0 };
  c.failures += 1;
  if (c.failures >= CIRCUIT_THRESHOLD) c.openUntil = Date.now() + CIRCUIT_OPEN_MS;
  circuits.set(key, c);
}

function recordReachable(key: string): void {
  // 伺服器有回應（即使是 4xx）→ 視為可達，清掉熔斷計數
  if (circuits.has(key)) circuits.delete(key);
}

/** 瀏覽器明確處於離線狀態（navigator.onLine === false）。 */
function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function isProtectionRecoveryPath(pathname: string): boolean {
  return ["/login", "/auth", "/admin", "/maintenance"].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function request<T>(
  path: string,
  init: HccaRequestInit = {},
  retriedAfterRefresh = false,
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const cKey = circuitKey(path);

  // 離線：直接快速失敗，不浪費一輪 fetch（由呼叫端/輪詢退避處理）
  if (isOffline()) {
    reportClientError({ scope: "api.offline", message: `離線狀態：${path}` });
    throw new ApiError(0, "目前處於離線狀態");
  }
  // 熔斷開斷中：同一端點剛連續失敗過，60 秒內不再嘗試
  if (circuitOpen(cKey)) {
    // 熔斷是前端針對既有 5xx/網路錯誤的保護狀態，不是新的 runtime error；
    // 重複回報會在後端不可用時形成回報風暴，並把同一事故誤顯示成多筆 500。
    throw new ApiError(0, "暫時無法連線至後端（熔斷中），請稍候再試");
  }

  let res: Response;
  let lastError: unknown = null;
  const maxRetries = method === "GET" ? GET_NETWORK_RETRIES : 0;
  const traceId = createTraceId();
  const traceparent = "00-" + traceId + "-" + createSpanId() + "-01";
  let attempt = 0;
  const fetchInit = (): RequestInit => {
    const { skipImpersonation: _skipImpersonation, ...requestInit } = init;
    const impersonation = _skipImpersonation ? null : getImpersonationSession();
    return {
      ...requestInit,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...csrfHeaders(init.method),
        ...init.headers,
        ...(impersonation ? { Authorization: `Bearer ${impersonation.token}` } : {}),
        "X-Trace-ID": traceId,
        traceparent,
      },
    };
  };
  while (true) {
    try {
      res = await fetch(`${BASE}${path}`, fetchInit());
      break;
    } catch (err) {
      lastError = err;
      if (attempt >= maxRetries) {
        recordHardFailure(cKey);
        reportClientError({
          scope: "api.network",
          message: lastError instanceof Error ? lastError.message : `無法連線：${path}`,
          stack: lastError instanceof Error ? lastError.stack : undefined,
        });
        throw new ApiError(0, `無法連線至後端 API：${BASE}`);
      }
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt] ?? 1500));
      attempt += 1;
    }
  }
  void lastError;

  // 熔斷記帳：5xx/5字頭閘道算硬失敗；其餘（含 4xx）代表伺服器可達 → 重置
  if (res.status >= 500) recordHardFailure(cKey);
  else recordReachable(cKey);

  // 401 → 嘗試 silent refresh，成功後重試一次
  if (res.status === 401) {
    const impersonation = getImpersonationSession();
    if (impersonation && !init.skipImpersonation) {
      clearImpersonationSession();
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.reload();
      }
      throw new ApiError(401, "模擬登入已過期，已返回原本的管理員身分");
    }
    // 公開頁面也會呼叫共用 API wrapper；訪客沒有可更新的 refresh token，
    // 不應因單一受保護請求再製造一個 /auth/refresh 401。
    const hasLocalLogin = typeof window === "undefined"
      || Boolean(window.localStorage.getItem("user_id"));
    if (!hasLocalLogin && !impersonation) {
      throw await apiErrorFromResponse(res);
    }
    const refreshStatus = await refreshWithStatus();
    if (refreshStatus === "ok") {
      let retry: Response;
      try {
        retry = await fetch(`${BASE}${path}`, fetchInit());
      } catch {
        reportClientError({ scope: "api.refresh-network", message: `刷新後重試失敗：${path}` });
        throw new ApiError(0, `無法連線至後端 API：${BASE}`);
      }
      if (retry.ok) {
        if (retry.status === 204) return undefined as T;
        return retry.json();
      }
      if (retry.status === 401) {
        redirectToLoginAfterExpiry();
        throw new ApiError(401, "登入已過期，請重新登入", retry.headers.get("X-Request-ID"));
      }
      throw await apiErrorFromResponse(retry);
    }
    if (refreshStatus === "unavailable") {
      throw new ApiError(503, "登入服務暫時不可用，請稍後再試", res.headers.get("X-Request-ID"));
    }

    // refresh 明確失敗：
    // - 若本地「看起來已登入」（有 user_id），視為 session 過期 → 清除並導回登入
    // - 若未登入（無 user_id），可能是在存取公開端點 → 不強制導向 /login
    if (typeof window !== "undefined") {
      if (Boolean(localStorage.getItem("user_id"))) {
        redirectToLoginAfterExpiry();
      }
    }
    throw new ApiError(401, "登入已過期，請重新登入", res.headers.get("X-Request-ID"));
  }

  // 503 + maintenance/load_shed → 先 refresh 一次，讓舊 token 補上 admin/bypass claims
  if (res.status === 503) {
    try {
      const payload = (await res.clone().json()) as {
        detail?: string;
        maintenance?: boolean;
        load_shed?: boolean;
        module_maintenance?: boolean;
        module?: string;
        mode?: "maintenance" | "closed";
        reason?: string;
        until?: number | null;
      };
      // 模組維護：只關掉該模組，不整站轉址（交由 AppShell gate 顯示插頁）。
      // 廣播事件讓 ModuleStatus context 立即重抓，免等輪詢；照常 fall through 拋 ApiError(503)。
      if (typeof window !== "undefined" && payload.module_maintenance) {
        window.dispatchEvent(
          new CustomEvent("hcca:module-maintenance", {
            detail: {
              module: payload.module,
              mode: payload.mode,
              reason: payload.reason,
              until: payload.until,
            },
          }),
        );
      }
      if (
        typeof window !== "undefined"
        && (payload.maintenance || payload.load_shed)
        && !payload.module_maintenance
      ) {
        const hasLocalLogin = Boolean(localStorage.getItem("user_id"));
        if (hasLocalLogin && !retriedAfterRefresh) {
          const refreshed = await silentRefresh();
          if (refreshed) return request<T>(path, init, true);
        }

        const retryAfter = res.headers.get("Retry-After") ?? "30";
        const detail = encodeURIComponent(payload.detail ?? "");
        const kind = payload.maintenance ? "maintenance" : "busy";
        const params = new URLSearchParams({ retry: retryAfter, detail, kind });
        if (payload.until) params.set("until", String(payload.until));
        if (!isProtectionRecoveryPath(window.location.pathname)) {
          window.location.assign(`/maintenance?${params.toString()}`);
        }
      }
    } catch {
      // 非 JSON 回應；fall through
    }
  }

  if (!res.ok) {
    if (res.status === 412 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("hcca:policy-consent-required"));
    }
    if (res.status === 403 && typeof window !== "undefined") {
      const mfaRequired = res.headers.get("X-MFA-Required");
      if (mfaRequired === "true") {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.replace(`/settings/security?mfa_required=1&next=${next}`);
        throw new ApiError(403, "需要設定雙重驗證才能存取此功能");
      }
    }
    throw await apiErrorFromResponse(res);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const get = <T>(p: string) => request<T>(p);

export const post = <T>(p: string, body?: unknown) => request<T>(p, { method: "POST", body: JSON.stringify(body) });

export const patch = <T>(p: string, body: unknown) => request<T>(p, { method: "PATCH", body: JSON.stringify(body) });

export const put = <T>(p: string, body: unknown) => request<T>(p, { method: "PUT", body: JSON.stringify(body) });

export const del = <T>(p: string) => request<T>(p, { method: "DELETE" });

export const pathSegment = (value: string) => {
  try {
    return encodeURIComponent(decodeURIComponent(value));
  } catch {
    return encodeURIComponent(value);
  }
};

// ── 使用者 / Auth ──────────────────────────────────────────────────────────────

export type UserSummary = { id: string; display_name: string; email: string };

export type PrivacyRequestType =
  | "access"
  | "export"
  | "correction"
  | "deletion"
  | "restriction"
  | "objection";

export type PrivacyRequestStatus =
  | "submitted"
  | "in_review"
  | "completed"
  | "rejected"
  | "cancelled";

export interface PrivacyRequestOut {
  id: string;
  user_id: string;
  request_type: PrivacyRequestType;
  status: PrivacyRequestStatus;
  subject: string;
  description: string;
  submitted_ip_address: string | null;
  submitted_user_agent: string | null;
  response_message: string | null;
  handled_by: string | null;
  handled_at: string | null;
  created_at: string;
  updated_at: string;
}
