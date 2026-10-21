import { describe, expect, it } from "vitest";
import { loginDestination } from "./login-destination";

describe("loginDestination", () => {
  it("returns users to the original page without requiring class confirmation", () => {
    expect(loginDestination("/shop?tab=orders#item")).toBe("/shop?tab=orders#item");
  });
  it("returns users without a requested destination to the home page", () => {
    expect(loginDestination()).toBe("/");
  });
  it("rejects external destinations and old confirmation routes", () => {
    expect(loginDestination("//example.com")).toBe("/");
    expect(loginDestination("/profile/complete?next=/shop")).toBe("/");
    expect(loginDestination("/profile/complete/")).toBe("/");
    expect(loginDestination("/profile/../profile/complete")).toBe("/");
    expect(loginDestination("/dashboard")).toBe("/dashboard");
  });
});
