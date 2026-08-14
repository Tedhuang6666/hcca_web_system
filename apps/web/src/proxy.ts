import { NextRequest, NextResponse } from "next/server";
import {
  isIndexablePublicPath,
  isMaintenanceExempt,
} from "@/lib/route-access";

const API_INTERNAL_BASE =
  process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const MAINTENANCE_CHECK_TIMEOUT_MS = 450;
const MAINTENANCE_BYPASS_TIMEOUT_MS = 300;
const PUBLIC_CONTENT_LAST_MODIFIED_TIMEOUT_MS = 800;

// 模組級快取：在同一 edge worker 實例內跨 request 共用，避免每次換頁都打 API。
// 鍵值：maintenance 用 "global"，access-status 用 IP，bypass 用 cookie 前 64 字元。
interface CacheEntry<T> {
  value: T;
  ts: number;
}
const CACHE_TTL_MS = 30_000;

class BoundedTtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(private readonly maxEntries: number) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
      this.entries.delete(key);
      return undefined;
    }
    // Map insertion order is used as a small LRU queue.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    const now = Date.now();
    for (const [entryKey, entry] of this.entries) {
      if (now - entry.ts > CACHE_TTL_MS) this.entries.delete(entryKey);
    }
    this.entries.delete(key);
    this.entries.set(key, { value, ts: now });
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }
}

type MaintenanceState = { enabled: false } | { enabled: true; message?: string; until?: number | null };
type AccessState = { blocked: false } | { blocked: true; reason?: string; expires_at?: number | null };

const maintenanceCache = new BoundedTtlCache<MaintenanceState>(4);
const accessStatusCache = new BoundedTtlCache<AccessState>(2_048);
const bypassCache = new BoundedTtlCache<boolean>(2_048);
const publicContentLastModifiedCache = new BoundedTtlCache<Date | null>(2_048);

/**
 * 識別中文公文字號格式，例如：
 *   嶺代議字1150000001號   （無「第」、無空格）
 *   嶺代生字第1150000001號
 * 規則：至少含有一個中文字 + 「字」 + 「第」（可選）+ 數字 + 「號」
 */
const SERIAL_RE = /^[一-鿿]+字(?:第)?(\d+)號$/;
/** 產生 per-request CSP nonce（Edge runtime：用 Web Crypto，不可用 Buffer）。 */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * 前端 HTML 的 Content-Security-Policy。
 *
 * script-src 採 nonce + 'strict-dynamic'，不含 'unsafe-inline'：
 *   - Next.js 會自動把此 nonce 套到框架腳本與 <Script> 元件（含 Google One Tap）。
 *   - 'strict-dynamic' 讓已信任（帶 nonce）的腳本可載入其子腳本（GSI、PostHog 錄製）。
 *   - 明列的 https 來源是給支援 nonce 但不支援 strict-dynamic 的舊瀏覽器的後備。
 *   - script-src-elem 允許同源 Next.js 動態 chunk；Next.js 某些 client dynamic
 *     preload 會沒有 nonce，但 inline script 仍由 script-src 的 nonce 保護。
 * React 行內 style attribute 透過 style-src-attr 明確隔離；script/style element
 * 仍要求 nonce，避免公開頁回退到 unsafe-inline。
 */
function webSocketSources(): string[] {
  const sources = new Set<string>();
  if (process.env.NODE_ENV !== "production") {
    sources.add("ws://localhost:8000");
    sources.add("wss://localhost:8000");
  }
  const configuredWsUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (configuredWsUrl) {
    try {
      const parsed = new URL(configuredWsUrl.replace(/^http/, "ws"));
      if (process.env.NODE_ENV === "production" && ["localhost", "127.0.0.1"].includes(parsed.hostname)) {
        return [...sources];
      }
      sources.add(`${parsed.protocol}//${parsed.host}`);
    } catch {
      // 無效的公開 WebSocket URL 由前端設定檢查處理，不讓 CSP 建立失敗。
    }
  }
  return [...sources];
}

function postHogSources(): string[] {
  const sources = new Set([
    "https://us.i.posthog.com",
    "https://us-assets.i.posthog.com",
  ]);
  const configuredPostHogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (configuredPostHogHost) {
    try {
      sources.add(new URL(configuredPostHogHost).origin);
    } catch {
      // 無效的 PostHog endpoint 不應讓整份 CSP 建立失敗。
    }
  }
  return [...sources];
}

