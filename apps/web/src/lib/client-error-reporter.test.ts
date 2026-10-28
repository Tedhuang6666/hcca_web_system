import { describe, expect, it, vi } from "vitest";

import { installGlobalClientErrorReporter, reportClientError } from "./client-error-reporter";

describe("client error reporter", () => {
  it("records exact resource paths and browser timing without retaining URL queries", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("performance", { getEntriesByName: vi.fn().mockReturnValue([{
      responseStatus: 404, duration: 125, transferSize: 380, encodedBodySize: 80,
      nextHopProtocol: "h2",
    }]) });
    const uninstall = installGlobalClientErrorReporter();
    const img = document.createElement("img");
    img.src = "/shop/104/evidence-01.webp?token=private#section";
    document.body.append(img);
    try {
      img.dispatchEvent(new Event("error"));
      const payload = JSON.parse(String(fetchMock.mock.calls[0][1].body));
      expect(payload.context.diagnostics).toEqual(expect.objectContaining({
        resource_path: "/shop/104/evidence-01.webp", resource_status: 404,
        resource_duration_ms: 125, resource_timing_available: true,
        resource_transfer_bytes: 380, resource_encoded_bytes: 80, resource_protocol: "h2",
      }));
      expect(JSON.stringify(payload)).not.toContain("private");
    } finally {
      uninstall(); img.remove(); vi.unstubAllGlobals();
    }
  });

  it("marks missing resource timing explicitly without inventing an HTTP status", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("performance", { getEntriesByName: vi.fn().mockReturnValue([]) });
    const uninstall = installGlobalClientErrorReporter();
    const img = document.createElement("img");
    img.src = "/shop/104/no-timing.webp";
    document.body.append(img);
    try {
      img.dispatchEvent(new Event("error"));
      const payload = JSON.parse(String(fetchMock.mock.calls[0][1].body));
      expect(payload.context.diagnostics.resource_timing_available).toBe(false);
      expect(payload.context.diagnostics.resource_status).toBeUndefined();
    } finally {
      uninstall(); img.remove(); vi.unstubAllGlobals();
    }
  });

  it("filters optional telemetry failures while preserving business requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    for (const scope of ["api.network", "api.timeout", "api.refresh-network"]) {
      await reportClientError({
        scope, message: `Optional telemetry ${scope}`,
        diagnostics: { request_method: "POST", request_path: "/analytics/page-views?source=test" },
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    await reportClientError({
      scope: "api.timeout", message: "Business request timed out",
      diagnostics: { request_method: "POST", request_path: "/shop/registrations" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the enforced CSP report without duplicating the inline style resource error", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const uninstall = installGlobalClientErrorReporter();
    const style = document.createElement("style");
    document.head.append(style);
    try {
      style.dispatchEvent(new Event("error"));
      expect(fetchMock).not.toHaveBeenCalled();
      const event = new Event("securitypolicyviolation");
      Object.defineProperties(event, {
        disposition: { value: "enforce" },
        effectiveDirective: { value: "style-src-elem" },
        blockedURI: { value: "inline" },
      });
      window.dispatchEvent(event);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).scope)
        .toBe("securitypolicyviolation");
    } finally {
      uninstall();
      style.remove();
    }
  });

  it.each([
    { scope: "api.offline", diagnostics: undefined },
    { scope: "api.network", diagnostics: { failure_kind: "offline" as const } },
    { scope: "securitypolicyviolation", diagnostics: { csp_disposition: "report" as const } },
  ])("does not send expected observations: $scope", async (input) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(reportClientError({ message: "Expected observation", ...input })).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("filters offline connection failures but still reports runtime errors and online failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      for (const scope of ["api.network", "api.timeout", "api.refresh-network", "resource:img"]) {
        await reportClientError({ scope, message: `Offline ${scope}` });
      }
      expect(fetchMock).not.toHaveBeenCalled();

      await reportClientError({ scope: "window.error", message: "Runtime error while offline" });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      online.mockReturnValue(true);
      await reportClientError({ scope: "api.network", message: "Online network failure" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      online.mockRestore();
    }
  });

  it("attributes errors to the commit supplied by the production build", async () => {
    vi.stubEnv("NEXT_PUBLIC_BUILD_COMMIT", "build-commit-for-error-report");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await reportClientError({ scope: "window.error", message: "Version attribution regression" });
      expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).context.release)
        .toBe("build-commit-for-error-report");
    } finally {
      vi.unstubAllEnvs();
    }
  });

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

  it("filters inline CSP reports created by browser extensions", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const uninstall = installGlobalClientErrorReporter();

    const event = new Event("securitypolicyviolation");
    Object.defineProperties(event, {
      disposition: { value: "enforce" },
      effectiveDirective: { value: "style-src-elem" },
      blockedURI: { value: "inline" },
      sourceFile: { value: "chrome-extension://extension-id/content.js" },
    });
    window.dispatchEvent(event);

    expect(fetchMock).not.toHaveBeenCalled();
    uninstall();
  });

  it("suppresses a Next chunk failure when cache recovery reloads the page", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const originalCaches = Object.getOwnPropertyDescriptor(window, "caches");
    Object.defineProperty(window, "caches", {
      configurable: true,
      value: { delete: vi.fn().mockResolvedValue(true) },
    });
    vi.useFakeTimers();
    sessionStorage.removeItem("hcca:chunk-reload-at");
    const uninstall = installGlobalClientErrorReporter();

    try {
      const script = document.createElement("script");
      script.src = "/_next/static/chunks/app.js";
      document.body.append(script);
      script.dispatchEvent(new Event("error"));
      await vi.advanceTimersByTimeAsync(50);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(sessionStorage.getItem("hcca:chunk-reload-at")).not.toBeNull();

      script.dispatchEvent(new Event("error"));

      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      uninstall();
      vi.useRealTimers();
      sessionStorage.removeItem("hcca:chunk-reload-at");
      if (originalCaches) {
        Object.defineProperty(window, "caches", originalCaches);
      } else {
        Reflect.deleteProperty(window, "caches");
      }
    }
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
