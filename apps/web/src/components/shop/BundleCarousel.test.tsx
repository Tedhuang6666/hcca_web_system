import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BundleCarousel from "./BundleCarousel";

let frames: Map<number, FrameRequestCallback>;
let frameId: number;

function advance(time: number) {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(time));
  });
}

function offers() {
  return <BundleCarousel>{["甲", "乙", "丙"].map((name) => (
    <article key={name} aria-label={name}><button type="button">選購{name}</button></article>
  ))}</BundleCarousel>;
}

beforeEach(() => {
  frames = new Map();
  frameId = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 100 } as DOMRect);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(300);
});

afterEach(() => vi.unstubAllGlobals());

describe("套組橫向輪播", () => {
  it("自動向側邊循環，優惠與操作按鈕各只保留一份", () => {
    render(offers());
    const viewport = screen.getByRole("group", { name: "套組清單，可左右捲動" });
    advance(0);
    advance(64);
    expect(viewport.scrollLeft).toBeGreaterThan(0);
    for (let time = 128; time <= 3456; time += 64) advance(time);
    expect(screen.getAllByRole("article").map((element) => element.getAttribute("aria-label")))
      .toEqual(["乙", "丙", "甲"]);
    expect(viewport.scrollLeft).toBeLessThan(100);
    expect(screen.getAllByRole("button", { name: /^選購/ })).toHaveLength(3);
  });

  it("點擊頁面其他位置後持續停止，仍可使用手動瀏覽", () => {
    render(offers());
    advance(0);
    advance(64);
    const viewport = screen.getByRole("group", { name: "套組清單，可左右捲動" });
    fireEvent.click(document.body);
    const stoppedAt = viewport.scrollLeft;
    advance(128);
    expect(viewport.scrollLeft).toBe(stoppedAt);
    expect(frames.size).toBe(0);
    expect(screen.getByText("左右滑動瀏覽套組")).toBeVisible();
    const scrollTo = vi.fn();
    viewport.scrollTo = scrollTo;
    fireEvent.click(screen.getByRole("button", { name: "下一個套組" }));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ left: stoppedAt + 100 }));
  });

  it("鍵盤聚焦或偏好減少動態時停止自動滑動", () => {
    const { unmount } = render(offers());
    fireEvent.focus(screen.getByRole("group", { name: "套組清單，可左右捲動" }));
    expect(frames.size).toBe(0);
    unmount();
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(offers());
    expect(frames.size).toBe(0);
    expect(screen.getByText("左右滑動瀏覽套組")).toBeVisible();
  });
});
