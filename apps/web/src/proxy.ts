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

  return NextResponse.next();
}

export const config = {
  matcher: [
    // 排除靜態資源、_next 內部路由、API routes
    "/((?!_next/static|_next/image|favicon.ico|api/).*)",
  ],
};
