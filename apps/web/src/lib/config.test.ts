import { describe, expect, it } from "vitest";

import { safeImageUrl, safeInternalHref, uploadUrl } from "./config";

describe("safeImageUrl", () => {
  it("allows HTTP, HTTPS, and same-origin paths", () => {
    expect(safeImageUrl("https://example.com/image.png")).toBe(
      "https://example.com/image.png",
    );
    expect(safeImageUrl("/uploads/image.png")).toBe("/uploads/image.png");
  });

  it("rejects executable and protocol-relative URLs", () => {
    expect(safeImageUrl("javascript:alert(1)")).toBe("");
    expect(safeImageUrl("//evil.example/image.png")).toBe("");
    expect(safeImageUrl("data:text/html,<script>alert(1)</script>")).toBe("");
  });

  it("sanitizes upload URLs after resolving the API prefix", () => {
    expect(uploadUrl("/uploads/image.png")).toBe("/api/uploads/image.png");
    expect(uploadUrl("javascript:alert(1)")).toBe("");
  });
});

describe("safeInternalHref", () => {
  it("keeps internal paths and rejects external navigation", () => {
    expect(safeInternalHref("/documents/123", "/analytics")).toBe("/documents/123");
    expect(safeInternalHref("javascript:alert(1)", "/analytics")).toBe("/analytics");
    expect(safeInternalHref("//evil.example", "/analytics")).toBe("/analytics");
  });
});
