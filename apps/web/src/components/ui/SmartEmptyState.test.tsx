import { render, screen, act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cacheCurrentUser } from "@/lib/auth-cache";
import type { ServerSessionUser } from "@/lib/server/session";
import { SessionSnapshotProvider } from "@/contexts/SessionSnapshotContext";
import SmartEmptyState from "./SmartEmptyState";

const member: ServerSessionUser = {
  id: "member", email: "member@example.invalid", display_name: "測試使用者", permissions: [],
};
function content(user: ServerSessionUser | null) {
  return <SessionSnapshotProvider user={user}>
    <SmartEmptyState reason="new" subject="公文" createHref="/documents/new" createPerm="document:create" />
  </SessionSnapshotProvider>;
}

describe("empty state creation permission", () => {
  it("renders the empty explanation on the server without granting an anonymous creation link", () => {
    const html = renderToString(content(null));
    expect(html).toContain("還沒有任何公文");
    expect(html).not.toContain('href="/documents/new"');
  });

  it("hydrates a verified creation link even when the previous cache has no permission", () => {
    const creator = { ...member, permissions: ["document:create"] };
    cacheCurrentUser(member);
    const container = document.createElement("div");
    container.innerHTML = renderToString(content(creator));
    const serverLink = container.querySelector("a");
    document.body.append(container);
    render(content(creator), { container, hydrate: true });
    expect(screen.getByRole("link", { name: "建立第一筆公文" })).toBe(serverLink);
    act(() => cacheCurrentUser(member));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("does not reuse a previous administrator's permission for the current member", () => {
    cacheCurrentUser({ ...member, id: "previous-admin", is_superuser: true });
    render(content(member));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
