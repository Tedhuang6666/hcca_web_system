import { describe, expect, it } from "vitest";

import { PUBLIC_HOME_CRUMB, getBreadcrumbs, getPageTitle } from "./breadcrumb";

describe("breadcrumbs", () => {
  it("starts signed-in pages from the platform home instead of the public site", () => {
    expect(getBreadcrumbs("/documents/new")).toEqual([
      { label: "平台首頁", href: "/dashboard" },
      { label: "公文系統", href: "/documents" },
      { label: "新增公文", href: undefined },
    ]);
    expect(getBreadcrumbs("/dashboard")).toEqual([{ label: "平台首頁" }]);
  });

  it("uses the public home as the root for visitors", () => {
    expect(getBreadcrumbs("/regulations", PUBLIC_HOME_CRUMB)[0]).toEqual({ label: "首頁", href: "/" });
  });

  it("names every navigable page in Chinese rather than echoing the URL", () => {
    const paths = [
      "/work-items", "/backoffice", "/council-proposals", "/judicial-petitions", "/credential",
      "/exam-papers/admin", "/finance", "/publications", "/qr-code",
      "/recommended-vendors/admin", "/merchandise-submissions/admin", "/admin/term-rollover",
      "/admin/public-site", "/settings/privacy", "/email/lists", "/shop/cart",
    ];
    for (const path of paths) {
      expect(getPageTitle(path), path).toMatch(/[一-鿿]/);
    }
  });
});
