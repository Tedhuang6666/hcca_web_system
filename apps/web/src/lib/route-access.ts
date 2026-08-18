import { PUBLIC_ROUTE_MANIFEST } from "./route-manifest";

export type RouteShell = "bare" | "app";
export type RouteCspStrategy = "nonce";

export type RoutePolicy = {
  public: boolean;
  requiresAuth: boolean;
  shell: RouteShell;
  indexable: boolean;
  sitemap: boolean;
  csp: RouteCspStrategy;
  maintenanceExempt: boolean;
};

const PUBLIC_PREFIXES = PUBLIC_ROUTE_MANIFEST.prefixes;
const PUBLIC_EXACT_PATHS = new Set<string>([
  ...PUBLIC_ROUTE_MANIFEST.exact,
  "/blocked",
  "/contact",
  "/system-info",
]);

// 公開官網與登入流程使用自己的頁面版型；公開資料模組仍需要 AppShell，
// 讓訪客可以透過側邊欄在法規、公文等公開區域間切換。
const BARE_ROUTE_PATHS = [
  "/",
  "/about",
  "/system-info",
  "/links",
  "/news",
  "/officers",
  "/pages",
  "/login",
  "/auth",
  "/maintenance",
  "/module-status",
  "/profile/complete",
  "/public",
  "/live",
  "/unsubscribe",
  "/raffle",
];

const INDEXABLE_EXACT_PATHS = new Set([
  "/",
  "/about",
  "/contact",
  "/links",
  "/live",
  "/news",
  "/officers",
  "/pages",
  "/public",
  "/system-info",
  "/announcements",
  "/documents",
  "/legal",
  "/partner-map",
  "/petitions",
  "/petitions/public",
  "/regulations",
  "/surveys",
]);

const INDEXABLE_PREFIXES = [
  "/about/",
  "/announcements/",
  "/documents/",
  "/legal/",
  "/live/elections/",
  "/news/",
  "/officers/",
  "/pages/",
  "/partner-map/",
  "/petitions/public/",
  "/public/",
  "/regulations/",
  "/surveys/",
];

const INDEXABLE_PETITION_CASE = /^\/petitions\/[^/]+\/\d+$/;

const NON_INDEXABLE_PATHS = [
  "/auth",
  "/blocked",
  "/login",
  "/maintenance",
  "/module-status",
  "/profile/complete",
  "/unsubscribe",
  "/announcements/new",
  "/documents/delegations",
  "/documents/new",
  "/partner-map/admin",
  "/partner-map/my-businesses",
  "/petitions/new",
  "/petitions/share",
  "/regulations/archived",
  "/regulations/new",
  "/regulations/pending",
  "/surveys/new",
];

const MAINTENANCE_EXEMPT_PATHS = new Set([
  "/apple-icon.svg",
  "/favicon.ico",
  "/icon.svg",
  "/manifest.webmanifest",
  "/robots.txt",
  "/sw.js",
]);

const MAINTENANCE_EXEMPT_PREFIXES = [
  "/admin",
  "/admin/system",
  "/auth",
  "/blocked",
  "/login",
  "/maintenance",
  "/public",
];

const ROBOTS_DISALLOW_PATHS = [
  "/admin/",
  "/dashboard/",
  "/documents/new",
  "/email/",
  "/finance/",
  "/governance/",
  "/inventory/",
  "/loans/",
  "/meal/",
  "/operations/",
  "/orgs/",
  "/receivables/",
  "/settings/",
  "/shop/",
  "/tasks/",
  "/work-items/",
];

const ROBOTS_ALLOW_PATHS = [
  "/about",
  "/announcements",
  "/documents",
  "/live/elections/",
  "/news",
  "/pages",
  "/partner-map",
  "/petitions/public",
  "/public",
  "/regulations",
  "/surveys",
];

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.has(pathname)) return true;
  if (matchesPrefix(pathname, PUBLIC_PREFIXES)) return true;
  return PUBLIC_ROUTE_MANIFEST.patterns.some((pattern) => pattern.test(pathname));
}

export function requiresAuthentication(pathname: string): boolean {
  return !isPublicRoute(pathname);
}

export function isBareRoute(pathname: string): boolean {
  return BARE_ROUTE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function isIndexablePublicPath(pathname: string): boolean {
  if (!isPublicRoute(pathname) || matchesPrefix(pathname, NON_INDEXABLE_PATHS)) return false;
  if (pathname.endsWith("/edit") || pathname.endsWith("/amendment")) return false;
  return INDEXABLE_EXACT_PATHS.has(pathname)
    || INDEXABLE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    || INDEXABLE_PETITION_CASE.test(pathname);
}

export function isSitemapRoute(pathname: string): boolean {
  return isIndexablePublicPath(pathname);
}

export function isMaintenanceExempt(pathname: string): boolean {
  return MAINTENANCE_EXEMPT_PATHS.has(pathname) || matchesPrefix(pathname, MAINTENANCE_EXEMPT_PREFIXES);
}

export function robotsAllowPaths(): string[] {
  return [...ROBOTS_ALLOW_PATHS];
}

export function robotsDisallowPaths(): string[] {
  return [...ROBOTS_DISALLOW_PATHS, ...NON_INDEXABLE_PATHS];
}

export function getRoutePolicy(pathname: string): RoutePolicy {
  const publicRoute = isPublicRoute(pathname);
  const indexable = isIndexablePublicPath(pathname);
  return {
    public: publicRoute,
    requiresAuth: !publicRoute,
    shell: isBareRoute(pathname) ? "bare" : "app",
    indexable,
    sitemap: indexable,
    csp: "nonce",
    maintenanceExempt: isMaintenanceExempt(pathname),
  };
}
