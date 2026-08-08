import { describe, expect, it, vi } from "vitest";

import { announcementsApi } from "./announcements";

describe("announcement API", () => {
  it("deduplicates the urgent announcement request shared by shell banners", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("null", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([announcementsApi.activeUrgent(), announcementsApi.activeUrgent()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
