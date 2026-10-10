import { describe, expect, it, vi } from "vitest";

import { installGlobalClientErrorReporter, reportClientError } from "./client-error-reporter";

describe("client error reporter", () => {
  it("filters known third-party, optional asset, and WebView noise", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const uninstall = installGlobalClientErrorReporter();

    const cloudflareScript = document.createElement("script");
    cloudflareScript.src = "https://static.cloudflareinsights.com/beacon.min.js";
    cloudflareScript.dispatchEvent(new Event("error"));

    const mapTile = document.createElement("img");
    mapTile.src = "https://server.arcgisonline.com/ArcGIS/rest/services/tile.png";
    mapTile.dispatchEvent(new Event("error"));

    const emblem = document.createElement("img");
    emblem.src = "/brand/hcca-emblem-64.avif";
    emblem.dispatchEvent(new Event("error"));

    window.dispatchEvent(
      new ErrorEvent("error", { message: "Error invoking postMessage: Java object is gone" }),
    );
    window.dispatchEvent(new ErrorEvent("error", { message: "Script error." }));
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "undefined is not an object (evaluating 'window.webkit.messageHandlers')",
      }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    uninstall();
  });

  it("groups cache-busted resources and RSC CSP violations without hiding the first report", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const uninstall = installGlobalClientErrorReporter();

    for (const hash of ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]) {
      const image = document.createElement("img");
      image.src = `https://hcca.tw/api/uploads/surveys/${hash}.png?signature=${hash}`;
      document.body.append(image);
      image.dispatchEvent(new Event("error"));
    }

    for (const [index, token] of ["first", "second"].entries()) {
      if (index === 1) window.history.pushState({}, "", "/dashboard");
      const event = new Event("securitypolicyviolation");
      Object.defineProperties(event, {
        effectiveDirective: { value: "connect-src" },
        blockedURI: { value: `https://hcca.tw/surveys?_rsc=${token}` },
        disposition: { value: "enforce" },
        sourceFile: { value: "https://hcca.tw/_next/static/chunks/app.js" },
        lineNumber: { value: 12 },
        columnNumber: { value: 7 },
      });
      window.dispatchEvent(event);
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const resourcePayload = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    const cspPayload = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(resourcePayload.message).toContain("%7Basset%7D.png");
    expect(resourcePayload.message).not.toContain("signature=");
    expect(resourcePayload.context.diagnostics).toMatchObject({
      failure_kind: "resource",
      resource_origin: "https://hcca.tw",
    });
    expect(cspPayload.message).toBe("CSP blocked connect-src: https://hcca.tw");
    expect(cspPayload.pathname).toBe("/");
    expect(cspPayload.context).toMatchObject({
      page_origin: window.location.origin,
      api_origin: expect.any(String),
      diagnostics: {
        failure_kind: "csp",
        csp_directive: "connect-src",
        csp_disposition: "enforce",
        csp_blocked_source: "https://hcca.tw",
        csp_source_origin: "https://hcca.tw",
        csp_line_number: 12,
        csp_column_number: 7,
      },
    });
    uninstall();
    window.history.replaceState({}, "", "/");
  });

  it("filters browser extension, optional telemetry, and abort noise", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const uninstall = installGlobalClientErrorReporter();

    for (const blockedURI of [
      "chrome-extension://extension-id/injected.js",
      "https://hcca.tw/cdn-cgi/rum?version=1",
      "https://static.cloudflareinsights.com/beacon.min.js",
    ]) {
      const event = new Event("securitypolicyviolation");
      Object.defineProperties(event, {
        disposition: { value: "enforce" },
        effectiveDirective: { value: "connect-src" },
        blockedURI: { value: blockedURI },
      });
      window.dispatchEvent(event);
    }

    const rejection = new Event("unhandledrejection");
    Object.defineProperty(rejection, "reason", {
      value: new DOMException("Request was cancelled", "AbortError"),
    });
    window.dispatchEvent(rejection);

    expect(fetchMock).not.toHaveBeenCalled();
    uninstall();
  });

  it("sends bounded browser context with each report", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error_id: "client-error-1" }), { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await reportClientError({ message: "Browser failed", pathname: "/documents" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(payload.pathname).toBe("/documents");
    expect(payload.context).toMatchObject({
      language: expect.any(String),
      viewport: expect.stringMatching(/^\d+x\d+$/),
      online: expect.any(Boolean),
      visibility_state: expect.any(String),
    });
  });
});
