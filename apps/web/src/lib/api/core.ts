import { API_BASE } from "../config";
import { ApiError } from "../api-helpers";
import { clearAuthCache, clearImpersonationSession, getImpersonationSession } from "../auth-cache";
import { reportClientError } from "../client-error-reporter";
import { recordApiMetric, recordCircuitOpen } from "../client-metrics";
import { apiErrorFromResponse, errorMessageFromResponse, formatErrorDetail } from "./errors";
import { circuitKey, circuitOpen, recordHardFailure, recordReachable } from "./circuit";
import { refreshWithStatus, silentRefresh } from "./refresh";
import {
  authFetch,
  csrfHeaders,
  fetchWithRetry,
  NetworkRequestError,
  traceHeaders,
  type HccaRequestInit,
  uploadWithProgress,
  type UploadProgressHandler,
} from "./transport";

export { ApiError };
export { authFetch, csrfHeaders, silentRefresh };
export { uploadWithProgress };
export { errorMessageFromResponse, formatErrorDetail };
export type { HccaRequestInit, UploadProgressHandler };

export const BASE = API_BASE;

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function isProtectionRecoveryPath(pathname: string): boolean {
  return ["/login", "/auth", "/admin", "/maintenance"].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function redirectToLoginAfterExpiry(): void {
  if (typeof window === "undefined") return;
  clearAuthCache();
  if (window.location.pathname === "/login") return;
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`/login?next=${encodeURIComponent(next)}`);
}

export async function request<T>(
  path: string,
  init: HccaRequestInit = {},
  retriedAfterRefresh = false,
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const key = circuitKey(path);
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (isOffline()) {
    reportClientError({ scope: "api.offline", message: `離線狀態：${path}` });
    throw new ApiError(0, "目前處於離線狀態");
  }
  if (circuitOpen(key)) {
    recordCircuitOpen(path);
    recordApiMetric({ path, status: 0, attempts: 0, circuit_open: true, duration_ms: Math.max(0, (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt) });
    throw new ApiError(0, "暫時無法連線至後端（熔斷中），請稍候再試");
  }

  const { headers: trace } = traceHeaders();
  let response: Response;
  try {
    const result = await fetchWithRetry(path, init, trace, method === "GET" ? 2 : 0);
    response = result.response;
    recordApiMetric({ path, status: response.status, attempts: result.attempts, duration_ms: Math.max(0, (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt) });
  } catch (error) {
    recordHardFailure(key);
    recordApiMetric({ path, status: 0, attempts: method === "GET" ? 2 : 0, duration_ms: Math.max(0, (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt) });
    if (error instanceof NetworkRequestError) throw new ApiError(0, error.message);
    throw error;
  }

  if (response.status >= 500) recordHardFailure(key);
  else recordReachable(key);

  if (response.status === 401) {
    const impersonation = getImpersonationSession();
    if (impersonation && !init.skipImpersonation) {
      clearImpersonationSession();
      if (typeof window !== "undefined" && window.location.pathname !== "/login") window.location.reload();
      throw new ApiError(401, "模擬登入已過期，已返回原本的管理員身分");
    }
    const hasLocalLogin = typeof window === "undefined" || Boolean(window.localStorage.getItem("user_id"));
    if (!hasLocalLogin && !impersonation) throw await apiErrorFromResponse(response);

    const refreshStatus = await refreshWithStatus();
    if (refreshStatus === "ok") {
      let retry: Response;
      try {
        ({ response: retry } = await fetchWithRetry(path, init, trace, 0));
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
      throw new ApiError(503, "登入服務暫時不可用，請稍後再試", response.headers.get("X-Request-ID"));
    }
    if (typeof window !== "undefined" && Boolean(window.localStorage.getItem("user_id"))) redirectToLoginAfterExpiry();
    throw new ApiError(401, "登入已過期，請重新登入", response.headers.get("X-Request-ID"));
  }

  if (response.status === 503) {
    try {
      const payload = (await response.clone().json()) as {
        detail?: string;
        maintenance?: boolean;
        load_shed?: boolean;
        module_maintenance?: boolean;
        module?: string;
        mode?: "maintenance" | "closed";
        reason?: string;
        until?: number | null;
      };
      if (typeof window !== "undefined" && payload.module_maintenance) {
        window.dispatchEvent(new CustomEvent("hcca:module-maintenance", { detail: payload }));
      }
      if (typeof window !== "undefined" && (payload.maintenance || payload.load_shed) && !payload.module_maintenance) {
        const hasLocalLogin = Boolean(window.localStorage.getItem("user_id"));
        if (hasLocalLogin && !retriedAfterRefresh && await silentRefresh()) return request<T>(path, init, true);
        const params = new URLSearchParams({
          retry: response.headers.get("Retry-After") ?? "30",
          detail: payload.detail ?? "",
          kind: payload.maintenance ? "maintenance" : "busy",
        });
        if (payload.until) params.set("until", String(payload.until));
        if (!isProtectionRecoveryPath(window.location.pathname)) window.location.assign(`/maintenance?${params}`);
      }
    } catch {
      // 非 JSON 維護回應直接沿用一般錯誤呈現。
    }
  }

  if (!response.ok) {
    if (response.status === 412 && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("hcca:policy-consent-required"));
    if (response.status === 403 && typeof window !== "undefined" && response.headers.get("X-MFA-Required") === "true") {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/settings/security?mfa_required=1&next=${next}`);
      throw new ApiError(403, "需要設定雙重驗證才能存取此功能");
    }
    throw await apiErrorFromResponse(response);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export const get = <T>(path: string) => request<T>(path);
export const post = <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const put = <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const del = <T>(path: string) => request<T>(path, { method: "DELETE" });

export const pathSegment = (value: string) => {
  try { return encodeURIComponent(decodeURIComponent(value)); }
  catch { return encodeURIComponent(value); }
};

export type UserSummary = { id: string; display_name: string; email: string };
export type PrivacyRequestType = "access" | "export" | "correction" | "deletion" | "restriction" | "objection";
export type PrivacyRequestStatus = "submitted" | "in_review" | "completed" | "rejected" | "cancelled";

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
