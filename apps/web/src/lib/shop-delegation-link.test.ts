import { beforeEach, describe, expect, it, vi } from "vitest";
import { readShopDelegationToken, redactShopDelegationSecrets, shopDelegationLoginNext } from "./shop-delegation-link";

beforeEach(() => window.history.replaceState({}, "", "/shop"));

describe("代訂連結的登入接續", () => {
  it("carries the secret through tab storage and never puts it into next", () => {
    expect(shopDelegationLoginNext("synthetic-test-token")).toBe("/shop?delegation=resume");
    window.history.replaceState({}, "", "/shop?delegation=resume");
    expect(readShopDelegationToken()).toBe("synthetic-test-token");
    expect(window.location.hash).toBe("#delegate=synthetic-test-token");
    expect(window.location.search).toBe("");
    expect(sessionStorage.length).toBe(0);
  });

  it("rejects a missing resume secret instead of returning the user's own order", () => {
    window.history.replaceState({}, "", "/shop?delegation=resume");
    expect(readShopDelegationToken()).toBe("invalid");
  });

  it("takes an explicitly shared link before an old pending login", () => {
    shopDelegationLoginNext("old-token");
    window.history.replaceState({}, "", "/shop#delegate=new-token");
    expect(readShopDelegationToken()).toBe("new-token");
    expect(sessionStorage.length).toBe(0);
  });

  it("does not adopt pending credentials on the ordinary shop page", () => {
    shopDelegationLoginNext("old-token");
    expect(readShopDelegationToken()).toBe(null);
  });

  it("keeps the resume error flow when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(shopDelegationLoginNext("token")).toBe("/shop?delegation=resume");
    window.history.replaceState({}, "", "/shop?delegation=resume");
    expect(readShopDelegationToken()).toBe("invalid");
  });
});

describe("代訂密鑰追蹤遮蔽", () => {
  it("redacts navigation, request URLs, spans and encoded next URLs", () => {
    const event = { request: { url: "https://example.test/shop#delegate=secret" },
      breadcrumbs: [{ data: { to: "/shop#delegate=secret", from: "/login?next=%2Fshop%23delegate%3Dsecret" } }],
      spans: [{ data: { url: "/shop#delegate=secret" } }], unrelated: "original", count: 1 };
    const result = redactShopDelegationSecrets(event);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result.request.url).toBe("https://example.test/shop#delegate=[redacted]");
    expect(result.unrelated).toBe("original");
    expect(result.count).toBe(1);
    expect(event.request.url).toContain("secret");
  });

  it("handles circular event metadata", () => {
    const event: { url: string; self?: unknown } = { url: "/shop#delegate=secret" };
    event.self = event;
    const result = redactShopDelegationSecrets(event);
    expect(result.self).toBe(result);
    expect(result.url).not.toContain("secret");
  });
});