function buildCsp(nonce: string): string {
  // 開發模式 Next.js Fast Refresh (HMR) 需要 eval；正式環境不含 'unsafe-eval'。
  const devEval = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";
  // Turbopack 開發模式會注入無 nonce 的 <style>；正式環境仍要求 nonce。
  const styleNonce = process.env.NODE_ENV === "production" ? ` 'nonce-${nonce}'` : "";
  // Turbopack 在開發模式會以 <style> 注入 HMR CSS；正式環境仍只接受 nonce。
  const devStyle = process.env.NODE_ENV === "production" ? "" : " 'unsafe-inline'";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://accounts.google.com https://us-assets.i.posthog.com https://static.cloudflareinsights.com${devEval}`,
    `script-src-elem 'self' 'nonce-${nonce}' https://accounts.google.com https://us-assets.i.posthog.com https://static.cloudflareinsights.com`,
    `style-src 'self'${styleNonce}${devStyle} https://fonts.googleapis.com https://accounts.google.com`,
    `style-src-elem 'self'${styleNonce}${devStyle} https://fonts.googleapis.com https://accounts.google.com`,
    "style-src-attr 'unsafe-inline'",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://*.googleusercontent.com https://hcca.buckets.hct.works",
    `connect-src 'self' ${webSocketSources().join(" ")} https://accounts.google.com ${postHogSources().join(" ")} https://cdn.jsdelivr.net https://fonts.googleapis.com https://static.cloudflareinsights.com`,
    "frame-src 'self' https://accounts.google.com",
    "worker-src 'self' blob:",
    "manifest-src 'self' https://hcca.tw https://www.hcca.tw",
  ].join("; ");
}

/**
 * 套用 CSP：把 nonce 經 x-nonce 與請求端 CSP 標頭傳給 Next（讓框架腳本帶 nonce），
 * 同時把 CSP 寫到回應標頭交給瀏覽器強制執行。
 */
function withCsp(req: NextRequest): NextResponse {
  const nonce = generateNonce();
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("content-security-policy", csp);
  return res;
}

function cacheKey(value: string): string {
  // Do not retain raw cookies or IP addresses in a long-lived worker heap.
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16);
}

function decodePathPart(value: string) {
  let current = value;
  for (let index = 0; index < 2; index += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
}

async function canBypassMaintenance(req: NextRequest) {
  const cookieKey = cacheKey(req.headers.get("cookie") ?? "anonymous");
  const cached = bypassCache.get(cookieKey);
  if (cached !== undefined) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAINTENANCE_BYPASS_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_INTERNAL_BASE}/auth/me`, {
      headers: { cookie: req.headers.get("cookie") ?? "" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) { bypassCache.set(cookieKey, false); return false; }
    const me = (await res.json()) as {
      is_superuser?: boolean;
      is_owner?: boolean;
      permissions?: string[];
    };
    const permissions = new Set(me.permissions ?? []);
    const result = Boolean(
      me.is_superuser
      || me.is_owner
      || permissions.has("admin:all")
      || permissions.has("system:maintenance_bypass"),
    );
    bypassCache.set(cookieKey, result);
    return result;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function maintenanceRedirect(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isMaintenanceExempt(pathname)) return null;

  let state = maintenanceCache.get("global");
  if (!state) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MAINTENANCE_CHECK_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_INTERNAL_BASE}/system/maintenance`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const raw = (await res.json()) as { enabled?: boolean; message?: string; until?: number | null };
      state = raw.enabled
        ? { enabled: true, message: raw.message, until: raw.until }
        : { enabled: false };
      maintenanceCache.set("global", state);
    } catch {
      // fail-open：API 不可達時放行。維護模式需要 API 運作才有意義；
      // API 整體掛掉時不應連帶讓前端對所有人回傳 503。
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (!state.enabled || await canBypassMaintenance(req)) return null;

  const url = req.nextUrl.clone();
  url.pathname = "/maintenance";
  url.search = "";
  url.searchParams.set("kind", "maintenance");
  url.searchParams.set("retry", "60");
  if (state.message) url.searchParams.set("detail", state.message);
  if (state.until) url.searchParams.set("until", String(state.until));
  const response = NextResponse.redirect(url);
  response.headers.set("Retry-After", "60");
  return response;
}

