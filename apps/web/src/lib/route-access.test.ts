import { describe, expect, it } from "vitest";

import { isPublicRoute, requiresAuthentication } from "./route-access";

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
