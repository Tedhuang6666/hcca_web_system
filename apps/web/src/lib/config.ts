import { BRANDING } from "@/lib/branding";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);
const PUBLIC_API_FALLBACK = `https://${BRANDING.domain}/api`;

function isAbsoluteHttpUrl(value: string | undefined): value is string {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isLocalUrl(value: string): boolean {
  try {
    return LOCAL_HOSTNAMES.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

const configuredInternalApi = [process.env.API_INTERNAL_URL, process.env.NEXT_PUBLIC_API_URL]
  .find(isAbsoluteHttpUrl);
const allowLocalInternalApi = process.env.NODE_ENV === "development" || process.env.CI === "true";

export const API_INTERNAL_BASE =
  configuredInternalApi && (allowLocalInternalApi || !isLocalUrl(configuredInternalApi))
    ? configuredInternalApi
    : process.env.NODE_ENV === "development"
      ? "http://localhost:8000"
      : PUBLIC_API_FALLBACK;

export function wsBase(): string {
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (configured) return configured.replace(/^http/, "ws").replace(/\/$/, "");
  if (typeof window === "undefined") return "ws://localhost:8000";

  // Next.js dev server 不會代理 WebSocket upgrade；未設定公開 WS URL 時，
  // 本機開發直接連 FastAPI。正式環境則沿用同源 reverse proxy。
  if (process.env.NODE_ENV !== "production") return "ws://localhost:8000";

  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}`;
}

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export function serverApiUrl(path: string): string {
  return `${API_INTERNAL_BASE}${path}`;
}

export function safeImageUrl(url: string | null | undefined): string {
  const value = url?.trim();
  if (!value) return "";

  if (value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

export function safeInternalHref(href: string | null | undefined, fallback = "/"): string {
  const value = href?.trim();
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }
  return value;
}

/** 將後端回傳的公開檔案相對路徑解析成可在瀏覽器顯示的 URL。 */
export function uploadUrl(url: string | null | undefined): string {
  if (!url) return "";
  const resolved =
    url.startsWith("/uploads/") ||
    url.startsWith("/merchandise-submissions/uploads/") ||
    url.startsWith("/site/public/images/")
      ? `${API_BASE}${url}`
      : url;
  return safeImageUrl(resolved);
}
