import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import InfinitePhotoWall from "./InfinitePhotoWall";
import type { GalleryItem } from "./GalleryViewer";

const disconnect = vi.fn();
const items: GalleryItem[] = Array.from({ length: 80 }, (_, index) => ({
  id: String(index), src: "/photo-" + index + ".webp", alt: "活動照片", caption: "照片 " + index,
  width: 1200, height: 800, featured: true, albumId: "welcome", albumTitle: "迎新", sourceUrl: "", isKeyVisual: false,
}));

beforeEach(() => {
  disconnect.mockClear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect = disconnect; });
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number;
    constructor(type: string, options: PointerEventInit = {}) { super(type, options); this.pointerId = options.pointerId ?? 1; }
  });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

it("pans with the wheel inside the wall, zooms around the cursor and removes observers", () => {
  const { container, unmount } = render(<InfinitePhotoWall items={items} paused={false} onOpen={vi.fn()} />);
  const viewport = screen.getByLabelText(/照片牆，可拖曳/);
  const plane = container.querySelector<HTMLElement>(".infinite-wall-plane")!;
  const initial = plane.style.transform;
  const wheel = new WheelEvent("wheel", { deltaY: 200, bubbles: true, cancelable: true });
  fireEvent(viewport, wheel);
  expect(wheel.defaultPrevented).toBe(true);
  expect(plane.style.transform).not.toBe(initial);
  fireEvent.wheel(viewport, { deltaY: -60, ctrlKey: true });
  expect(screen.getByLabelText("縮放比例")).not.toHaveTextContent("100%");
  fireEvent.click(screen.getByRole("button", { name: "顯示全部照片" }));
  const percentage = Number.parseInt(screen.getByLabelText("縮放比例").textContent || "");
  expect(percentage).toBeGreaterThan(0);
  expect(percentage).toBeLessThan(100);
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});

it("supports keyboard pan and zoom without consuming photo activation keys", () => {
  const onOpen = vi.fn();
  const { container } = render(<InfinitePhotoWall items={items} paused={false} onOpen={onOpen} />);
  const viewport = screen.getByLabelText(/照片牆，可拖曳/);
  const plane = container.querySelector<HTMLElement>(".infinite-wall-plane")!;
  const initial = plane.style.transform;
  fireEvent.keyDown(viewport, { key: "ArrowDown" });
  expect(plane.style.transform).not.toBe(initial);
  fireEvent.keyDown(viewport, { key: "+" });
  expect(screen.getByLabelText("縮放比例")).toHaveTextContent("125%");
  fireEvent.click(screen.getByRole("button", { name: "放大：迎新・照片 0" }));
  expect(onOpen).toHaveBeenCalledOnce();
});

it("distinguishes a drag from a click and supports two pointer pinch zoom", () => {
  const onOpen = vi.fn();
  const { container } = render(<InfinitePhotoWall items={items} paused={false} onOpen={onOpen} />);
  const viewport = screen.getByLabelText(/照片牆，可拖曳/);
  const photo = screen.getByRole("button", { name: "放大：迎新・照片 0" });
  const plane = container.querySelector<HTMLElement>(".infinite-wall-plane")!;
  const initial = plane.style.transform;
  fireEvent.pointerDown(photo, { pointerId: 1, clientX: 400, clientY: 300, button: 0 });
  fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 200, clientY: 100 });
  const afterFirstMove = plane.style.transform;
  fireEvent.lostPointerCapture(photo, { pointerId: 1 });
  fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 100, clientY: 50 });
  expect(plane.style.transform).not.toBe(afterFirstMove);
  fireEvent.pointerUp(viewport, { pointerId: 1 });
  fireEvent.click(photo, { detail: 1 });
  expect(plane.style.transform).not.toBe(initial);
  expect(onOpen).not.toHaveBeenCalled();
  fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 200, clientY: 200 });
  fireEvent.pointerDown(viewport, { pointerId: 2, clientX: 300, clientY: 200 });
  fireEvent.pointerMove(viewport, { pointerId: 2, clientX: 400, clientY: 200 });
  expect(screen.getByLabelText("縮放比例")).toHaveTextContent("200%");
  fireEvent.pointerCancel(viewport, { pointerId: 1 });
  fireEvent.click(photo, { detail: 0 });
  expect(onOpen).toHaveBeenCalledOnce();
});

it("pauses wheel and zoom controls while the full screen viewer is open", () => {
  const { container } = render(<InfinitePhotoWall items={items} paused onOpen={vi.fn()} />);
  const viewport = screen.getByLabelText(/照片牆，可拖曳/);
  const plane = container.querySelector<HTMLElement>(".infinite-wall-plane")!;
  const initial = plane.style.transform;
  fireEvent.wheel(viewport, { deltaY: 200 });
  fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 400, clientY: 300 });
  fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 100, clientY: 100 });
  expect(plane.style.transform).toBe(initial);
  expect(screen.getByRole("button", { name: "放大照片牆" })).toBeDisabled();
});
