import { describe, expect, it } from "vitest";

import type { NavigationProfileOut } from "./types";
import {
  NAV_DEF_LOGGED_OUT,
  navItemsFromEntries,
  navProfileFromApi,
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
});
