import { lazy, memo, Suspense } from "react";
import { act, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cacheCurrentUser, clearAuthCache } from "@/lib/auth-cache";
import type { ServerSessionUser } from "@/lib/server/session";
import { usePermissions } from "@/hooks/usePermissions";
import { SessionSnapshotProvider } from "./SessionSnapshotContext";

const member: ServerSessionUser = {
  id: "member", display_name: "測試使用者", email: "member@example.invalid",
  permissions: ["document:create"],
};
const admin: ServerSessionUser = {
  id: "admin", display_name: "測試管理員", email: "admin@example.invalid",
  permissions: [], is_superuser: true,
};

const Controls = memo(function Controls({ label = "權限" }: { label?: string }) {
  const { can, isReady, isAdmin } = usePermissions();
  return <section aria-label={label}>
    <output aria-label="ready">{String(isReady)}</output>
    {can("document:create") && <button>新增公文</button>}
    {isAdmin && <button>管理員操作</button>}
  </section>;
});

function content(user: ServerSessionUser | null) {
  return <SessionSnapshotProvider user={user}><Controls /></SessionSnapshotProvider>;
}

describe("verified session permission snapshot", () => {
  it("renders verified actions on the server and hydrates over another user's cache", () => {
    cacheCurrentUser(admin);
    const container = document.createElement("div");
    container.innerHTML = renderToString(content(member));
    expect(localStorage.getItem("user_id")).toBe("admin");
    expect(container.textContent).toContain("新增公文");
    expect(container.textContent).not.toContain("管理員操作");
    const serverButton = container.querySelector("button");
    document.body.append(container);
    render(content(member), { container, hydrate: true });
    expect(screen.getByRole("button", { name: "新增公文" })).toBe(serverButton);
    expect(screen.queryByRole("button", { name: "管理員操作" })).not.toBeInTheDocument();
    expect(localStorage.getItem("user_id")).toBe("member");
  });

  it("does not trust a cached administrator during an anonymous server render", () => {
    cacheCurrentUser(admin);
    const html = renderToString(content(null));
    expect(html).not.toContain("管理員操作");
    expect(html).not.toContain("新增公文");
  });

  it("keeps simultaneous server snapshots isolated", () => {
    expect(renderToString(content(admin))).toContain("管理員操作");
    expect(renderToString(content(member))).not.toContain("管理員操作");
    expect(renderToString(content(null))).not.toContain("新增公文");
  });

  it("updates every memoized subscriber when permissions are revoked or the user logs out", () => {
    render(<SessionSnapshotProvider user={member}>
      <Controls label="first" /><Controls label="second" />
    </SessionSnapshotProvider>);
    for (const label of ["first", "second"]) {
      expect(within(screen.getByRole("region", { name: label })).getByRole("button")).toBeVisible();
    }
    act(() => cacheCurrentUser({ ...member, permissions: [] }));
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    act(() => cacheCurrentUser(admin));
    expect(screen.getAllByRole("button", { name: "管理員操作" })).toHaveLength(2);
    act(() => clearAuthCache());
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it.each([false, true])("hydrates a delayed boundary without losing its server snapshot (revoked: %s)", async (revoke) => {
    let release!: (value: { default: typeof Controls }) => void;
    const DelayedControls = lazy(() => new Promise<{ default: typeof Controls }>(resolve => {
      release = resolve;
    }));
    const container = document.createElement("div");
    container.innerHTML = renderToString(<SessionSnapshotProvider user={member}>
      <Suspense fallback={<p>載入中</p>}><Controls /></Suspense>
    </SessionSnapshotProvider>);
    const serverButton = container.querySelector("button");
    document.body.append(container);
    const recoverableErrors: unknown[] = [];
    render(<SessionSnapshotProvider user={member}>
      <Suspense fallback={<p>載入中</p>}><DelayedControls /></Suspense>
    </SessionSnapshotProvider>, {
      container, hydrate: true, onRecoverableError: error => recoverableErrors.push(error),
    });
    if (revoke) act(() => clearAuthCache());
    await act(async () => { release({ default: Controls }); });
    expect(recoverableErrors).toHaveLength(0);
    if (revoke) expect(screen.queryByRole("button")).not.toBeInTheDocument();
    else expect(screen.getByRole("button")).toBe(serverButton);
  });

  it("uses a newly verified account without retaining the previous administrator", () => {
    const { rerender } = render(content(admin));
    expect(screen.getByRole("button", { name: "管理員操作" })).toBeVisible();
    rerender(content(member));
    expect(screen.queryByRole("button", { name: "管理員操作" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新增公文" })).toBeVisible();
    expect(localStorage.getItem("user_id")).toBe("member");
  });
});
