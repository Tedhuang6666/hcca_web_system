import { API_BASE } from "../config";
import { getImpersonationSession } from "../auth-cache";
import { reportClientError } from "../client-error-reporter";

export type HccaRequestInit = RequestInit & { skipImpersonation?: boolean };

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

export function createTraceId(): string {
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
  return (Date.now().toString(16) + Math.random().toString(16).slice(2)).slice(-16).padStart(16, "0");
}

export function traceHeaders(): { traceId: string; headers: Record<string, string> } {
  const traceId = createTraceId();
  return {
    traceId,
    headers: {
      "X-Trace-ID": traceId,
      traceparent: `00-${traceId}-${createSpanId()}-01`,
    },
  };
}

export function requestInitWithTrace(init: HccaRequestInit, trace: Record<string, string>): RequestInit {
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
      ...trace,
    },
  };
}

export class NetworkRequestError extends Error {}

export function isRequestAborted(error: unknown, signal?: AbortSignal | null): boolean {
  if (signal?.aborted) return true;
  return typeof error === "object"
    && error !== null
    && "name" in error
    && error.name === "AbortError";
}

function waitForRetry(delayMs: number, signal?: AbortSignal | null): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, delayMs));
  if (signal.aborted) return Promise.reject(signal.reason);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function fetchWithRetry(
  path: string,
  init: HccaRequestInit,
  trace: Record<string, string>,
  maxRetries: number,
): Promise<{ response: Response; attempts: number }> {
  let attempts = 0;
  while (true) {
    try {
      const response = await fetch(`${API_BASE}${path}`, requestInitWithTrace(init, trace));
      return { response, attempts };
    } catch (error) {
      // 元件卸載或路由切換造成的取消不是網路故障；不要重試、開熔斷或回報錯誤。
      if (isRequestAborted(error, init.signal)) throw error;
      if (attempts >= maxRetries) {
        const message = error instanceof Error ? error.message : `無法連線：${path}`;
        reportClientError({ scope: "api.network", message, stack: error instanceof Error ? error.stack : undefined });
        throw new NetworkRequestError(`無法連線至後端 API：${API_BASE}`);
      }
      await waitForRetry([400, 900][attempts] ?? 1500, init.signal);
      attempts += 1;
    }
  }
}

/** 供下載、上傳等需要讀取原始 Response 的呼叫沿用同一套身分標頭。 */
export function authFetch(input: RequestInfo | URL, init: HccaRequestInit = {}): Promise<Response> {
  const { skipImpersonation: _skipImpersonation, ...requestInit } = init;
  const impersonation = _skipImpersonation ? null : getImpersonationSession();
  const headers = new Headers(
    typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
  );
  new Headers(requestInit.headers).forEach((value, key) => headers.set(key, value));
  if (impersonation) headers.set("Authorization", `Bearer ${impersonation.token}`);
  return fetch(input, { credentials: "include", ...requestInit, headers });
}

export type UploadProgressHandler = (progress: number) => void;

/**
 * Upload a multipart request through XHR so callers can render byte-level progress.
 * Falls back to the shared fetch wrapper when progress reporting is not requested.
 */
export function uploadWithProgress(
  input: RequestInfo | URL,
  init: HccaRequestInit,
  onProgress?: UploadProgressHandler,
): Promise<Response> {
  if (!onProgress || typeof XMLHttpRequest === "undefined") return authFetch(input, init);

  const { skipImpersonation: _skipImpersonation, ...requestInit } = init;
  const impersonation = _skipImpersonation ? null : getImpersonationSession();
  const headers = new Headers(
    typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
  );
  new Headers(requestInit.headers).forEach((value, key) => headers.set(key, value));
  if (impersonation) headers.set("Authorization", `Bearer ${impersonation.token}`);

  const url = input instanceof URL ? input.toString() : input.toString();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(requestInit.method ?? "POST", url, true);
    xhr.withCredentials = requestInit.credentials === "omit" ? false : true;
    headers.forEach((value, key) => xhr.setRequestHeader(key, value));
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    xhr.onload = () => {
      const responseHeaders = new Headers();
      xhr.getAllResponseHeaders().trim().split(/[\r\n]+/).forEach((line) => {
        const separator = line.indexOf(":");
        if (separator > 0) responseHeaders.set(line.slice(0, separator), line.slice(separator + 1).trim());
      });
      resolve(new Response(xhr.responseText, {
        status: xhr.status,
        statusText: xhr.statusText,
        headers: responseHeaders,
      }));
    };
    xhr.onerror = () => reject(new NetworkRequestError(`無法連線至 API：${url}`));
    xhr.onabort = () => reject(new NetworkRequestError("上傳已取消"));
    xhr.send(requestInit.body as XMLHttpRequestBodyInit | null);
  });
}
