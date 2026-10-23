import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { usePermissions } from "@/hooks/usePermissions";
import { cacheCurrentUser } from "@/lib/auth-cache";
import AppShell from "./AppShell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/shop", useRouter: () => ({ push: vi.fn() }),
}));

function Navigation() {
  const { isAdmin } = usePermissions();
  return <nav>{isAdmin ? "管理工作區" : "商品目錄"}</nav>;
}

const user = { id: "verified-member", email: "member@example.invalid", permissions: [], display_name: "測試使用者" };

describe("public shop session snapshot", () => {
  it("renders verified navigation before hydration and replaces another account's cache", () => {
    cacheCurrentUser({ id: "previous-admin", is_superuser: true });
    const content = <AppShell initialUser={user}><Navigation /></AppShell>;
    expect(renderToString(content)).not.toContain("管理工作區");
    render(content);
    expect(screen.getByRole("navigation")).toHaveTextContent("商品目錄");
    expect(localStorage.getItem("user_id")).toBe("verified-member");
  });

  it("includes an authenticated administrator's workspace in the initial HTML", () => {
    expect(renderToString(<AppShell initialUser={{ ...user, is_superuser: true }}>
      <Navigation />
    </AppShell>)).toContain("管理工作區");
  });
});
