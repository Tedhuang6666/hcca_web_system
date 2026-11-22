import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import CopyButton from "./CopyButton";

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset();
  toast.error.mockReset();
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function press(button: HTMLElement) {
  await act(async () => {
    fireEvent.click(button);
  });
}

describe("CopyButton", () => {
  it("shows the result on the button itself and settles back", async () => {
    vi.useFakeTimers();
    writeText.mockResolvedValue(undefined);
    const onCopied = vi.fn();
    render(<CopyButton value={() => "https://example.test/a"} label="複製連結" onCopied={onCopied} />);
    const button = screen.getByRole("button", { name: "複製連結" });
    expect(button).toHaveAttribute("data-copy-state", "idle");
    expect(button).not.toHaveAttribute("data-copy-used");

    await press(button);
    expect(writeText).toHaveBeenCalledWith("https://example.test/a");
    expect(onCopied).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("data-copy-state", "copied");
    expect(button).toHaveTextContent("已複製");
    expect(screen.getByText("已複製到剪貼簿")).toHaveAttribute("aria-live", "polite");
    expect(toast.error).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1800); });
    expect(button).toHaveAttribute("data-copy-state", "idle");
    expect(button).toHaveAttribute("data-copy-used", "true");
    expect(screen.getByRole("button", { name: "複製連結" })).toBe(button);
  });

  it("tells the user how to recover when the browser refuses", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    render(<CopyButton value="secret" label="複製" failureHint="請手動選取 key" />);
    const button = screen.getByRole("button", { name: "複製" });

    await press(button);
    expect(button).toHaveAttribute("data-copy-state", "failed");
    expect(button).toHaveTextContent("複製失敗");
    expect(toast.error).toHaveBeenCalledWith("請手動選取 key");
  });

  it("lets the caller own the recovery instead of the default hint", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    const onCopyError = vi.fn();
    render(<CopyButton value="0123456" label="複製驗證碼" onCopyError={onCopyError} />);

    await press(screen.getByRole("button", { name: "複製驗證碼" }));
    expect(onCopyError).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("runs the caller's click handler first and can be cancelled", async () => {
    writeText.mockResolvedValue(undefined);
    const rowClick = vi.fn();
    const { rerender } = render(
      <div onClick={rowClick}>
        <CopyButton value="/regulations/1#a1" aria-label="複製第 1 條連結" onClick={(event) => event.stopPropagation()} />
      </div>,
    );
    await press(screen.getByRole("button", { name: "複製第 1 條連結" }));
    expect(writeText).toHaveBeenCalledWith("/regulations/1#a1");
    expect(rowClick).not.toHaveBeenCalled();

    writeText.mockClear();
    rerender(<CopyButton value="ignored" aria-label="複製第 1 條連結" onClick={(event) => event.preventDefault()} />);
    await press(screen.getByRole("button", { name: "複製第 1 條連結" }));
    expect(writeText).not.toHaveBeenCalled();
  });

  it("keeps an icon-only button named by its action", () => {
    render(<CopyButton value="x" icon="link" aria-label="複製公文連結" />);
    const button = screen.getByRole("button", { name: "複製公文連結" });
    expect(button).toHaveClass("copy-button--icon-only");
    expect(button.querySelector(".copy-button__labels")).toBeNull();
  });
});
