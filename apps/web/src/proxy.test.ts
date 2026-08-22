import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import proxy from "./proxy";

describe("proxy search metadata routes", () => {
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
});
