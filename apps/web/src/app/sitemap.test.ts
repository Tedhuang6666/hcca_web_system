import { describe, expect, it, vi } from "vitest";

import sitemap from "./sitemap";

describe("sitemap", () => {
  it("deduplicates entries with the same canonical URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input));
        let body: unknown = [];

        if (url.pathname.endsWith("/site/public")) {
          body = { settings: { updated_at: "2026-08-22T00:00:00+08:00", theme_config: {} }, links: [] };
        } else if (url.pathname.endsWith("/regulations")) {
          body = [
            { id: "first", title: "重複法規", updated_at: "2026-08-20T00:00:00+08:00" },
            { id: "second", title: "重複法規", updated_at: "2026-08-21T00:00:00+08:00" },
          ];
        }

        return Promise.resolve(new Response(JSON.stringify(body)));
      }),
    );

    const entries = await sitemap();
    const regulationUrl = `https://hcca.tw/regulations/${encodeURIComponent("重複法規")}`;

    expect(entries.filter((entry) => entry.url === regulationUrl)).toHaveLength(1);
  });
});
