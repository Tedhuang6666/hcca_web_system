import { describe, expect, it } from "vitest";

import { planClassStatusRefresh, type ClassStatusCache } from "./shop-close-status-cache";

describe("planClassStatusRefresh", () => {
  it("loads missing classes once and ignores duplicate class IDs", () => {
    const result = planClassStatusRefresh(null, "catalog-a", ["class-a", "class-b", "class-a"], 100, 50);

    expect(result.classIdsToRefresh).toEqual(["class-a", "class-b"]);
    expect(result.byClass).toEqual({});
  });

  it("refreshes only the requested class while other cached statuses are fresh", () => {
    const cache: ClassStatusCache<string> = {
      catalogKey: "catalog-a",
      byClass: {
        "class-a": { fetchedAt: 90, statuses: "a" },
        "class-b": { fetchedAt: 90, statuses: "b" },
      },
    };

    const result = planClassStatusRefresh(
      cache,
      "catalog-a",
      ["class-a", "class-b"],
      100,
      50,
      { refreshClassId: "class-b" },
    );

    expect(result.classIdsToRefresh).toEqual(["class-b"]);
    expect(result.byClass).toEqual(cache.byClass);
  });

  it("refreshes expired statuses and resets when the catalog changes", () => {
    const cache: ClassStatusCache<string> = {
      catalogKey: "catalog-a",
      byClass: {
        "class-a": { fetchedAt: 10, statuses: "a" },
        "class-b": { fetchedAt: 90, statuses: "b" },
      },
    };

    const expired = planClassStatusRefresh(cache, "catalog-a", ["class-a", "class-b"], 100, 50);
    const changedCatalog = planClassStatusRefresh(cache, "catalog-b", ["class-a", "class-b"], 100, 50);

    expect(expired.classIdsToRefresh).toEqual(["class-a"]);
    expect(changedCatalog.classIdsToRefresh).toEqual(["class-a", "class-b"]);
    expect(changedCatalog.byClass).toEqual({});
  });

  it("refreshes every visible class when requested", () => {
    const cache: ClassStatusCache<string> = {
      catalogKey: "catalog-a",
      byClass: { "class-a": { fetchedAt: 99, statuses: "a" } },
    };

    const result = planClassStatusRefresh(
      cache,
      "catalog-a",
      ["class-a", "class-b"],
      100,
      50,
      { refreshCloseStatus: true },
    );

    expect(result.classIdsToRefresh).toEqual(["class-a", "class-b"]);
  });
});
