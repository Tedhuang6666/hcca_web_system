import { apiUrl } from "./config";
import { recordClientMetric } from "./client-metrics";

const MAX_MESSAGE_LENGTH = 1000;
const MAX_STACK_LENGTH = 6000;
const MAX_SCOPE_LENGTH = 100;
const MAX_PATH_LENGTH = 500;
const STATIC_CACHE_NAME = "hcca-static-v5";
const CHUNK_RELOAD_KEY = "hcca:chunk-reload-at";
const CHUNK_RELOAD_COOLDOWN_MS = 30_000;

const IGNORED_RESOURCE_HOSTS = new Set([
  "static.cloudflareinsights.com",
  "server.arcgisonline.com",
]);
const IGNORED_RESOURCE_PATHS = new Set([
  "/brand/hcca-emblem-64.avif",
  "/brand/hcca-emblem-64.webp",
]);

export interface ClientErrorInput {
  message: string;
  stack?: string;
  scope?: string;
  pathname?: string;
  dedupeKey?: string;
}

export interface ClientErrorReceipt {
  error_id: string;
  request_id: string;
  trace_id: string;
}

function limit(value: string | undefined, length: number): string {
  return (value ?? "").slice(0, length);
}

const recentReports = new Map<string, number>();

type BrowserConnection = { effectiveType?: string; type?: string };

function referrerPath(): string | undefined {
  if (!document.referrer) return undefined;
  try {
    const referrer = new URL(document.referrer);
    return referrer.origin === window.location.origin ? referrer.pathname : referrer.origin;
  } catch {
    return undefined;
  }
}

function diagnosticContext(): Record<string, string | boolean> {
  const navigatorWithConnection = navigator as Navigator & { connection?: BrowserConnection };
  const release = process.env.NEXT_PUBLIC_APP_RELEASE
    || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
    || process.env.NEXT_PUBLIC_APP_VERSION;
  return {
    ...(release ? { release: release.slice(0, 128) } : {}),
    language: navigator.language.slice(0, 32),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone.slice(0, 100),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    ...(navigatorWithConnection.connection?.effectiveType || navigatorWithConnection.connection?.type
      ? { connection_type: navigatorWithConnection.connection.effectiveType || navigatorWithConnection.connection.type || "unknown" }
      : {}),
    ...(referrerPath() ? { referrer_path: referrerPath()! } : {}),
    online: navigator.onLine,
    visibility_state: document.visibilityState,
  };
}

function csrfHeader(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const token = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("csrf_token="))
    ?.slice("csrf_token=".length);
  return token ? { "X-CSRF-Token": decodeURIComponent(token) } : {};
}

/** 將瀏覽器錯誤送到後端；回報失敗絕不能再製造一個未處理 rejection。 */
export function reportClientError(input: ClientErrorInput): Promise<ClientErrorReceipt | null> {
  if (typeof window === "undefined") return Promise.resolve(null);

  const fingerprint = `${input.dedupeKey ?? input.message}|${input.pathname ?? window.location.pathname}`;
  const lastReportedAt = recentReports.get(fingerprint) ?? 0;
  if (Date.now() - lastReportedAt < 30_000) return Promise.resolve(null);
  recentReports.set(fingerprint, Date.now());
  for (const [key, timestamp] of recentReports) {
    if (Date.now() - timestamp >= 30_000) recentReports.delete(key);
  }

  recordClientMetric({
    metric: "client_error",
    value: 1,
    path: input.pathname ?? window.location.pathname,
    interaction_name: (input.scope || "runtime").slice(0, 120),
  });

  const payload = JSON.stringify({
    message: limit(input.message || "Unknown client error", MAX_MESSAGE_LENGTH),
    stack: limit(input.stack, MAX_STACK_LENGTH),
    scope: limit(input.scope || "runtime", MAX_SCOPE_LENGTH),
    pathname: limit(input.pathname || window.location.pathname, MAX_PATH_LENGTH),
    context: diagnosticContext(),
  });

  return fetch(apiUrl("/system/client-errors"), {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: {
      "content-type": "application/json",
      ...csrfHeader(),
    },
    body: payload,
  })
    .then(async (response) => {
      if (!response.ok) return null;
      const receipt = (await response.json()) as Partial<ClientErrorReceipt>;
      if (typeof receipt.error_id !== "string") return null;
      return {
        error_id: receipt.error_id,
        request_id: typeof receipt.request_id === "string" ? receipt.request_id : "",
        trace_id: typeof receipt.trace_id === "string" ? receipt.trace_id : "",
      };
    })
    .catch(() => null);
}

