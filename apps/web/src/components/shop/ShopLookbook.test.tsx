import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ShopLookbook from "./ShopLookbook";

// jsdom 尚未實作原生 dialog；原生焦點圈與 Escape 另外以 Chromium 驗證。
const dialogMethods = ["showModal", "close"] as const;
const originals = dialogMethods.map((name) => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name));
beforeAll(() => {
  dialogMethods.forEach((name) => Object.defineProperty(HTMLDialogElement.prototype, name, {
    configurable: true,
    value(this: HTMLDialogElement) { this.open = name === "showModal"; },
  }));
});
afterAll(() => {
  dialogMethods.forEach((name, index) => {
    const original = originals[index];
    if (original) Object.defineProperty(HTMLDialogElement.prototype, name, original);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  });
});

describe("校慶服飾圖集", () => {
  it("先顯示精選三張，展開與款式切換不會一次載入所有攝影大檔", () => {
    render(<ShopLookbook />);
    expect(screen.getAllByRole("button", { name: /^放大/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "展開全部 8 張" }));
    expect(screen.getAllByRole("button", { name: /^放大/ })).toHaveLength(8);
    fireEvent.click(screen.getByRole("button", { name: "刷毛帽踢" }));
    expect(screen.getAllByRole("button", { name: /^放大/ })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "展開全部 9 張" })).toHaveAttribute("aria-expanded", "false");
  });

  it("放大後可用鍵盤換圖，取消還原捲動與原本焦點", () => {
    render(<ShopLookbook />);
    const trigger = screen.getByRole("button", { name: "放大黑色棉踢側面實穿" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(document.body.style.overflow).toBe("hidden");
    const close = within(dialog).getByRole("button", { name: "關閉照片檢視" });
    const next = within(dialog).getByRole("button", { name: "下一張照片" });
    expect(close).toHaveFocus();
    next.focus();
    fireEvent.keyDown(next, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(next).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(within(dialog).getByRole("img", { name: "黑色棉踢正面實穿" })).toBeVisible();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(dialog).not.toHaveAttribute("open");
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("DM 保留完整構圖並提供鍵盤可捲動的閱讀區", () => {
    render(<ShopLookbook />);
    fireEvent.click(screen.getByRole("button", { name: "風衣外套" }));
    fireEvent.click(screen.getByRole("button", { name: "查看原版 DM" }));
    const dialog = screen.getByRole("dialog");
    const region = within(dialog).getByRole("region", { name: "DM 完整構圖，可橫向捲動" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(within(region).getByRole("img")).toHaveAttribute("src", "/shop/104/windbreaker-dm.webp");
    fireEvent.click(within(dialog).getByRole("button", { name: "關閉照片檢視" }));
    expect(dialog).not.toHaveAttribute("open");
  });

  it("失敗圖片顯示文字，仍能關閉或切換照片", () => {
    render(<ShopLookbook />);
    fireEvent.click(screen.getByRole("button", { name: "放大黑色棉踢側面實穿" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.error(within(dialog).getByRole("img"));
    expect(within(dialog).getByText("照片暫時無法顯示，請稍後重新開啟。")).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "下一張照片" }));
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", "/shop/104/cotton-06-2400.webp");
  });
});
