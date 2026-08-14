import { describe, expect, it } from "vitest";

import { MODULE_IDS, MODULE_MANIFEST, ROUTE_MANIFEST } from "./route-manifest";

describe("module registry", () => {
  it("exposes stable module metadata for navigation and maintenance", () => {
    expect(MODULE_IDS).toContain("documents");
    expect(MODULE_IDS).toContain("operations");
    expect(MODULE_MANIFEST.documents.routePrefixes).toContain("/documents");
    expect(MODULE_MANIFEST.documents.navigationGroup).toBe("治理事務");
  });

  it("keeps the five task-oriented navigation groups", () => {
    expect(ROUTE_MANIFEST.map((group) => group.group)).toEqual([
      "我的工作",
      "治理事務",
      "校園服務",
      "發布與營運",
      "系統管理",
      "公開內容",
    ]);
  });
});
