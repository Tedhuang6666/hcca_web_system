import { describe, expect, it } from "vitest";

import { stripUrlSecrets } from "./TelemetryProvider";

describe("stripUrlSecrets", () => {
  it("removes query strings and fragments that may carry tokens", () => {
    expect(stripUrlSecrets("https://hcca.tw/unsubscribe?token=abc")).toBe("https://hcca.tw/unsubscribe");
    expect(stripUrlSecrets("https://hcca.tw/shop#delegate=secret")).toBe("https://hcca.tw/shop");
    expect(stripUrlSecrets("/search?q=王小明&page=2")).toBe("/search");
  });

  it("keeps plain paths unchanged", () => {
    expect(stripUrlSecrets("https://hcca.tw/documents/123")).toBe("https://hcca.tw/documents/123");
  });
});
