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

it("falls back to the original once when the thumbnail fails", async () => {
  render(<CatalogImage src={src} alt="商品" sizes="50vw" />);
  act(() => intersect(true));
  const image = screen.getByRole("img", { name: "商品" });
  fireEvent.error(image);
  expect(image).toHaveAttribute("src", src);
  expect(image).not.toHaveAttribute("srcset");
  expect(image.parentElement).toHaveAttribute("data-state", "loading");
  await act(async () => { fireEvent.load(image); });
  expect(image.parentElement).toHaveAttribute("data-state", "ready");
});

it("shows an error only after both the thumbnail and original fail, and recovers for a new source", async () => {
  const { rerender } = render(<CatalogImage src={src} alt="商品" sizes="50vw" />);
  act(() => intersect(true));
  const image = screen.getByRole("img", { name: "商品" });
  fireEvent.error(image);
  fireEvent.error(image);
  expect(screen.getByText("圖片暫時無法載入")).toBeInTheDocument();
  expect(screen.queryByRole("img", { name: "商品" })).not.toBeInTheDocument();
  expect(image.parentElement).toBeNull();
  rerender(<CatalogImage src="/api/uploads/shop/back.png" alt="商品" sizes="50vw" />);
  const nextImage = screen.getByRole("img", { name: "商品" });
  expect(nextImage.getAttribute("src")).toContain("/_next/image?");
  expect(nextImage.parentElement).toHaveAttribute("data-state", "loading");
  await act(async () => { fireEvent.load(nextImage); });
  expect(nextImage.parentElement).toHaveAttribute("data-state", "ready");
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
