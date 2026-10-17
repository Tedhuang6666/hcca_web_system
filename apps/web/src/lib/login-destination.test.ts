import { describe, expect, it } from "vitest";
import { confirmationReturnPath, loginDestination } from "./login-destination";

describe("loginDestination", () => {
  it("sends an unconfirmed student to confirmation and preserves query and fragment", () => {
    const destination = loginDestination({ requires_class_confirmation: true }, "/shop?tab=orders#item");
    const url = new URL(destination, "https://hcca.invalid");
    expect(url.pathname).toBe("/profile/complete");
    expect(url.searchParams.get("next")).toBe("/shop?tab=orders#item");
  });
  it("returns confirmed and ineligible users to the original page", () => {
    expect(loginDestination({ requires_class_confirmation: false }, "/surveys/1")).toBe("/surveys/1");
    expect(loginDestination({}, "/dashboard")).toBe("/dashboard");
  });
  it("rejects external destinations and confirmation loops", () => {
    expect(confirmationReturnPath("//example.com")).toBe("/");
    expect(confirmationReturnPath("/profile/complete?next=/shop")).toBe("/");
    expect(confirmationReturnPath("/profile/complete/")).toBe("/");
    expect(confirmationReturnPath("/profile/../profile/complete")).toBe("/");
  });
});
