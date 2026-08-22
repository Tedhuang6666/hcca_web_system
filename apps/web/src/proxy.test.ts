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
});
