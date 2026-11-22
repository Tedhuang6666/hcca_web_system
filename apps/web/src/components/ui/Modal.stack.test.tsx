import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Modal from "./Modal";

describe("Modal stacking", () => {
  it("closes only the top-most dialog on Escape", async () => {
    const closeOuter = vi.fn();
    const closeInner = vi.fn();
    await act(async () => {
      render(
        <Modal title="外層" onClose={closeOuter}>
          <p>外層內容</p>
          <Modal title="內層確認" onClose={closeInner}>
            <p>內層內容</p>
          </Modal>
        </Modal>,
      );
    });
    expect(await screen.findByText("內層內容")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(closeInner).toHaveBeenCalledTimes(1);
    expect(closeOuter).not.toHaveBeenCalled();
  });
});
