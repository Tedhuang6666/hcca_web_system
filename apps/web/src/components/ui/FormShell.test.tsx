import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import FormShell from "./FormShell";

describe("FormShell", () => {
  it("renders a persistent action footer", () => {
    render(
      <FormShell footer={<button type="submit">儲存</button>}>
        <label>
          標題
          <input name="title" />
        </label>
      </FormShell>,
    );

    expect(screen.getByRole("button", { name: "儲存" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "標題" })).toBeVisible();
  });

  it("scrolls focused fields into view", async () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    render(
      <FormShell>
        <input aria-label="內容" />
      </FormShell>,
    );

    fireEvent.focusIn(screen.getByRole("textbox", { name: "內容" }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
  });

  it("marks the shell while the visual viewport is covered by the keyboard", () => {
    let resizeHandler: (() => void) | undefined;
    const addEventListener = vi.fn((_type: string, listener: EventListener) => {
      resizeHandler = listener as unknown as () => void;
    });
    const removeEventListener = vi.fn();
    const fakeVisualViewport = {
      height: 600,
      addEventListener,
      removeEventListener,
    };
    const visualViewport = fakeVisualViewport as unknown as VisualViewport;
    const previousViewport = window.visualViewport;
    const previousInnerHeight = window.innerHeight;
    Object.defineProperty(window, "visualViewport", { configurable: true, value: visualViewport });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1_000 });

    try {
      const { container, unmount } = render(
        <FormShell hideFooterOnKeyboard footer={<button type="submit">儲存</button>}>
          <input aria-label="內容" />
        </FormShell>,
      );
      const shell = container.firstElementChild as HTMLElement;

      expect(addEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
      resizeHandler?.();
      expect(shell.dataset.keyboardOpen).toBe("true");

      fakeVisualViewport.height = 800;
      resizeHandler?.();
      expect(shell.dataset.keyboardOpen).toBe("false");

      unmount();
      expect(removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
    } finally {
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: previousViewport,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: previousInnerHeight,
      });
    }
  });

  it("ignores focus events from non-form elements", () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    render(
      <FormShell>
        <div tabIndex={0}>說明</div>
      </FormShell>,
    );

    fireEvent.focusIn(screen.getByText("說明"));

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
