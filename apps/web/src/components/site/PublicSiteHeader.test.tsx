import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PublicSiteHeader from "./PublicSiteHeader";

const state = vi.hoisted(() => ({
  pathname: "/regulations",
  statuses: {} as Record<string, { id: string; on: boolean; mode: string }>,
  desktop: {
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("@/components/ui/IntentLink", () => ({
  default: (props: ComponentProps<"a">) => <a {...props} />,
}));
vi.mock("@/components/providers/ThemeProvider", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }),
}));
vi.mock("@/contexts/PublicModuleStatusContext", () => ({
  usePublicModuleStatus: () => ({ statuses: state.statuses }),
}));
vi.mock("./LiveElectionBanner", () => ({ default: () => null }));

beforeEach(() => {
  state.pathname = "/regulations";
  state.statuses = {};
  state.desktop.matches = false;
  state.desktop.addEventListener.mockClear();
  state.desktop.removeEventListener.mockClear();
  vi.stubGlobal("matchMedia", vi.fn(() => state.desktop));
});

afterEach(() => vi.unstubAllGlobals());

function openMenu(props: ComponentProps<typeof PublicSiteHeader> = {}) {
  const view = render(<PublicSiteHeader {...props} />);
  const trigger = screen.getByRole("button", { name: "開啟導覽" });
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "公開網站導覽" });
  return { ...view, trigger, dialog, menu: within(dialog) };
}

describe("公開網站手機導覽", () => {
  it("shows every service once without requiring category expansion", () => {
    const { menu } = openMenu();
    const navigation = menu.getByRole("navigation", { name: "公開網站行動導覽" });
    expect(navigation.querySelector("details")).toBeNull();
    expect(menu.queryByRole("heading")).not.toBeInTheDocument();
    expect(menu.getAllByRole("link", { name: "文章專欄" })).toHaveLength(1);
    expect(menu.getByRole("link", { name: "公開陳情" })).toBeVisible();
    expect(menu.getByRole("link", { name: /活動成果/ })).toHaveAttribute("href", "/gallery");
    expect(menu.getByRole("link", { name: "法規查詢" })).toHaveAttribute("aria-current", "page");
    expect(menu.getByRole("link", { name: "登入平台" })).toHaveAttribute("href", "/login?next=%2Fdashboard");
  });

  it("searches built-in services and custom pages in a flat result list", () => {
    const { menu } = openMenu({
      navPages: [{ id: "guide", slug: "新生指南", title: "新生指南", nav_label: "", page_kind: "article" }],
    });
    const search = menu.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "新生" } });
    expect(menu.getByRole("status")).toHaveTextContent("1 項結果");
    expect(menu.getByRole("link", { name: "新生指南" })).toHaveAttribute("href", `/articles/${encodeURIComponent("新生指南")}`);
    expect(menu.queryByRole("link", { name: "最新公告" })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "條文" } });
    expect(menu.getByRole("link", { name: "法規查詢" })).toBeVisible();
    fireEvent.change(search, { target: { value: "沒有這個服務" } });
    expect(menu.getByRole("status")).toHaveTextContent("0 項結果");
    expect(menu.getByText("找不到相符頁面，換個關鍵字試試。")).toBeVisible();
    fireEvent.change(search, { target: { value: "" } });
    expect(menu.getByRole("link", { name: "最新公告" })).toBeVisible();
  });

  it("keeps hidden services and closed modules out of shortcuts and search", () => {
    state.statuses = { shop: { id: "shop", on: true, mode: "closed" } };
    const { menu } = openMenu({ settings: {
      site_logo_url: null,
      site_logo_alt: "會徽",
      theme_config: { nav: { items: { regulations: { hidden: true } } } },
    } });
    expect(menu.queryByRole("link", { name: "商品訂購" })).not.toBeInTheDocument();
    expect(menu.queryByRole("link", { name: "法規查詢" })).not.toBeInTheDocument();
    expect(menu.getByRole("link", { name: "公開資料庫" })).toBeVisible();
    fireEvent.change(menu.getByRole("searchbox"), { target: { value: "商品" } });
    expect(menu.getByRole("status")).toHaveTextContent("0 項結果");
  });

  it("restores focus and body scrolling when Escape closes the menu", async () => {
    document.body.style.overflow = "auto";
    const { menu, trigger } = openMenu();
    await waitFor(() => expect(menu.getByRole("button", { name: "關閉導覽" })).toHaveFocus());
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("auto");
    document.body.style.overflow = "";
  });

  it("closes after choosing a page and clears a previous search when reopened", () => {
    const { menu, trigger } = openMenu();
    fireEvent.change(menu.getByRole("searchbox"), { target: { value: "法規" } });
    fireEvent.click(menu.getByRole("link", { name: "法規查詢" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(within(screen.getByRole("dialog")).getByRole("searchbox")).toHaveValue("");
  });

  it("unfurls from the menu button and folds back into it before unmounting", async () => {
    const finishes: Array<() => void> = [];
    const animate = vi.fn(() => ({
      finished: new Promise<void>((resolve) => finishes.push(resolve)),
      cancel: vi.fn(),
    }));
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      writable: true,
      value: animate,
    });
    try {
      render(<PublicSiteHeader />);
      const trigger = screen.getByRole("button", { name: "開啟導覽" });
      vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
        x: 340, y: 12, left: 340, top: 12, width: 44, height: 44, right: 384, bottom: 56,
        toJSON: () => ({}),
      } as DOMRect);

      fireEvent.click(trigger);
      const dialog = screen.getByRole("dialog", { name: "公開網站導覽" });
      const reveal = animate.mock.calls[0] as unknown as [PropertyIndexedKeyframes];
      expect(reveal[0].clipPath).toEqual(["circle(0px at 362px 34px)", expect.stringMatching(/^circle\(/)]);

      fireEvent.click(within(dialog).getByRole("button", { name: "關閉導覽" }));
      expect(dialog).toHaveAttribute("data-closing", "true");
      expect(screen.getByRole("dialog")).toBe(dialog);
      const fold = animate.mock.calls.at(-1) as unknown as [PropertyIndexedKeyframes];
      expect((fold[0].clipPath as string[]).at(-1)).toBe("circle(0px at 362px 34px)");

      await act(async () => finishes.at(-1)?.());
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    } finally {
      delete (HTMLElement.prototype as { animate?: unknown }).animate;
    }
  });

  it("releases the mobile menu when resizing to the desktop layout", () => {
    const { unmount } = openMenu();
    const listener = state.desktop.addEventListener.mock.calls.find(([event]) => event === "change")?.[1];
    expect(listener).toBeTypeOf("function");
    state.desktop.matches = true;
    act(() => listener());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    unmount();
    expect(state.desktop.removeEventListener).toHaveBeenCalledWith("change", listener);
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});