function errorDetails(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) {
    return { message: value.message || value.name, stack: value.stack };
  }
  if (typeof value === "string") return { message: value };
  try {
    return { message: JSON.stringify(value) };
  } catch {
    return { message: String(value) };
  }
}

function resourceUrl(target: Element): string | null {
  if (target instanceof HTMLImageElement) return target.currentSrc || target.src || null;
  if (target instanceof HTMLScriptElement) return target.src || null;
  if (target instanceof HTMLLinkElement) return target.href || null;
  return target.getAttribute("src") || target.getAttribute("href");
}

function isIgnoredResource(url: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url, window.location.href);
    return IGNORED_RESOURCE_HOSTS.has(parsed.hostname)
      || IGNORED_RESOURCE_PATHS.has(parsed.pathname);
  } catch {
    return false;
  }
}

function isNextChunk(url: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.origin === window.location.origin
      && parsed.pathname.startsWith("/_next/static/chunks/");
  } catch {
    return false;
  }
}

function recoverFromChunkFailure(url: string | null): void {
  if (!isNextChunk(url)) return;

  try {
    const previousReloadAt = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0);
    if (previousReloadAt && Date.now() - previousReloadAt <= CHUNK_RELOAD_COOLDOWN_MS) return;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));

    const reload = () => window.location.reload();
    if (!("caches" in window)) {
      reload();
      return;
    }
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_STATIC_CACHE" });
    void window.caches
      .delete(STATIC_CACHE_NAME)
      .catch(() => undefined)
      .finally(() => window.setTimeout(reload, 50));
  } catch {
    // Storage or Cache Storage may be blocked by private browsing modes.
    window.location.reload();
  }
}

function isIgnoredWindowError(message: string): boolean {
  return /Error invoking postMessage:\s*Java object is gone/i.test(message);
}

/** 安裝 window error / unhandledrejection 入口，涵蓋未經 React boundary 的錯誤。 */
export function installGlobalClientErrorReporter(): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onError = (event: ErrorEvent) => {
    const target = event.target;
    const details = errorDetails(event.error ?? event.message);
    const resource = target instanceof Element;
    const failedResource = resource ? resourceUrl(target) : null;
    if (isIgnoredWindowError(details.message) || isIgnoredResource(failedResource)) return;
    if (resource && target instanceof HTMLScriptElement) recoverFromChunkFailure(failedResource);
    reportClientError({
      ...details,
      message: resource
        ? `${details.message || "資源載入失敗"}${failedResource ? ` [${failedResource}]` : ""}`
        : details.message,
      scope: resource ? `resource:${target.tagName.toLowerCase()}` : "window.error",
    });
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const details = errorDetails(event.reason);
    reportClientError({ ...details, scope: "unhandledrejection" });
  };
  const onSecurityPolicyViolation = (event: SecurityPolicyViolationEvent) => {
    reportClientError({
      message: `CSP blocked ${event.effectiveDirective || "resource"}: ${event.blockedURI || "unknown"}`,
      scope: "securitypolicyviolation",
      dedupeKey: `${event.effectiveDirective}:${event.blockedURI}`,
    });
  };

  window.addEventListener("error", onError, true);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  window.addEventListener("securitypolicyviolation", onSecurityPolicyViolation);
  return () => {
    window.removeEventListener("error", onError, true);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
    window.removeEventListener("securitypolicyviolation", onSecurityPolicyViolation);
  };
}
