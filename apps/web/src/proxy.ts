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

function isMaintenanceExempt(pathname: string) {
  return MAINTENANCE_EXEMPT_PATHS.has(pathname)
    || MAINTENANCE_EXEMPT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * 內容安全政策（CSP）+ 基礎安全標頭。
 *
 * 前端頁面原本完全沒有 CSP；這裡補上 nonce-based 政策：inline <script> 必須帶當次
 * 請求的 nonce 才能執行，藉此擋下 stored / reflected XSS。樣式因 CSS-in-JS 與站台
 * custom_css 仍保留 unsafe-inline（樣式注入風險遠低於腳本，且 custom_css 已於後端清洗）。
 *
 * 上線策略：預設 `Content-Security-Policy-Report-Only`（只回報、不阻斷），確保正式站
 * 不會因政策不全而壞掉（Google 登入 / 地圖 / 內嵌影片）。各頁點過、確認 console 無
 * CSP 違規後，設環境變數 `CSP_ENFORCE=true` 即切成強制。
 */
function buildCsp(nonce: string): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://accounts.google.com https://app.posthog.com https://cdn.jsdelivr.net`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "img-src 'self' data: blob: https://*.googleusercontent.com https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://img.youtube.com https://i.ytimg.com",
    "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
    "connect-src 'self' https://*.ingest.us.sentry.io https://app.posthog.com https://accounts.google.com",
    "frame-src 'self' https://accounts.google.com https://www.youtube.com https://youtube.com https://calendar.google.com https://drive.google.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com",
    "frame-ancestors 'none'",
  ];
  if (process.env.NODE_ENV === "production") {
    directives.push("upgrade-insecure-requests");
  }
  return directives.join("; ");
}

function applySecurityHeaders(response: NextResponse, csp: string): NextResponse {
  const enforce = process.env.CSP_ENFORCE === "true";
  response.headers.set(
    enforce ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only",
    csp,
  );
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
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

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 每次請求產生一次性 nonce，組出 CSP
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  const redirect = await maintenanceRedirect(req);
  if (redirect) return applySecurityHeaders(redirect, csp);

  // 注意：法規條文深度連結 /regulations/{id}/第N章/第N條 由
  // app/regulations/[id]/[...refs]/page.tsx 原生路由處理，
  // 不在此改寫——改寫會讓 client 端 useParams() 拿不到 refs。

  // 只處理一層路徑（/xxx），不匹配 /documents/... 等現有路由
  if (pathname.split("/").length === 2) {
    const segment = decodePathPart(pathname.slice(1)); // 去掉前導 /
    if (SERIAL_RE.test(segment)) {
      const url = req.nextUrl.clone();
      url.pathname = `/documents/${encodeURIComponent(segment)}`;
      return applySecurityHeaders(NextResponse.redirect(url), csp);
    }
  }

  // 把 nonce 與 CSP 放進「請求」標頭：Next 會據此自動為框架腳本注入 nonce，
  // 我們的 inline script（ThemeScript / JsonLd）也能透過 headers() 讀到同一個 nonce。
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  return applySecurityHeaders(response, csp);
}

export const config = {
  matcher: [
    // 排除靜態資源、_next 內部路由、API routes
    "/((?!_next/static|_next/image|favicon.ico|api/).*)",
  ],
};