async function blockedRedirect(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/blocked" || pathname.startsWith("/blocked/")) return null;

  const ip = req.headers.get("cf-connecting-ip")
    ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? req.headers.get("x-real-ip")
    ?? "local";

  const ipKey = cacheKey(ip);
  let state = accessStatusCache.get(ipKey);
  if (!state) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MAINTENANCE_CHECK_TIMEOUT_MS);
    try {
      const fetchHeaders: Record<string, string> = {
        cookie: req.headers.get("cookie") ?? "",
      };
      for (const name of ["cf-connecting-ip", "x-forwarded-for", "x-real-ip"]) {
        const value = req.headers.get(name);
        if (value) fetchHeaders[name] = value;
      }
      const res = await fetch(`${API_INTERNAL_BASE}/system/access-status`, {
        headers: fetchHeaders,
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const raw = (await res.json()) as { blocked?: boolean; reason?: string; expires_at?: number | null };
      state = raw.blocked
        ? { blocked: true, reason: raw.reason, expires_at: raw.expires_at }
        : { blocked: false };
      accessStatusCache.set(ipKey, state);
    } catch {
      // fail-open：API 不可達時放行。封鎖檢查依賴 API；API 整體掛掉時
      // 以 503 封鎖所有人（包含正常使用者）的代價高於放行少數被封鎖 IP。
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (!state.blocked) return null;

  const url = req.nextUrl.clone();
  url.pathname = "/blocked";
  url.search = "";
  if (state.reason) url.searchParams.set("reason", state.reason);
  if (state.expires_at) url.searchParams.set("until", String(state.expires_at));
  return NextResponse.redirect(url);
}

function publicContentApiPath(req: NextRequest): string | null {
  const segments = req.nextUrl.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) return null;

  const [section, rawId] = segments;
  if (!["announcements", "documents", "news", "regulations"].includes(section)) {
    return null;
  }

  const id = decodePathPart(rawId).trim();
  if (!id) return null;
  const apiSection = section === "news" ? "announcements" : section;
  return "/" + apiSection + "/" + encodeURIComponent(id);
}

async function publicContentLastModified(req: NextRequest): Promise<Date | null> {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  if (req.headers.get("RSC") === "1" || req.headers.get("Next-Router-Prefetch") === "1") {
    return null;
  }
  if (req.headers.get("cookie") || req.headers.get("authorization")) return null;

  const apiPath = publicContentApiPath(req);
  if (!apiPath) return null;

  const cached = publicContentLastModifiedCache.get(apiPath);
  if (cached !== undefined) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    PUBLIC_CONTENT_LAST_MODIFIED_TIMEOUT_MS,
  );
  try {
    const res = await fetch(API_INTERNAL_BASE + apiPath, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      publicContentLastModifiedCache.set(apiPath, null);
      return null;
    }

    const raw = (await res.json()) as {
      updated_at?: string | null;
      published_at?: string | null;
      created_at?: string | null;
    };
    const value = raw.updated_at ?? raw.published_at ?? raw.created_at;
    const timestamp = value ? new Date(value).getTime() : Number.NaN;
    if (!Number.isFinite(timestamp)) {
      publicContentLastModifiedCache.set(apiPath, null);
      return null;
    }

    // HTTP-date 只有秒精度；截斷毫秒避免瀏覽器拿剛收到的 header
    // 回傳 If-Modified-Since 時永遠比資料庫時間早幾毫秒。
    const lastModified = new Date(Math.floor(timestamp / 1000) * 1000);
    publicContentLastModifiedCache.set(apiPath, lastModified);
    return lastModified;
  } catch {
    // SEO header 失敗不應影響公開頁面正常回應。
    publicContentLastModifiedCache.set(apiPath, null);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function isNotModified(req: NextRequest, lastModified: Date): boolean {
  const header = req.headers.get("if-modified-since");
  if (!header) return false;
  const since = Date.parse(header);
  return Number.isFinite(since) && since >= lastModified.getTime();
}

function notModifiedResponse(lastModified: Date) {
  return new NextResponse(null, {
    status: 304,
    headers: { "Last-Modified": lastModified.toUTCString() },
  });
}

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = (forwardedHost ?? req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  if (process.env.NODE_ENV === "production" && host === "www.hcca.tw") {
    const url = req.nextUrl.clone();
    url.host = "hcca.tw";
    return NextResponse.redirect(url, 308);
  }

  // Next.js App Router 的客戶端換頁是 RSC payload request（帶 "RSC: 1" header），
  // 不代表新使用者到達網站，不需要每次都打 blocked/maintenance API。
  // 這些檢查在全頁載入（無 RSC header）時仍會執行，封鎖與維護控制不受影響。
  const isRscNav = req.headers.get("RSC") === "1";

  if (!isRscNav) {
    // 兩個 check 並行，避免串行等待
    const [blocked, redirect] = await Promise.all([
      blockedRedirect(req),
      maintenanceRedirect(req),
    ]);
    if (blocked) return blocked;
    if (redirect) return redirect;
  }

  // 注意：法規條文深度連結 /regulations/{id}/第N章/第N條 由
  // app/regulations/[id]/[...refs]/page.tsx 原生路由處理，
  // 不在此改寫——改寫會讓 client 端 useParams() 拿不到 refs。

  // 只處理一層路徑（/xxx），不匹配 /documents/... 等現有路由
  if (pathname.split("/").length === 2) {
    const segment = decodePathPart(pathname.slice(1)); // 去掉前導 /
    if (SERIAL_RE.test(segment)) {
      const url = req.nextUrl.clone();
      url.pathname = `/documents/${encodeURIComponent(segment)}`;
      return NextResponse.redirect(url);
    }
  }

  const lastModified = isRscNav ? null : await publicContentLastModified(req);
  if (lastModified && isNotModified(req, lastModified)) {
    return notModifiedResponse(lastModified);
  }

  const response = withCsp(req);
  if (!isIndexablePublicPath(pathname)) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  if (pathname === "/maintenance" || pathname.startsWith("/maintenance/")) {
    response.headers.set("Retry-After", "60");
  }
  if (lastModified) {
    response.headers.set("Last-Modified", lastModified.toUTCString());
  }
  return response;
}

export const config = {
  matcher: [
    // 排除靜態資源、_next 內部路由、API routes
    "/((?!_next/static|_next/image|favicon.ico|api/).*)",
  ],
};
