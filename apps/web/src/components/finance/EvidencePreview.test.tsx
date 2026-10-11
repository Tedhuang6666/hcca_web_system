import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import EvidencePreview from "./EvidencePreview";

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument,
}));

function makePdfDocument() {
  const getPage = vi.fn(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
    }),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  }));
  const document = { numPages: 2, getPage };
  const destroy = vi.fn();
  getDocument.mockReturnValue({ promise: Promise.resolve(document), destroy });
  return { getPage, document };
}

describe("EvidencePreview", () => {
  beforeEach(() => {
    getDocument.mockClear();
    makePdfDocument();
    vi.stubGlobal("ResizeObserver", class {
      constructor(private readonly callback: ResizeObserverCallback) {}

      observe(target: Element) {
        this.callback(
          [{ target, contentRect: { width: 320 } as DOMRectReadOnly } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }

      unobserve() {}
      disconnect() {}
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({} as CanvasRenderingContext2D);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("renders PDF pages in the preview and lets readers change pages", async () => {
    const { getPage } = makePdfDocument();
    render(
      <EvidencePreview
        url="https://hcca.tw/finance/evidence/receipt.pdf"
        filename="receipt.pdf"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "預覽憑證：receipt.pdf" }));

    expect(await screen.findByText("第 1 頁 / 共 2 頁")).toBeVisible();
    expect(await screen.findByRole("img", { name: "receipt.pdf 第 1 頁" })).toBeVisible();
    expect(getDocument).toHaveBeenCalledWith({
      url: "https://hcca.tw/finance/evidence/receipt.pdf",
    });

    fireEvent.click(screen.getByRole("button", { name: "下一頁" }));

    expect(await screen.findByRole("img", { name: "receipt.pdf 第 2 頁" })).toBeVisible();
    await waitFor(() => expect(getPage).toHaveBeenLastCalledWith(2));
  });

  it("keeps image receipts in the same preview dialog", async () => {
    render(
      <EvidencePreview
        url="https://hcca.tw/finance/evidence/receipt.jpg"
        filename="receipt.jpg"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "預覽憑證：receipt.jpg" }));

    expect(await screen.findByRole("img", { name: "receipt.jpg" })).toBeVisible();
    expect(getDocument).not.toHaveBeenCalled();
  });

  it("offers the original PDF when the preview cannot load", async () => {
    getDocument.mockReturnValue({
      promise: Promise.reject(new Error("PDF load failed")),
      destroy: vi.fn(),
    });
    render(
      <EvidencePreview
        url="https://hcca.tw/finance/evidence/receipt.pdf"
        filename="receipt.pdf"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "預覽憑證：receipt.pdf" }));

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("無法預覽這份 PDF");
    expect(screen.getByRole("link", { name: "在新分頁開啟" }))
      .toHaveAttribute("href", "https://hcca.tw/finance/evidence/receipt.pdf");
  });
});
