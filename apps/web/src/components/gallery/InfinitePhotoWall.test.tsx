import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import InfinitePhotoWall from "./InfinitePhotoWall";
import type { GalleryItem } from "./GalleryViewer";

const disconnect = vi.fn();
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0, time = 0;
let intersect: IntersectionObserverCallback;
const items: GalleryItem[] = Array.from({ length: 80 }, (_, index) => ({
  id: String(index), src: "/photo-" + index + ".webp", alt: "活動照片", caption: "照片 " + index,
  width: 1200, height: 800, featured: true, albumId: "welcome", albumTitle: "迎新", sourceUrl: "", isKeyVisual: false,
}));

const advance = (count = 1) => act(() => {
  for (let index = 0; index < count; index++) {
    const current = [...frames.values()]; frames.clear(); time += 16.667;
    current.forEach((callback) => callback(time));
  }
});
const firstTile = (container: HTMLElement) => container.querySelector<HTMLElement>(".infinite-wall-tile")!;

beforeEach(() => {
  disconnect.mockClear(); frames.clear(); frameId = time = 0;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => frames.delete(id)));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect = disconnect; });
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe() {} disconnect = disconnect;
  });
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number;
    constructor(type: string, options: PointerEventInit = {}) { super(type, options); this.pointerId = options.pointerId ?? 1; }
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 1200, height: 640, right: 1200, bottom: 640, toJSON() {} });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("pans inside the wall, keeps a fixed tile pool, zooms and cleans up the animation", () => {
  const { container, unmount } = render(<InfinitePhotoWall items={items} paused={false} onOpen={vi.fn()} />);
  const viewport = screen.getByLabelText(/照片牆，可拖曳/);
  advance();
  const initial = firstTile(container).style.transform;
  const wheel = new WheelEvent("wheel", { deltaY: 200, bubbles: true, cancelable: true });
  fireEvent(viewport, wheel); advance(12);
  expect(wheel.defaultPrevented).toBe(true);
  expect(firstTile(container).style.transform).not.toBe(initial);
  expect(container.querySelectorAll(".infinite-wall-tile")).toHaveLength(25);
  fireEvent.wheel(viewport, { deltaY: -60, ctrlKey: true }); advance();
  expect(screen.getByLabelText("縮放比例")).not.toHaveTextContent("100%");
  fireEvent.click(screen.getByRole("button", { name: "重設照片牆" })); advance();
  expect(screen.getByLabelText("縮放比例")).toHaveTextContent("100%");
  act(() => intersect([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(frames.size).toBe(0);
  act(() => intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(frames.size).toBe(1);
  unmount();
  expect(frames.size).toBe(0);
  expect(disconnect).toHaveBeenCalledTimes(2);
});

it("supports keyboard exploration and opening a photo", () => {
  const onOpen = vi.fn();
  const { container } = render(<InfinitePhotoWall items={items} paused={false} onOpen={onOpen} />);
  const viewport = screen.getByLabelText(/照片牆，可拖曳/);
  advance(); const initial = firstTile(container).style.transform;
  fireEvent.keyDown(viewport, { key: "ArrowDown" }); advance(12);
  expect(firstTile(container).style.transform).not.toBe(initial);
  fireEvent.keyDown(viewport, { key: "+" }); advance();
  expect(screen.getByLabelText("縮放比例")).toHaveTextContent("125%");
  fireEvent.click(screen.getAllByRole("button", { name: /放大：迎新・照片/ })[0]);
  expect(onOpen).toHaveBeenCalledOnce();
});

it("keeps drag inertia, prevents accidental photo opening and handles pinch zoom", () => {
  const onOpen = vi.fn();
  const { container } = render(<InfinitePhotoWall items={items} paused={false} onOpen={onOpen} />);
  const viewport = screen.getByLabelText(/照片牆，可拖曳/);
  advance();
  const photo = screen.getAllByRole("button", { name: /放大：迎新・照片/ })[0];
  fireEvent.pointerDown(photo, { pointerId: 1, clientX: 400, clientY: 300, button: 0 });
  fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 200, clientY: 100 }); advance();
  fireEvent.lostPointerCapture(photo, { pointerId: 1 });
  fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 100, clientY: 50 }); advance();
  fireEvent.pointerUp(viewport, { pointerId: 1 });
  fireEvent.click(photo, { detail: 1 });
  const released = firstTile(container).style.transform;
  advance(8);
  expect(firstTile(container).style.transform).not.toBe(released);
  expect(onOpen).not.toHaveBeenCalled();
  fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 200, clientY: 200 });
  fireEvent.pointerDown(viewport, { pointerId: 2, clientX: 300, clientY: 200 });
  fireEvent.pointerMove(viewport, { pointerId: 2, clientX: 400, clientY: 200 }); advance();
  expect(screen.getByLabelText("縮放比例")).toHaveTextContent("200%");
  fireEvent.pointerCancel(viewport, { pointerId: 1 });
  fireEvent.click(photo, { detail: 0 });
  expect(onOpen).toHaveBeenCalledOnce();
});

it("pauses movement and controls while the full screen viewer is open", () => {
  const { container } = render(<InfinitePhotoWall items={items} paused onOpen={vi.fn()} />);
  const viewport = screen.getByLabelText(/照片牆，可拖曳/);
  const initial = firstTile(container).style.transform;
  fireEvent.wheel(viewport, { deltaY: 200 });
  fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 400, clientY: 300 });
  fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 100, clientY: 100 }); advance(8);
  expect(firstTile(container).style.transform).toBe(initial);
  expect(screen.getByRole("button", { name: "放大照片牆" })).toBeDisabled();
});

it("repeats a single photo across the original 25 slots with one keyboard stop", () => {
  const { container } = render(<InfinitePhotoWall items={items.slice(0, 1)} paused={false} onOpen={vi.fn()} />);
  advance();
  expect(container.querySelectorAll(".infinite-wall-tile")).toHaveLength(25);
  expect(screen.getAllByRole("button", { name: "放大：迎新・照片 0" }).length).toBeGreaterThan(3);
  expect(container.querySelectorAll('.infinite-wall-tile button[tabindex="0"]')).toHaveLength(1);
});

it("fits repeated frames to the actual image dimensions", async () => {
  const { container } = render(<InfinitePhotoWall items={items.slice(0, 1)} paused={false} onOpen={vi.fn()} />);
  advance();
  const image = screen.getAllByRole("img")[0];
  Object.defineProperties(image, { naturalWidth: { value: 1800 }, naturalHeight: { value: 2400 } });
  fireEvent.load(image);
  await waitFor(() => expect(Number.parseFloat(container.querySelector<HTMLElement>(".infinite-wall-image")!.style.aspectRatio)).toBe(0.75));
  advance();
});