describe("公開網站桌機導覽", () => {
  it("groups secondary pages into two short menus without a search panel", () => {
    render(<PublicSiteHeader navPages={[
      { id: "guide", slug: "新生指南", title: "新生指南", nav_label: "", page_kind: "article" },
      { id: "faq", slug: "faq", title: "常見問題", nav_label: "", page_kind: "page" },
    ]} />);
    const nav = screen.getByRole("navigation", { name: "公開網站導覽" });
    const topLinks = within(nav).getAllByRole("link").filter((link) => !link.closest("details"));
    expect(topLinks.map((link) => link.textContent)).toEqual(["最新公告", "商品訂購", "文章專欄"]);
    const menus = nav.querySelectorAll("details");
    expect([...menus].map((menu) => menu.querySelector("summary")?.textContent)).toEqual(["公開資料", "關於"]);
    expect(within(menus[0] as HTMLElement).getByRole("link", { name: "法規查詢" })).toHaveAttribute("aria-current", "page");
    expect(within(menus[1] as HTMLElement).getByRole("link", { name: "常見問題" })).toHaveAttribute("href", "/pages/faq");
    expect(within(nav).queryByRole("link", { name: "新生指南" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("closes an open menu with Escape and returns focus to its toggle", () => {
    render(<PublicSiteHeader />);
    const nav = screen.getByRole("navigation", { name: "公開網站導覽" });
    const menu = nav.querySelector("details") as HTMLDetailsElement;
    menu.open = true;
    fireEvent.keyDown(document, { key: "Escape" });
    expect(menu.open).toBe(false);
    expect(menu.querySelector("summary")).toHaveFocus();
  });
});
