import { describe, expect, it } from "vitest";

import {
  getRoutePolicy,
  isIndexablePublicPath,
  isPublicRoute,
  isSitemapRoute,
  requiresAuthentication,
} from "./route-access";

describe("route manifest", () => {
  it("keeps login outside indexing with a nonce CSP shell", () => {
    expect(getRoutePolicy("/login")).toMatchObject({
      public: true,
      requiresAuth: false,
      shell: "bare",
      indexable: false,
      sitemap: false,
      csp: "nonce",
      maintenanceExempt: true,
    });
    expect(isIndexablePublicPath("/login")).toBe(false);
    expect(isSitemapRoute("/login")).toBe(false);
  });

  it("uses a nonce CSP for every page rendered by Next.js", () => {
    expect(getRoutePolicy("/").csp).toBe("nonce");
    expect(getRoutePolicy("/announcements").csp).toBe("nonce");
    expect(getRoutePolicy("/login").csp).toBe("nonce");
    expect(getRoutePolicy("/admin").csp).toBe("nonce");
  });

  it("keeps protected and operational routes out of search", () => {
    expect(getRoutePolicy("/admin/system/maintenance")).toMatchObject({
      public: false,
      requiresAuth: true,
      maintenanceExempt: true,
    });
    expect(getRoutePolicy("/admin")).toMatchObject({
      public: false,
      requiresAuth: true,
      maintenanceExempt: true,
    });
    expect(getRoutePolicy("/admin/modules")).toMatchObject({
      public: false,
      requiresAuth: true,
      maintenanceExempt: true,
    });
    expect(isIndexablePublicPath("/documents/new")).toBe(false);
    expect(isSitemapRoute("/documents/new")).toBe(false);
    expect(requiresAuthentication("/documents/new")).toBe(true);
  });

  it("keeps public document and regulation pages inside the app shell", () => {
    expect(getRoutePolicy("/documents").shell).toBe("app");
    expect(getRoutePolicy("/documents/public-id").shell).toBe("app");
    expect(getRoutePolicy("/regulations").shell).toBe("app");
    expect(getRoutePolicy("/regulations/public-id").shell).toBe("app");
    expect(getRoutePolicy("/").shell).toBe("bare");
    expect(getRoutePolicy("/about").shell).toBe("bare");
  });

  it("keeps the现场抽獎入口 public and bare for shared tablets", () => {
    expect(getRoutePolicy("/raffle")).toMatchObject({
      public: true,
      requiresAuth: false,
      shell: "bare",
      indexable: false,
      sitemap: false,
    });
  });
});

describe("partner map route access", () => {
  it("allows a shared business detail link without login", () => {
    const paths = [
      "/partner-map/沃爾創意行銷",
      "/partner-map/%E6%B2%83%E7%88%BE%E5%89%B5%E6%84%8F%E8%A1%8C%E9%8A%B7",
    ];

    for (const path of paths) {
      expect(isPublicRoute(path)).toBe(true);
      expect(requiresAuthentication(path)).toBe(false);
    }
  });

  it("keeps the map management routes protected", () => {
    expect(isPublicRoute("/partner-map/admin")).toBe(false);
    expect(isPublicRoute("/partner-map/my-businesses")).toBe(false);
    expect(requiresAuthentication("/partner-map/admin/applications")).toBe(true);
  });
});

describe("public petition and regulation route access", () => {
  it("allows visitor petition share routes without login", () => {
    expect(isPublicRoute("/petitions/share")).toBe(true);
    expect(isPublicRoute("/petitions/CASE-2026/12345")).toBe(true);
  });

  it("keeps archived regulations protected", () => {
    expect(isPublicRoute("/regulations/archived")).toBe(false);
    expect(requiresAuthentication("/regulations/archived")).toBe(true);
  });
});
