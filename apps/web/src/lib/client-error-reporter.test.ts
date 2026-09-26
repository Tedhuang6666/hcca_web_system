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
