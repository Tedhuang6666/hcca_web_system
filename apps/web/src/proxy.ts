import { NextRequest, NextResponse } from "next/server";

const API_INTERNAL_BASE =
  process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const MAINTENANCE_CHECK_TIMEOUT_MS = 800;

/**
 * 識別中文公文字號格式，例如：
 *   嶺代議字1150000001號   （無「第」、無空格）
 *   嶺代生字第1150000001號
 * 規則：至少含有一個中文字 + 「字」 + 「第」（可選）+ 數字 + 「號」
 */
const SERIAL_RE = /^[一-鿿]+字(?:第)?(\d+)號$/;
const MAINTENANCE_EXEMPT_PREFIXES = [
  "/maintenance",
  "/blocked",
  "/admin/system",
  "/login",
  "/auth",
  "/public",
];
const MAINTENANCE_EXEMPT_PATHS = new Set([
  "/apple-icon.svg",
  "/favicon.ico",
  "/icon.svg",
  "/manifest.webmanifest",
  "/robots.txt",
  "/sw.js",
]);

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
 * style-src 仍保留 'unsafe-inline'：React 行內樣式、站台自訂 CSS、Toaster 需要，
 *   且樣式注入風險遠低於腳本注入。
 */
function buildCsp(nonce: string): string {
  // 開發模式 Next.js Fast Refresh (HMR) 需要 eval；正式環境不含 'unsafe-eval'。
  const devEval = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://accounts.google.com https://us-assets.i.posthog.com${devEval}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://*.googleusercontent.com https://hcca.buckets.hct.works",
    "connect-src 'self' https://accounts.google.com https://us.i.posthog.com https://us-assets.i.posthog.com https://cdn.jsdelivr.net https://fonts.googleapis.com https://static.cloudflareinsights.com",
    "frame-src 'self' https://accounts.google.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
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

function isMaintenanceExempt(pathname: string) {
  return MAINTENANCE_EXEMPT_PATHS.has(pathname)
    || MAINTENANCE_EXEMPT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAINTENANCE_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_INTERNAL_BASE}/auth/me`, {
      headers: { cookie: req.headers.get("cookie") ?? "" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const me = (await res.json()) as {
      is_superuser?: boolean;
      is_owner?: boolean;
      permissions?: string[];
    };
    const permissions = new Set(me.permissions ?? []);
    return Boolean(
      me.is_superuser
      || me.is_owner
      || permissions.has("admin:all")
      || permissions.has("system:maintenance_bypass"),
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function maintenanceRedirect(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isMaintenanceExempt(pathname)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAINTENANCE_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_INTERNAL_BASE}/system/maintenance`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const state = (await res.json()) as {
      enabled?: boolean;
      message?: string;
      until?: number | null;
    };
    if (!state.enabled || await canBypassMaintenance(req)) return null;

    const url = req.nextUrl.clone();
    url.pathname = "/maintenance";
    url.search = "";
    url.searchParams.set("kind", "maintenance");
    url.searchParams.set("retry", "60");
    if (state.message) url.searchParams.set("detail", state.message);
    if (state.until) url.searchParams.set("until", String(state.until));
    return NextResponse.redirect(url);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function blockedRedirect(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/blocked" || pathname.startsWith("/blocked/")) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAINTENANCE_CHECK_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      cookie: req.headers.get("cookie") ?? "",
    };
    for (const name of ["cf-connecting-ip", "x-forwarded-for", "x-real-ip"]) {
      const value = req.headers.get(name);
      if (value) headers[name] = value;
    }
    const res = await fetch(`${API_INTERNAL_BASE}/system/access-status`, {
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const state = (await res.json()) as {
      blocked?: boolean;
      reason?: string;
      expires_at?: number | null;
    };
    if (!state.blocked) return null;

    const url = req.nextUrl.clone();
    url.pathname = "/blocked";
    url.search = "";
    if (state.reason) url.searchParams.set("reason", state.reason);
    if (state.expires_at) url.searchParams.set("until", String(state.expires_at));
    return NextResponse.redirect(url);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const blocked = await blockedRedirect(req);
  if (blocked) return blocked;
  const redirect = await maintenanceRedirect(req);
  if (redirect) return redirect;

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

  return withCsp(req);
}

export const config = {
  matcher: [
    // 排除靜態資源、_next 內部路由、API routes
    "/((?!_next/static|_next/image|favicon.ico|api/).*)",
  ],
};
