export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api";

export const API_INTERNAL_BASE =
  process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function wsBase(): string {
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (configured) return configured.replace(/^http/, "ws").replace(/\/$/, "");
  if (typeof window === "undefined") return "ws://localhost:8000";

  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}`;
}

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export function serverApiUrl(path: string): string {
  return `${API_INTERNAL_BASE}${path}`;
}

/** 將後端回傳的 /uploads/... 相對路徑解析成可在瀏覽器顯示的完整 URL。 */
export function uploadUrl(url: string | null | undefined): string {
  if (!url) return "";
  return url.startsWith("/uploads/") ? `${API_BASE}${url}` : url;
}
