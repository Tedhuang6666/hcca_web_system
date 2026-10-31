import type { Instrumentation } from "next";
import { serverApiUrl } from "./config";
import { redactShopDelegationSecrets } from "./shop-delegation-link";

const recentReports = new Map<string, number>();

function sanitize(value: string, limit: number): string {
  return value.replace(
    /(bearer\s+|(?:password|secret|token|authorization|cookie)\s*[=:]\s*)[^\s,;]+/gi,
    "$1[Filtered]",
  ).slice(0, limit);
}

/** Retain the server cause of React rendering failures even without a Sentry DSN. */
export const reportServerError: Instrumentation.onRequestError = async (error, request, context) => {
  const errorObject = typeof error === "object" && error !== null ? error : {};
  const digest = "digest" in errorObject && typeof errorObject.digest === "string"
    ? errorObject.digest.slice(0, 128) : undefined;
  if (digest?.startsWith("NEXT_REDIRECT;") || digest?.startsWith("NEXT_HTTP_ERROR_FALLBACK;")) return;
  const pathname = request.path.split(/[?#]/, 1)[0].slice(0, 500);
  if (pathname.endsWith("/system/client-errors")) return;
  const name = "name" in errorObject && typeof errorObject.name === "string"
    ? errorObject.name.slice(0, 100) : "Error";
  const message = sanitize("message" in errorObject && typeof errorObject.message === "string"
    ? errorObject.message : String(error), 1_000);
  const key = `${context.routePath}|${digest ?? message}`;
  const now = Date.now();
  if (now - (recentReports.get(key) ?? 0) < 30_000) return;
  for (const [key, seen] of recentReports) {
    if (now - seen >= 30_000) recentReports.delete(key);
  }
  if (recentReports.size >= 1_000) return;
  recentReports.set(key, now);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    await fetch(serverApiUrl("/system/client-errors"), {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(redactShopDelegationSecrets({
        scope: `server.${context.routeType}`,
        message,
        stack: sanitize("stack" in errorObject && typeof errorObject.stack === "string"
          ? errorObject.stack : "", 6_000),
        pathname,
        context: {
          release: (process.env.APP_RELEASE || process.env.NEXT_PUBLIC_BUILD_COMMIT
            || process.env.NEXT_PUBLIC_APP_RELEASE || "unknown").slice(0, 128),
          diagnostics: {
            error_name: name,
            error_digest: digest,
            request_method: request.method,
            request_path: pathname,
            route_path: context.routePath.split(/[?#]/, 1)[0].slice(0, 500),
            render_source: context.renderSource,
          },
        },
      })),
    });
  } catch {
    // Reporting must not replace the original rendering error or recurse.
  } finally {
    clearTimeout(timer);
  }
};
