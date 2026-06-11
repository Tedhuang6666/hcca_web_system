import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { usePermissions } from "./usePermissions";

describe("usePermissions", () => {
  it("supports direct and compatibility permissions", () => {
    localStorage.setItem(
      "permissions",
      JSON.stringify(["document:create", "audit:view"]),
    );

    const { result } = renderHook(() => usePermissions());

    expect(result.current.can("document:create")).toBe(true);
    expect(result.current.can("document:draft")).toBe(true);
    expect(result.current.can("audit:view_org")).toBe(true);
    expect(result.current.can("shop:manage")).toBe(false);
  });

  it("treats owners as administrators", () => {
    localStorage.setItem("is_owner", "true");

    const { result } = renderHook(() => usePermissions());

    expect(result.current.isOwner).toBe(true);
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.canAny("anything:at-all")).toBe(true);
  });

  it("ignores malformed cached permission JSON", () => {
    localStorage.setItem("permissions", "{broken");

    const { result } = renderHook(() => usePermissions());

    expect(result.current.permissions.size).toBe(0);
    expect(result.current.can("document:create")).toBe(false);
  });
});
