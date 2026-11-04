import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CatalogImage from "./CatalogImage";

let intersect: (visible: boolean) => void;
const disconnect = vi.fn();
const observe = vi.fn();
const src = "/api/uploads/shop/front.png";

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
      expect(options.rootMargin).toBe("600px 0px");
      intersect = (visible) => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    observe = observe;
    disconnect = disconnect;
  });
});

afterEach(() => vi.unstubAllGlobals());

it("keeps the image area occupied without downloading an offscreen image", async () => {
  render(<CatalogImage src={src} alt="商品" sizes="auto, 50vw" />);
  expect(screen.getByText("圖片載入中")).toBeInTheDocument();
  expect(screen.queryByRole("img", { name: "商品" })).not.toBeInTheDocument();
  act(() => intersect(false));
  expect(screen.queryByRole("img", { name: "商品" })).not.toBeInTheDocument();
  act(() => intersect(true));
  const image = screen.getByRole("img", { name: "商品" });
  expect(image.getAttribute("src")).toContain("/_next/image?");
  expect(image).toHaveAttribute("loading", "lazy");
  expect(observe).toHaveBeenCalled();
  expect(disconnect).toHaveBeenCalled();
  expect(image.parentElement).toHaveAttribute("aria-busy", "true");
  await act(async () => { fireEvent.load(image); });
  expect(image.parentElement).toHaveAttribute("aria-busy", "false");
  expect(image.parentElement).toHaveAttribute("data-state", "ready");
});

it("does not download the full original when thumbnail generation fails", () => {
  render(<CatalogImage src={src} alt="商品" sizes="50vw" />);
  act(() => intersect(true));
  fireEvent.error(screen.getByRole("img", { name: "商品" }));
  expect(screen.getByText("圖片暫時無法載入")).toBeInTheDocument();
  expect(screen.queryByRole("img", { name: "商品" })).not.toBeInTheDocument();
  expect(document.querySelector(`img[src="${src}"]`)).toBeNull();
});

it("loads without IntersectionObserver and resets the placeholder when the source changes", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const { rerender } = render(<CatalogImage src={src} alt="商品" sizes="50vw" />);
  await act(async () => { fireEvent.load(screen.getByRole("img", { name: "商品" })); });
  rerender(<CatalogImage src="/api/uploads/shop/back.png" alt="商品" sizes="50vw" />);
  expect(screen.getByRole("img", { name: "商品" }).parentElement).toHaveAttribute("data-state", "loading");
  await act(async () => { fireEvent.load(screen.getByRole("img", { name: "商品" })); });
  expect(screen.getByRole("img", { name: "商品" }).parentElement).toHaveAttribute("data-state", "ready");
});
