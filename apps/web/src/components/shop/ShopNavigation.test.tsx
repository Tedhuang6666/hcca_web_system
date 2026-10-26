import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ShopLayout from "@/app/(protected)/shop/layout";

const state = vi.hoisted(() => ({
  pathname: "/shop",
  search: "",
  permissions: [] as string[],
  permissionListeners: new Set<() => void>(),
}));
const auth = vi.hoisted(() => ({ refresh: vi.fn() }));
const authCache = vi.hoisted(() => ({
  cacheCurrentUser: vi.fn((user: { permissions: string[] }) => {
    state.permissions = user.permissions;
    state.permissionListeners.forEach((listener) => listener());
  }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock("@/hooks/usePermissions", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePermissions: () => {
      const permissions = useSyncExternalStore(
        (listener) => {
          state.permissionListeners.add(listener);
          return () => state.permissionListeners.delete(listener);
        },
        () => state.permissions,
        () => state.permissions,
      );
      return { isAdmin: false, isReady: true, permissions: new Set(permissions) };
    },
  };
});
vi.mock("@/lib/api/auth", () => ({ authApi: auth }));
vi.mock("@/lib/auth-cache", () => authCache);
vi.mock("@/components/ModuleBoundary", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/layout/PageTransition", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/contexts/PublicModuleStatusContext", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/site/PublicSiteHeader", () => ({ default: () => null }));

beforeEach(() => {
  state.pathname = "/shop";
  state.search = "";
  state.permissions = [];
  state.permissionListeners.clear();
  auth.refresh.mockReset();
  auth.refresh.mockImplementation(async () => ({
    id: "representative",
    permissions: [...state.permissions],
  }));
  authCache.cacheCurrentUser.mockClear();
});

function openNavigation() {
  render(<ShopLayout><p>工作內容</p></ShopLayout>);
  const nav = within(screen.getByRole("navigation", { name: "商品工作區" }));
  const menu = nav.queryByText("其他工具", { exact: true });
  if (menu) fireEvent.click(menu);
  return nav;
}

describe("商品工作導覽", () => {
  it("refreshes permissions on the public catalog so representatives can open class orders", async () => {
    auth.refresh.mockResolvedValue({
      id: "representative",
      permissions: ["class:shop_collect"],
    });

    render(<ShopLayout><p>商品</p></ShopLayout>);

    const entry = await screen.findByRole("link", { name: "班代代訂與收款" });
    expect(entry).toHaveAttribute("href", "/shop/class-orders");
    expect(authCache.cacheCurrentUser).toHaveBeenCalledWith({
      id: "representative",
      permissions: ["class:shop_collect"],
    });
  });

  it("keeps representative tools in a discoverable menu on the catalog", () => {
    state.permissions = ["class:shop_collect"];
    render(<ShopLayout><p>商品</p></ShopLayout>);
    const nav = within(screen.getByRole("navigation", { name: "商品工作區" }));
    const entry = nav.getByRole("link", { name: "班代代訂與收款" });
    expect(entry).not.toBeVisible();
    fireEvent.click(nav.getByText("其他工具", { exact: true }));
    expect(entry).toBeVisible();
    expect(entry).toHaveAttribute("href", "/shop/class-orders");
    expect(entry.closest("details")).toHaveAttribute("open");
  });

  it("gives students the catalog and their preorders without management shortcuts", () => {
    state.search = "product=shirt";
    const nav = openNavigation();
    expect(nav.getByRole("link", { name: "商品目錄" })).toHaveAttribute("aria-current", "page");
    expect(nav.getByRole("link", { name: "我的預購" })).toHaveAttribute("href", "/shop/orders");
    expect(nav.getAllByRole("link")).toHaveLength(2);
  });

  it("shows only class collection to a representative and keeps a return to the catalog", async () => {
    state.pathname = "/shop/class-orders";
    state.permissions = ["class:shop_collect"];
    const nav = openNavigation();
    expect(nav.getByRole("link", { name: "班代代訂與收款" })).toHaveAttribute("aria-current", "page");
    expect(nav.queryByRole("link", { name: "訂購統計" })).not.toBeInTheDocument();
    expect(nav.queryByRole("link", { name: "班級與議員設定" })).not.toBeInTheDocument();
    expect(nav.getByRole("link", { name: "商品目錄" })).toHaveAttribute("href", "/shop");
    expect(await screen.findByText("工作內容")).toBeVisible();
  });

  it("refreshes a stale permission snapshot before opening the class workspace", async () => {
    state.pathname = "/shop/class-orders";
    auth.refresh.mockResolvedValue({
      id: "representative",
      permissions: ["class:shop_collect"],
    });

    render(<ShopLayout><p>工作內容</p></ShopLayout>);

    expect(await screen.findByText("工作內容")).toBeVisible();
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(authCache.cacheCurrentUser).toHaveBeenCalledWith({
      id: "representative",
      permissions: ["class:shop_collect"],
    });
  });

  it("shows one product setup entry even when statistics is open", () => {
    state.pathname = "/shop/admin";
    state.search = "view=stats";
    state.permissions = ["shop:manage"];
    const nav = openNavigation();
    expect(nav.queryByRole("link", { name: "訂購統計" })).not.toBeInTheDocument();
    expect(nav.getByRole("link", { name: "商品設定" })).toHaveAttribute("aria-current", "page");
    expect(nav.getByRole("link", { name: "班聯工作" })).toHaveAttribute("href", "/shop/council-orders");
    expect(nav.getByRole("link", { name: "班聯工作" }).closest("details")).toBeNull();
    expect(nav.queryByRole("region", { name: "預購功能" })).not.toBeInTheDocument();
    expect(nav.getByRole("link", { name: "我的預購" })).toHaveAttribute("href", "/shop/orders");
    expect(nav.queryByRole("link", { name: "班級與議員設定" })).not.toBeInTheDocument();
  });

  it("keeps the representative entry prominent when staff also manage council orders", () => {
    state.pathname = "/shop/council-orders";
    state.permissions = ["class:shop_collect", "shop:manage"];
    const nav = openNavigation();
    const representative = nav.getByRole("link", { name: "班代代訂與收款" });
    const council = nav.getByRole("link", { name: "班聯工作" });
    expect(representative.closest(".shop-representative-entry")).not.toBeNull();
    expect(representative.closest("details")).toBeNull();
    expect(council.closest(".shop-council-entry")).not.toBeNull();
    expect(council).toHaveAttribute("aria-current", "page");
  });

  it("exposes class setup only to staff with class management permission", () => {
    state.permissions = ["class:manage"];
    const nav = openNavigation();
    expect(nav.getByRole("link", { name: "班級與議員設定" })).toHaveAttribute("href", "/admin/people?section=classes");
    expect(nav.queryByRole("link", { name: "班聯工作" })).not.toBeInTheDocument();
  });
});
