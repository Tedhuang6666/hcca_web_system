import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GalleryExperience from "./GalleryExperience";
import { readActivityAlbums } from "@/lib/public-activity-albums";

vi.mock("./useGalleryMotion", () => ({ useGalleryMotion: vi.fn() }));
const observers: { callback: IntersectionObserverCallback; targets: Element[]; disconnect: ReturnType<typeof vi.fn> }[] = [];

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  observers.length = 0;
  vi.stubGlobal("IntersectionObserver", class {
    targets: Element[] = [];
    disconnect = vi.fn();
    constructor(public callback: IntersectionObserverCallback) { observers.push(this); }
    observe(target: Element) { this.targets.push(target); }
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  window.history.replaceState(null, "", "/gallery");
});
afterEach(() => vi.unstubAllGlobals());

describe("影像紀事", () => {
  it("distinguishes unavailable activity data from an empty selection", () => {
    render(<GalleryExperience albums={[]} unavailable />);
    expect(screen.getByRole("alert")).toHaveTextContent("無法載入活動影像");
    expect(screen.queryByText("活動紀錄整理中。")).not.toBeInTheDocument();
  });
  it("filters every stage to one activity without asking visitors to select a display mode", () => {
    const first = readActivityAlbums({})[0];
    const second = { ...first, id: "preparation", title: "籌備紀錄", photos: first.photos.map((photo) => ({ ...photo, id: photo.id + "-2" })) };
    render(<GalleryExperience albums={[first, second]} />);
    fireEvent.change(screen.getByRole("combobox", { name: "選擇活動" }), { target: { value: second.id } });
    expect(screen.getByRole("heading", { level: 2, name: "籌備紀錄" })).toBeVisible();
    expect(screen.queryByRole("heading", { level: 2, name: "迎新" })).not.toBeInTheDocument();
    expect(window.location.search).toBe("?event=preparation");
    expect(screen.getByRole("region", { name: "無邊影像" })).toBeVisible();
    expect(screen.getByRole("region", { name: "全部活動照片" })).toBeVisible();
    expect(screen.queryByRole("group", { name: "展示方式" })).not.toBeInTheDocument();
    const wall = screen.getByRole("region", { name: "無邊影像" });
    expect(within(wall).getAllByRole("button", { name: /放大：籌備紀錄/ })).toHaveLength(25);
    expect(within(wall).queryByRole("button", { name: /放大：迎新/ })).not.toBeInTheDocument();
  });

  it("opens photos, switches images and closes the accessible viewer", () => {
    render(<GalleryExperience albums={readActivityAlbums({})} detail />);
    fireEvent.click(screen.getAllByRole("button", { name: /放大：迎新/ })[0]);
    const viewer = screen.getByRole("dialog", { name: "全螢幕照片檢視" });
    expect(within(viewer).getByText("1 / 3")).toBeVisible();
    fireEvent.click(within(viewer).getByRole("button", { name: "下一張照片" }));
    expect(within(viewer).getByText("2 / 3")).toBeVisible();
    fireEvent.click(within(viewer).getByRole("button", { name: "關閉照片" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("preserves key art and makes unfeatured photos available in the continuous contact sheet", () => {
    const event = readActivityAlbums({})[0];
    event.photos.push({ ...event.photos[0], id: "unfeatured", featured: false });
    event.keyVisual = { ...event.photos[0], id: "key-visual", alt: "測試活動主視覺", photographer: "設計署名" };
    render(<GalleryExperience albums={[event]} detail />);
    expect(screen.getByText("活動主視覺")).toBeVisible();
    expect(screen.getAllByAltText("測試活動主視覺")[0]).toBeVisible();
    const contactSheet = screen.getByRole("region", { name: "全部活動照片" });
    expect(contactSheet.querySelector('[data-gallery-photo="unfeatured"]')).toBeVisible();
    expect(within(contactSheet).getAllByRole("button", { name: /放大：迎新/ })).toHaveLength(5);
    expect(screen.queryByRole("button", { name: /瀏覽全部照片/ })).not.toBeInTheDocument();
  });

  it("opens with a real photo and replaces a failed cover with another photo from the event", () => {
    const event = readActivityAlbums({})[0];
    event.keyVisual = { ...event.photos[0], id: "poster", src: "/site/public/images/poster.webp", alt: "活動海報" };
    const { container } = render(<GalleryExperience albums={[event]} detail />);
    const cover = () => container.querySelector<HTMLImageElement>(".archive-opening-photo img")!;
    expect(cover()).toHaveAttribute("alt", event.photos[0].alt);
    fireEvent.error(cover());
    fireEvent.error(cover());
    expect(cover()).toHaveAttribute("alt", event.photos[1].alt);
    expect(screen.queryByRole("button", { name: /瀏覽全部照片/ })).not.toBeInTheDocument();
  });

  it("loads the next batch automatically and disconnects its observers on unmount", () => {
    const album = readActivityAlbums({})[0];
    album.photos = Array.from({ length: 80 }, (_, index) => ({ ...album.photos[index % 3], id: "photo-" + index }));
    const { unmount } = render(<GalleryExperience albums={[album]} />);
    const sheet = screen.getByRole("region", { name: "全部活動照片" });
    expect(within(sheet).getAllByRole("button", { name: /放大：/ })).toHaveLength(36);
    const observer = observers.find((entry) => entry.targets.some((target) => target.className === "archive-load-more"))!;
    act(() => observer.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(within(sheet).getAllByRole("button", { name: /放大：/ })).toHaveLength(72);
    expect(observer.disconnect).toHaveBeenCalled();
    unmount();
    expect(observers.every((entry) => entry.disconnect.mock.calls.length > 0)).toBe(true);
  });

  it("resolves a shared photo inside the initially selected event and restores focus after closing", () => {
    const first = readActivityAlbums({})[0];
    const second = { ...first, id: "second", title: "第二場活動" };
    render(<GalleryExperience albums={[first, second]} initialEvent="second" initialPhoto={second.photos[1].id} />);
    const viewer = screen.getByRole("dialog");
    expect(within(viewer).getByText("2 / 3")).toBeVisible();
    expect(within(viewer).getByText(/第二場活動/)).toBeVisible();
    fireEvent.click(within(viewer).getByRole("button", { name: "放大檢視" }));
    expect(within(viewer).getByRole("button", { name: "縮小照片" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(viewer).getByRole("button", { name: "關閉照片" }));
    const origin = screen.getAllByRole("button", { name: /放大：第二場活動/ })[0];
    fireEvent.click(origin);
    fireEvent.click(screen.getByRole("button", { name: "關閉照片" }));
    expect(origin).toHaveFocus();
  });
});
