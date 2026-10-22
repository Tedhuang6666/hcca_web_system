import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

import PageTransition from "./PageTransition";

function content() {
  return <PageTransition><h1>頁面內容</h1></PageTransition>;
}

describe("page transition visibility", () => {
  beforeEach(() => { navigation.pathname = "/"; });

  it("renders server content without an entrance animation and keeps it visible on hydration", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(content());
    const serverHeading = container.querySelector("h1");
    document.body.append(container);
    expect(container.firstElementChild).toHaveClass("page-transition-static");

    render(content(), { container, hydrate: true });
    expect(screen.getByRole("heading")).toBe(serverHeading);
    expect(screen.getByRole("heading").parentElement).toHaveClass("page-transition-static");
    expect(screen.getByRole("heading").parentElement).not.toHaveClass("page-sheet-transition");
  });

  it("animates navigation, including a return to the initial route", () => {
    const { rerender } = render(content());
    for (const pathname of ["/about", "/news", "/"]) {
      navigation.pathname = pathname;
      rerender(content());
      expect(screen.getByRole("heading").parentElement).toHaveClass("page-sheet-transition");
      expect(screen.getByRole("heading").parentElement).not.toHaveClass("page-transition-static");
    }
  });

  it("keeps legal content static after navigation", () => {
    const { rerender } = render(content());
    navigation.pathname = "/legal/privacy";
    rerender(content());
    expect(screen.getByRole("heading").parentElement).toHaveClass("page-transition-static");
  });
});
