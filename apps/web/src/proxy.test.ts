import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import proxy from "./proxy";

describe("proxy search metadata routes", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(["/robots.txt", "/sitemap.xml"])("does not add noindex to %s", async (pathname) => {
    const request = new NextRequest(`https://hcca.tw${pathname}`, {
      headers: { RSC: "1" },
    });

    const response = await proxy(request);

    expect(response.headers.get("X-Robots-Tag")).toBeNull();
  });

  it("keeps anonymous indexable pages eligible for bfcache", async () => {
    const request = new NextRequest("https://hcca.tw/", {
      headers: { RSC: "1" },
    });

    const response = await proxy(request);

    expect(response.headers.get("Cache-Control")).toBe(
      "private, no-cache, max-age=0, must-revalidate",
    );
  });

  it("does not relax cache controls for signed-in visitors", async () => {
    const request = new NextRequest("https://hcca.tw/", {
      headers: { RSC: "1", cookie: "access_token=secret" },
    });

    const response = await proxy(request);

    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("adds browser security headers to HTML responses", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = new NextRequest("https://hcca.tw/", { headers: { RSC: "1" } });

    const response = await proxy(request);

    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("Permissions-Policy")).toContain("camera=()");
    expect(response.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
  });

  it("keeps security headers on cacheable public assets", async () => {
    const request = new NextRequest("https://hcca.tw/brand/hcca-emblem-192.png");

    const response = await proxy(request);

    expect(response.headers.get("Cache-Control")).toContain("max-age=2592000");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Permissions-Policy")).toContain("microphone=()");
  });
});
