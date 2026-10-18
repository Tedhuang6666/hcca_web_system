import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ShopLayout from "@/app/(protected)/shop/layout";

const state = vi.hoisted(() => ({ pathname: "/shop", search: "", permissions: [] as string[] }));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ isAdmin: false, isReady: true, permissions: new Set(state.permissions) }),
}));
vi.mock("@/components/ModuleBoundary", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/layout/PageTransition", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/contexts/PublicModuleStatusContext", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/site/PublicSiteHeader", () => ({ default: () => null }));

beforeEach(() => {
  state.pathname = "/shop";
  state.search = "";
  state.permissions = [];
});

function openNavigation() {
  render(<ShopLayout><p>工作內容</p></ShopLayout>);
  const nav = within(screen.getByRole("navigation", { name: "商品工作區" }));
  const menu = nav.queryByText("收款與管理", { exact: true });
  if (menu) fireEvent.click(menu);
  return nav;
}

describe("商品工作導覽", () => {
  it("gives students the catalog and their preorders without management shortcuts", () => {
    state.search = "product=shirt";
    const nav = openNavigation();
    expect(nav.getByRole("link", { name: "商品目錄" })).toHaveAttribute("aria-current", "page");
    expect(nav.getByRole("link", { name: "我的預購" })).toHaveAttribute("href", "/shop/orders");
    expect(nav.getAllByRole("link")).toHaveLength(2);
  });

  it("shows only class collection to a representative and keeps a return to the catalog", () => {
    state.pathname = "/shop/class-orders";
    state.permissions = ["class:shop_collect"];
    const nav = openNavigation();
    expect(nav.getByRole("link", { name: "班級收款與代訂" })).toHaveAttribute("aria-current", "page");
    expect(nav.queryByRole("link", { name: "訂購統計" })).not.toBeInTheDocument();
    expect(nav.queryByRole("link", { name: "班級與議員設定" })).not.toBeInTheDocument();
    expect(nav.getByRole("link", { name: "商品目錄" })).toHaveAttribute("href", "/shop");
    expect(screen.getByText("工作內容")).toBeVisible();
  });

  it("opens statistics directly and highlights only that task", () => {
    state.pathname = "/shop/admin";
    state.search = "view=stats";
    state.permissions = ["shop:manage"];
    const nav = openNavigation();
    expect(nav.getByRole("link", { name: "訂購統計" })).toHaveAttribute("href", "/shop/admin?view=stats");
    expect(nav.getByRole("link", { name: "訂購統計" })).toHaveAttribute("aria-current", "page");
    expect(nav.getByRole("link", { name: "商品管理" })).not.toHaveAttribute("aria-current");
    expect(nav.queryByRole("link", { name: "班級與議員設定" })).not.toBeInTheDocument();
  });

  it("exposes class setup only to staff with class management permission", () => {
    state.permissions = ["class:manage"];
    const nav = openNavigation();
    expect(nav.getByRole("link", { name: "班級與議員設定" })).toHaveAttribute("href", "/admin/people?section=classes");
    expect(nav.queryByRole("link", { name: "全校收款與訂單" })).not.toBeInTheDocument();
  });
});
