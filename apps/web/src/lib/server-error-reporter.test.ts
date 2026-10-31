import type { Instrumentation } from "next";
import { describe, expect, it, vi } from "vitest";
import { reportServerError } from "./server-error-reporter";

const context: Parameters<Instrumentation.onRequestError>[2] = {
  routerKind: "App Router", routePath: "/admin/system/observability", routeType: "render",
  renderSource: "server-rendering", revalidateReason: undefined,
};

describe("server error reporter", () => {
  it("sends the original SSR cause without request cookies, queries or authorization", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const error = Object.assign(new Error("SSR failed token=private-value"), { digest: "render-cause-419" });
    const request = {
      path: "/admin/system/observability?token=private-query#private-fragment", method: "GET",
      headers: { cookie: "private-cookie", authorization: "private-authorization" },
    };
    await reportServerError(error, request, context);
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(payload.scope).toBe("server.render");
    expect(payload.pathname).toBe("/admin/system/observability");
    expect(payload.stack).toContain("SSR failed");
    expect(payload.context.diagnostics).toMatchObject({
      error_digest: "render-cause-419", render_source: "server-rendering",
      route_path: "/admin/system/observability",
    });
    expect(JSON.stringify(payload)).not.toContain("private-");
    await reportServerError(error, request, context);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps reporting failures from replacing the original error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("reporting is unavailable")));
    await expect(reportServerError(new Error("other SSR failure"), {
      path: "/dashboard", method: "GET", headers: {},
    }, { ...context, routePath: "/dashboard" })).resolves.toBeUndefined();
  });

  it("ignores framework redirects and missing-page control flow", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const digest of ["NEXT_REDIRECT;replace;/admin/system;307;", "NEXT_HTTP_ERROR_FALLBACK;404"]) {
      await reportServerError({ digest }, { path: "/old-route", method: "GET", headers: {} }, context);
    }
    await reportServerError(new Error("reporting endpoint failed"), {
      path: "/api/system/client-errors", method: "POST", headers: {},
    }, context);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
