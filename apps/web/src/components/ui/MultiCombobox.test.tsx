import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MultiCombobox from "./MultiCombobox";

describe("MultiCombobox", () => {
  it("重新聚焦會取消 blur 計時器，卸載時會清除待處理計時器", () => {
    vi.useFakeTimers();

    try {
      const { unmount } = render(
        <MultiCombobox selected={[]} onChange={vi.fn()} options={[]} />,
      );
      const input = screen.getByRole("combobox");
      const initialTimerCount = vi.getTimerCount();

      fireEvent.blur(input);
      expect(vi.getTimerCount()).toBe(initialTimerCount + 1);

      fireEvent.focus(input);
      expect(vi.getTimerCount()).toBe(initialTimerCount);
      expect(input).toHaveAttribute("aria-expanded", "true");

      fireEvent.blur(input);
      expect(vi.getTimerCount()).toBe(initialTimerCount + 1);

      unmount();
      expect(vi.getTimerCount()).toBe(initialTimerCount);
    } finally {
      vi.useRealTimers();
    }
  });
});
