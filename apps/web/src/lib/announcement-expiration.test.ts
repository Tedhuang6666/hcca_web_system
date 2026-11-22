import { describe, expect, it } from "vitest";

import { isAnnouncementExpired } from "./announcement-expiration";

describe("isAnnouncementExpired", () => {
  const now = Date.parse("2026-10-07T00:00:00Z");

  it("marks an urgent announcement expired after its deadline", () => {
    expect(
      isAnnouncementExpired(
        { is_published: true, is_urgent: true, urgent_until: "2026-10-06T23:59:59Z" },
        now,
      ),
    ).toBe(true);
  });

  it("keeps announcements active through their deadline", () => {
    expect(
      isAnnouncementExpired(
        { is_published: true, is_urgent: true, urgent_until: "2026-10-07T00:00:01Z" },
        now,
      ),
    ).toBe(false);
  });

  it("does not expire regular or permanent urgent announcements", () => {
    expect(
      isAnnouncementExpired(
        { is_published: true, is_urgent: false, urgent_until: "2020-01-01T00:00:00Z" },
        now,
      ),
    ).toBe(false);
    expect(
      isAnnouncementExpired({ is_published: true, is_urgent: true, urgent_until: null }, now),
    ).toBe(false);
    expect(
      isAnnouncementExpired(
        { is_published: false, is_urgent: true, urgent_until: "2020-01-01T00:00:00Z" },
        now,
      ),
    ).toBe(false);
  });
});
