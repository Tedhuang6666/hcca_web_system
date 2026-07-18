import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { cacheCurrentUser } from "@/lib/auth-cache";
import { usePermissions } from "./usePermissions";

describe("usePermissions", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("supports direct and compatibility permissions", () => {
    sessionStorage.setItem(
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
    sessionStorage.setItem("is_owner", "true");

    const { result } = renderHook(() => usePermissions());

    expect(result.current.isOwner).toBe(true);
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.canAny("anything:at-all")).toBe(true);
  });

  it("ignores malformed cached permission JSON", () => {
    sessionStorage.setItem("permissions", "{broken");

    const { result } = renderHook(() => usePermissions());

    expect(result.current.permissions.size).toBe(0);
    expect(result.current.can("document:create")).toBe(false);
  });

  it("refreshes after the current user cache is updated", () => {
    const { result } = renderHook(() => usePermissions());

    act(() => {
      cacheCurrentUser({ id: "admin-1", is_superuser: true });
    });

    expect(result.current.isAdmin).toBe(true);
    expect(result.current.can("anything:at-all")).toBe(true);
  });
});
