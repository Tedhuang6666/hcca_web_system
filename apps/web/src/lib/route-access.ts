const PUBLIC_PREFIXES = [
  "/about",
  "/auth",
  "/legal",
  "/links",
  "/live",
  "/login",
  "/maintenance",
  "/news",
  "/officers",
  "/pages",
  "/public",
  "/unsubscribe",
];

const PUBLIC_EXACT_PATHS = new Set([
  "/",
  "/announcements",
  "/documents",
  "/partner-map",
  "/petitions",
  "/petitions/new",
  "/profile/complete",
  "/regulations",
  "/surveys",
]);

const PUBLIC_PATTERNS = [
  /^\/announcements\/(?!new$)[^/]+$/,
  /^\/documents\/(?!new$|delegations$)[^/]+$/,
  /^\/meetings\/(?:join|screen)\/[^/]+$/,
  /^\/regulations\/(?!new(?:\/|$)|pending(?:\/|$))[^/]+(?:\/(?!edit(?:\/|$)|amendment(?:\/|$)).*)?$/,
  /^\/surveys\/(?!new$)[^/]+$/,
];

export function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.has(pathname)) return true;
  if (PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return true;
  }
  return PUBLIC_PATTERNS.some((pattern) => pattern.test(pathname));
}

export function requiresAuthentication(pathname: string): boolean {
  return !isPublicRoute(pathname);
}
