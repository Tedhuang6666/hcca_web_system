import { describe, expect, it } from "vitest";

import type { NavigationProfileOut } from "./types";
import {
  NAV_DEF_LOGGED_OUT,
  NAV_ITEMS,
  NAVIGATION_PROFILES,
  filterNavItems,
  navItemsFromEntries,
  navProfileFromApi,
  resolveNavigationProfile,
} from "./navigation";

describe("navigation visibility", () => {
  it("keeps private services out of the logged-out fallback", () => {
    const ids = navItemsFromEntries(NAV_DEF_LOGGED_OUT).map((item) => item.id);

    expect(ids).not.toContain("credential");
    expect(ids).not.toContain("publicRecommendedVendors");
    expect(ids).toContain("publicPetition");
    expect(navItemsFromEntries(NAV_DEF_LOGGED_OUT).find((item) => item.id === "publicPetition"))
      .toMatchObject({ href: "/petitions/public", label: "公開陳情" });
  });

  it("adds the electronic credential when an API profile omits it", () => {
    const profile = {
      key: "student",
      desktop_sections: [{ id: "services", heading: "校園服務", items: ["dashboard"] }],
    } as NavigationProfileOut;

    const resolved = navProfileFromApi(profile);

    expect(navItemsFromEntries(resolved.desktopSections).map((item) => item.id)).toContain("credential");
  });

  it("filters private services from the public API profile", () => {
    const profile = {
      key: "public",
      desktop_sections: [{
        id: "public",
        heading: "公開",
        items: ["credential", "recommendedVendors", "publicPetition"],
      }],
    } as NavigationProfileOut;

    const ids = navItemsFromEntries(navProfileFromApi(profile).desktopSections).map((item) => item.id);

    expect(ids).toEqual(["publicPetition"]);
  });

  it("shows校商投稿管理 to its dedicated permissions", () => {
    const defaultIds = navItemsFromEntries(NAVIGATION_PROFILES.default.desktopSections)
      .map((item) => item.id);
    const adminItem = NAV_ITEMS.find((item) => item.id === "merchandiseSubmissionsAdmin");

    expect(defaultIds).toContain("merchandiseSubmissionsAdmin");
    expect(adminItem?.perms).toEqual(expect.arrayContaining([
      "merchandise_submission:view",
      "merchandise_submission:manage",
      "merchandise_submission:review",
    ]));
    expect(resolveNavigationProfile(new Set(["merchandise_submission:manage"]), false))
      .toBe("default");
    expect(resolveNavigationProfile(new Set(["shop:manage"]), false)).toBe("default");
  });

  it("restricts governance workspaces to their managers", () => {
    const can = (code: string) => code === "governance:manage";
    const hasPrefix = () => false;

    const visibleIds = filterNavItems(NAV_ITEMS, can, hasPrefix).map((item) => item.id);

    expect(visibleIds).toContain("governanceHub");
    expect(visibleIds).not.toContain("matters");
  });

  it("resolves specialized navigation profiles without loading full navigation definitions", () => {
    expect(resolveNavigationProfile(new Set(["meal:view"]), false)).toBe("mealVendor");
    expect(resolveNavigationProfile(new Set(["partner_map:business_manage"]), false)).toBe("vendor");
    expect(resolveNavigationProfile(new Set(["class:manage"]), false)).toBe("teacher");
    expect(resolveNavigationProfile(new Set(["meal:view", "document:view_all"]), false))
      .toBe("student");
  });
});
