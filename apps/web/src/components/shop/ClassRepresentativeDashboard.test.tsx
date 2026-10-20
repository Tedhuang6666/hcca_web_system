import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPageClient from "@/app/(protected)/dashboard/DashboardPageClient";

const state = vi.hoisted(() => ({ permissions: [] as string[] }));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isAdmin: false,
    permissions: new Set(state.permissions),
    can: (code: string) => state.permissions.includes(code),
    canAny: (...codes: string[]) => codes.some((code) => state.permissions.includes(code)),
  }),
}));
vi.mock("@/hooks/useRecentItems", () => ({ useRecentItems: () => [] }));
vi.mock("@/lib/api-cache", () => ({ cacheGet: () => undefined, cacheSet: vi.fn() }));

beforeEach(() => {
  state.permissions = [];
  localStorage.clear();
});

describe("班代儀表板入口", () => {
  it("puts class ordering in the primary action for representatives with council permissions", () => {
    state.permissions = ["class:shop_collect", "document:draft", "regulation:propose"];
    render(<DashboardPageClient initialData={null} />);
    expect(screen.getByRole("link", { name: "班代代訂與收款" })).toHaveAttribute("href", "/shop/class-orders");
  });

  it("does not offer class ordering to a student without class permissions", () => {
    render(<DashboardPageClient initialData={null} />);
    expect(screen.queryByRole("link", { name: "班代代訂與收款" })).not.toBeInTheDocument();
  });
});
