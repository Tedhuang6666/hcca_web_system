import { describe, expect, it } from "vitest";
import { csrfHeaders } from "./api/transport";
import { readCsrfToken } from "./csrf-cookie";

describe("CSRF cookie selection", () => {
  it("uses the __Host cookie in secure contexts and ignores the legacy cookie", () => {
    expect(readCsrfToken("csrf_token=legacy; __Host-csrf_token=secure", true)).toBe("secure");
    expect(readCsrfToken("csrf_token=legacy", true)).toBeNull();
  });

  it("uses the development cookie in insecure contexts", () => {
    expect(readCsrfToken("csrf_token=local", false)).toBe("local");
    expect(readCsrfToken("__Host-csrf_token=secure", false)).toBeNull();
  });

  it("builds mutation headers from the active browser cookie", () => {
    document.cookie = "csrf_token=local-token; path=/";
    expect(csrfHeaders("POST")).toEqual({ "X-CSRF-Token": "local-token" });
    expect(csrfHeaders("GET")).toEqual({});
  });
});
