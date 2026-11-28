import { describe, expect, it } from "vitest";

import type { NavigationProfileOut } from "./types";
import {
  ADMIN_CATALOG,
  NAV_DEF,
  NAV_DEF_LOGGED_OUT,
  NAV_DEF_STUDENT,
  NAV_ITEMS,
  filterSidebarNavEntries,
  isSection,
  isNavItemVisible,
  navItemsFromEntries,
  navProfileFromApi,
  resolveNavigationProfile,
} from "./navigation";

describe("navigation visibility", () => {
  it("collects every management tool behind a single admin center entry", () => {
    const allIds = navItemsFromEntries(NAV_DEF).map((item) => item.id);
    const catalogIds = navItemsFromEntries(ADMIN_CATALOG).map((item) => item.id);

    const shortcutIds = ["peopleAdmin", "email", "publicSiteAdmin", "petitionsManage", "qrCode", "systemOperations"];
    expect(NAV_DEF.filter(isSection).find((section) => section.id === "admin")?.items.map((item) => item.id))
      .toEqual(["adminDashboard", ...shortcutIds]);
    expect(allIds.filter((id) => catalogIds.includes(id))).toEqual(shortcutIds);
    expect(NAV_ITEMS.some((item) => item.href === "/finance/receivables")).toBe(false);
    expect(NAV_ITEMS.some((item) => item.href === "/backoffice" || item.href === "/operations")).toBe(false);
    for (const href of [
      "/admin/feature-flags",
      "/admin/api-keys",
      "/admin/webhooks",
      "/admin/trash",
      "/admin/reports",
      "/admin/term-rollover",
      "/admin/data-lifecycle",
      "/admin/policies",
      "/admin/privacy",
      "/admin/raffle",
      "/admin/navigation-profiles",
      "/admin/gallery",
    ]) {
      expect(navItemsFromEntries(ADMIN_CATALOG).some((item) => item.href === href)).toBe(true);
    }
  });

  it("collapses management items from legacy sidebar profiles into the admin entry", () => {
    const entries = filterSidebarNavEntries([
      {
        id: "legacy-management",
        heading: "管理工作",
        items: NAV_ITEMS.filter((item) => ["shopAdmin", "policies", "finance", "dashboard"].includes(item.id)),
      },
    ]);

    expect(navItemsFromEntries(entries).map((item) => item.id)).toEqual([
      "dashboard",
      "adminDashboard",
      "peopleAdmin",
      "email",
      "publicSiteAdmin",
      "petitionsManage",
      "qrCode",
      "systemOperations",
    ]);
    expect(filterSidebarNavEntries(NAV_DEF)).toEqual(NAV_DEF);
    // 後台視角只列管理中心時，常用工具一樣出現在側欄，且不重複
    const apiEntries = filterSidebarNavEntries([
      { id: "main", heading: "主要", items: NAV_ITEMS.filter((item) => ["dashboard", "adminDashboard", "email"].includes(item.id)) },
    ]);
    const apiIds = navItemsFromEntries(apiEntries).map((item) => item.id);
    expect(apiIds.filter((id) => id === "email")).toHaveLength(1);
    expect(apiIds).toContain("systemOperations");
  });

  it("shows the admin center only to people holding at least one management tool", () => {
    const adminItem = NAV_ITEMS.find((item) => item.id === "adminDashboard")!;
    const visibilityFor = (codes: string[]) => ({
      can: (code: string) => codes.includes(code),
      hasPrefix: (prefix: string) => codes.some((code) => code.startsWith(prefix)),
      isAdmin: false,
    });

    expect(isNavItemVisible(adminItem, visibilityFor([]))).toBe(false);
    expect(isNavItemVisible(adminItem, visibilityFor(["survey:create"]))).toBe(false);
    expect(isNavItemVisible(adminItem, visibilityFor(["merchandise_submission:review"]))).toBe(true);
    expect(isNavItemVisible(adminItem, { can: () => true, hasPrefix: () => true, isAdmin: true })).toBe(true);
    expect(isNavItemVisible(adminItem, {
      ...visibilityFor(["election:manage"]),
      isModuleClosed: (item) => item.id === "electionsAdmin",
    })).toBe(false);
  });

  it("keeps private services out of the logged-out fallback", () => {
    const ids = navItemsFromEntries(NAV_DEF_LOGGED_OUT).map((item) => item.id);

    expect(ids).not.toContain("credential");
    expect(ids).not.toContain("publicRecommendedVendors");
    expect(ids).toContain("publicPetition");
    expect(navItemsFromEntries(NAV_DEF_LOGGED_OUT).find((item) => item.id === "publicPetition"))
      .toMatchObject({ href: "/petitions/public", label: "公開陳情" });
  });

  it("shows the petition center in the student navigation profile", () => {
    const studentItems = navItemsFromEntries(NAV_DEF_STUDENT);
    expect(studentItems.find((item) => item.id === "petitions")).toMatchObject({
      href: "/petitions",
      label: "陳情中心",
    });

    const profile = {
      key: "student",
      desktop_sections: [{ id: "student-main", heading: "我的校園服務", items: ["dashboard"] }],
    } as NavigationProfileOut;
    const resolved = navProfileFromApi(profile);

    expect(navItemsFromEntries(resolved.desktopSections).map((item) => item.id)).toContain("petitions");

    const teacherProfile = navProfileFromApi({
      key: "teacher",
      desktop_sections: [{ id: "teacher-main", heading: "教職員", items: ["dashboard"] }],
    } as NavigationProfileOut);
    expect(navItemsFromEntries(teacherProfile.desktopSections).map((item) => item.id))
      .not.toContain("petitions");
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

  it("shows each management tool only to people holding its permission", () => {
    const defaultIds = navItemsFromEntries(ADMIN_CATALOG).map((item) => item.id);
    const adminItem = NAV_ITEMS.find((item) => item.id === "merchandiseSubmissionsAdmin");
    const financeItem = NAV_ITEMS.find((item) => item.id === "finance");
    const systemOperationsItem = NAV_ITEMS.find((item) => item.id === "systemOperations");
    const merchandisePermissions = new Set(["merchandise_submission:manage"]);
    const visibility = {
      can: (permission: string) => merchandisePermissions.has(permission),
      hasPrefix: (prefix: string) =>
        [...merchandisePermissions].some((permission) => permission.startsWith(prefix)),
      isAdmin: false,
    };

    expect(defaultIds).toContain("merchandiseSubmissionsAdmin");
    expect(defaultIds).not.toContain("analytics");
    expect(isNavItemVisible(adminItem!, visibility)).toBe(true);
    expect(isNavItemVisible(financeItem!, visibility)).toBe(false);
    expect(systemOperationsItem?.perm).toBe("admin:all");
    expect(NAV_ITEMS.find((item) => item.id === "performanceAnalytics")).toMatchObject({
      href: "/analytics",
      perm: "analytics:view",
    });
    expect(adminItem?.perms).toEqual(expect.arrayContaining([
      "merchandise_submission:view",
      "merchandise_submission:manage",
      "merchandise_submission:review",
    ]));
    expect(resolveNavigationProfile(new Set(["merchandise_submission:manage"]), false))
      .toBe("default");
    expect(resolveNavigationProfile(new Set(["analytics:view"]), false)).toBe("default");
    expect(resolveNavigationProfile(new Set(["shop:manage"]), false)).toBe("default");
  });

  it("groups system operations behind one workspace entry", () => {
    const defaultIds = navItemsFromEntries(ADMIN_CATALOG).map((item) => item.id);

    expect(defaultIds).toContain("systemOperations");
    expect(defaultIds).not.toContain("systemDefense");
    expect(defaultIds).not.toContain("systemDiagnostics");
    expect(defaultIds).not.toContain("systemObservability");
    expect(defaultIds).not.toContain("modulesMaintenance");
  });

  it("opens the combined short-link and QR code workspace for tool managers", () => {
    expect(NAV_ITEMS.find((item) => item.id === "qrCode")).toMatchObject({
      href: "/qr-code",
      label: "經營工具",
      perm: "qr_code:manage",
    });
  });

  it("resolves specialized navigation profiles without loading full navigation definitions", () => {
    expect(resolveNavigationProfile(new Set(["partner_map:business_manage"]), false)).toBe("vendor");
    expect(resolveNavigationProfile(new Set(["class:manage"]), false)).toBe("teacher");
    expect(resolveNavigationProfile(new Set(["document:view_all"]), false)).toBe("student");
  });
});
