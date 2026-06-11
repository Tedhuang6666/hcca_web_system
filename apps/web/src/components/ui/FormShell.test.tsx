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
});
