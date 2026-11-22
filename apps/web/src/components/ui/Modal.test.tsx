import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Modal from "./Modal";

const reduceMotion = { matches: false };

function surface(): HTMLElement {
  const element = screen.getByRole("dialog").querySelector<HTMLElement>(".modal-surface");
  if (!element) throw new Error("modal surface missing");
  return element;
}

beforeEach(() => {
  reduceMotion.matches = false;
  vi.stubGlobal("matchMedia", vi.fn(() => reduceMotion));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-a11y-motion");
});

describe("Modal origin", () => {
  it("unfolds from the point the user just pressed", () => {
    window.dispatchEvent(new MouseEvent("pointerdown", { clientX: 120, clientY: 80 }));
    render(<Modal title="分享問卷" onClose={vi.fn()}>內容</Modal>);
    expect(surface()).toHaveAttribute("data-origin", "trigger");
    expect(surface().style.getPropertyValue("--sheet-origin")).toBe("120px 80px");
  });

  it("uses the focused trigger when opened from the keyboard", () => {
    vi.spyOn(performance, "now").mockReturnValue(Number.MAX_SAFE_INTEGER);
    render(<button type="button">刪除</button>);
    const trigger = screen.getByRole("button", { name: "刪除" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      x: 300, y: 40, left: 300, top: 40, width: 80, height: 40, right: 380, bottom: 80,
      toJSON: () => ({}),
    } as DOMRect);
    trigger.focus();

    render(<Modal title="確認刪除" onClose={vi.fn()}>內容</Modal>);
    expect(surface().style.getPropertyValue("--sheet-origin")).toBe("340px 60px");
  });

  it("keeps the centred entrance when nothing triggered it or motion is reduced", () => {
    vi.spyOn(performance, "now").mockReturnValue(Number.MAX_SAFE_INTEGER);
    const first = render(<Modal title="自動提示" onClose={vi.fn()}>內容</Modal>);
    expect(surface()).not.toHaveAttribute("data-origin");
    first.unmount();

    vi.mocked(performance.now).mockReturnValue(0);
    window.dispatchEvent(new MouseEvent("pointerdown", { clientX: 10, clientY: 10 }));
    reduceMotion.matches = true;
    render(<Modal title="減少動態" onClose={vi.fn()}>內容</Modal>);
    expect(surface()).not.toHaveAttribute("data-origin");
  });
});
