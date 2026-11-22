import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

import PublicSiteBackLink from "./PublicSiteBackLink";

describe("PublicSiteBackLink", () => {
  it.each([
    ["/news/abc", "/news", "返回最新公告"],
    ["/articles/guide", "/articles", "返回文章專欄"],
    ["/petitions/public/case-1", "/petitions/public", "返回公開陳情"],
    ["/public/budgets/budget-1", "/public/budgets", "返回財務總覽"],
    ["/public/elections", "/public", "返回公開資料庫"],
  ])("links %s back to its list", (path, href, label) => {
    pathname.current = path;
    render(<PublicSiteBackLink />);
    expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
  });

  it.each(["/", "/articles", "/petitions/public", "/petitions/new"])("renders nothing on %s", (path) => {
    pathname.current = path;
    const { container } = render(<PublicSiteBackLink />);
    expect(container).toBeEmptyDOMElement();
  });
});
