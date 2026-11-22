import { afterEach, describe, expect, it, vi } from "vitest";

import { copyText } from "./clipboard";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (document as { execCommand?: unknown }).execCommand;
});

describe("copyText", () => {
  it("uses the Clipboard API when the browser offers it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await copyText("https://example.test");
    expect(writeText).toHaveBeenCalledWith("https://example.test");
  });

  it("falls back to copying a selected, removed text box without the Clipboard API", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    let copied = "";
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => {
        copied = (document.activeElement as HTMLTextAreaElement | null)?.value
          ?? document.querySelector("textarea")?.value
          ?? "";
        return true;
      }),
    });
    await copyText("0123456");
    expect(copied).toBe("0123456");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("reports a refused fallback so callers can offer manual copy", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
    await expect(copyText("x")).rejects.toThrow("copy_failed");
    expect(document.querySelector("textarea")).toBeNull();
  });
});
