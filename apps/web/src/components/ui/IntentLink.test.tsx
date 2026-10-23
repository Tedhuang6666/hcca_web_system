import type { AnchorHTMLAttributes } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ prefetch, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    prefetch?: boolean | null;
  }) => <a {...props} data-prefetch={String(prefetch)} />,
}));

import IntentLink from "./IntentLink";

describe("navigation prefetch intent", () => {
  it.each(["mouseEnter", "focus", "touchStart"] as const)(
    "waits for %s before prefetching and keeps link semantics",
    (event) => {
      render(<IntentLink href="/documents" aria-label="公文系統">公文</IntentLink>);
      const link = screen.getByRole("link", { name: "公文系統" });
      expect(link).toHaveAttribute("href", "/documents");
      expect(link).toHaveAttribute("data-prefetch", "false");
      fireEvent[event](link);
      expect(link).toHaveAttribute("data-prefetch", "null");
    },
  );

  it("preserves existing handlers, including a prevented intent event", () => {
    const enter = vi.fn();
    const focus = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(<IntentLink href="/news" onFocus={focus} onMouseEnter={enter}>公告</IntentLink>);
    const link = screen.getByRole("link");
    fireEvent.focus(link);
    expect(focus).toHaveBeenCalledOnce();
    expect(link).toHaveAttribute("data-prefetch", "false");
    fireEvent.mouseEnter(link);
    expect(enter).toHaveBeenCalledOnce();
    expect(link).toHaveAttribute("data-prefetch", "null");
  });

  it("honors an explicit prefetch policy", () => {
    const { rerender } = render(<IntentLink href="/news" prefetch={false}>公告</IntentLink>);
    fireEvent.focus(screen.getByRole("link"));
    expect(screen.getByRole("link")).toHaveAttribute("data-prefetch", "false");
    rerender(<IntentLink href="/news" prefetch>公告</IntentLink>);
    expect(screen.getByRole("link")).toHaveAttribute("data-prefetch", "true");
  });
});
