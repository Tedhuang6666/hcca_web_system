import { describe, expect, it } from "vitest";

import type { NavigationProfileOut } from "./types";
import {
  NAV_DEF_LOGGED_OUT,
  navItemsFromEntries,
  navProfileFromApi,
} from "./navigation";

describe("navigation visibility", () => {
  it("keeps the electronic credential in the logged-out fallback", () => {
    expect(navItemsFromEntries(NAV_DEF_LOGGED_OUT).map((item) => item.id)).toContain("credential");
  });

  it("adds the electronic credential when an API profile omits it", () => {
    const profile = {
      key: "student",
      desktop_sections: [{ id: "services", heading: "校園服務", items: ["dashboard"] }],
    } as NavigationProfileOut;

    const resolved = navProfileFromApi(profile);

    expect(navItemsFromEntries(resolved.desktopSections).map((item) => item.id)).toContain("credential");
  });
});
