import { fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import PublicSiteWorkspaceHeader from "./PublicSiteWorkspaceHeader";

describe("site workspace loading header", () => {
  it("renders the page description before settings load and prevents duplicate refreshes", () => {
    const refresh = vi.fn();
    expect(renderToString(<PublicSiteWorkspaceHeader loading onRefresh={refresh} />)).toContain("公開網站工作台");
    const { rerender } = render(<PublicSiteWorkspaceHeader loading onRefresh={refresh} />);
    expect(screen.getByRole("heading", { name: "公開網站工作台" })).toBeVisible();
    expect(screen.getByRole("button", { name: "同步資料" })).toBeDisabled();
    rerender(<PublicSiteWorkspaceHeader loading={false} onRefresh={refresh} />);
    fireEvent.click(screen.getByRole("button", { name: "同步資料" }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
