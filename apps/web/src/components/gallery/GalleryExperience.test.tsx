import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GalleryExperience from "./GalleryExperience";
import { readActivityAlbums } from "@/lib/public-activity-albums";

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  window.history.replaceState(null, "", "/gallery");
});
afterEach(() => vi.unstubAllGlobals());

describe("影像紀事", () => {
  it("distinguishes unavailable activity data from an empty gallery", () => {
    render(<GalleryExperience albums={[]} unavailable />);
    expect(screen.getByRole("alert")).toHaveTextContent("無法載入活動影像");
    expect(screen.queryByText("活動紀錄整理中。")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "活動照片牆" })).not.toBeInTheDocument();
  });

  it("renders an empty gallery without a photo wall", () => {
    render(<GalleryExperience albums={[]} />);
    expect(screen.getByText("活動紀錄整理中。")).toBeVisible();
    expect(screen.queryByRole("region", { name: "活動照片牆" })).not.toBeInTheDocument();
  });

  it("keeps the opening and one photo wall, removes the extra sections and filters by activity", () => {
    const first = readActivityAlbums({})[0];
    const second = { ...first, id: "preparation", title: "籌備紀錄", photos: first.photos.map((photo) => ({ ...photo, id: photo.id + "-2" })) };
    const { container } = render(<GalleryExperience albums={[first, second]} />);
    expect(within(screen.getByRole("region", { name: "活動照片牆" })).getAllByRole("button", { name: /放大：/ })).toHaveLength(6);
    expect(screen.getAllByRole("region", { name: "活動照片牆" })).toHaveLength(1);
    expect(container.querySelector(".archive-masthead")).not.toBeNull();
    expect(container.querySelector(".archive-stories, .archive-all-photos, .archive-key-visual")).toBeNull();
    expect(screen.queryByText(/HCCA \/|照片沒有邊界|SELECTED MOMENTS/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "選擇活動" }), { target: { value: second.id } });
    expect(screen.getByText("3 張照片")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "活動照片牆" })).getAllByRole("button", { name: /放大：籌備紀錄/ })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /放大：迎新/ })).not.toBeInTheDocument();
    expect(window.location.search).toBe("?event=preparation");
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

  it("puts key art in the center of the opening and unfeatured photos in the wall", () => {
    const event = readActivityAlbums({})[0];
    event.photos.push({ ...event.photos[0], id: "duplicate" });
    event.photos.push({ ...event.photos[0], id: "unfeatured", src: "/unfeatured.webp", featured: false });
    event.keyVisual = { ...event.photos[0], id: "key-visual", src: "/poster.webp", alt: "測試活動主視覺", photographer: "設計署名" };
    const { container } = render(<GalleryExperience albums={[event]} detail />);
    expect(container.querySelector(".archive-opening-photo img")).toHaveAttribute("alt", "測試活動主視覺");
    expect(within(screen.getByRole("region", { name: "活動照片牆" })).queryByAltText("測試活動主視覺")).not.toBeInTheDocument();
    expect(container.querySelector('[data-gallery-photo="unfeatured"]')).toBeVisible();
    expect(container.querySelector('[data-gallery-photo="duplicate"]')).toBeNull();
    expect(within(screen.getByRole("region", { name: "活動照片牆" })).getAllByRole("button", { name: /放大：迎新/ })).toHaveLength(4);
    expect(screen.queryByText("每一個片刻")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "活動主視覺" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /原始活動相簿/ })).toHaveAttribute("href", event.sourceUrl);
  });

  it("keeps a failed image local without removing the rest of the wall", () => {
    render(<GalleryExperience albums={readActivityAlbums({})} />);
    const wall = screen.getByRole("region", { name: "活動照片牆" });
    const photo = within(wall).getAllByRole("button", { name: /放大：迎新/ })[0];
    fireEvent.error(within(photo).getByRole("img"));
    fireEvent.error(within(photo).getByRole("img"));
    expect(within(photo).getByRole("status")).toHaveTextContent("照片暫時無法顯示");
    expect(within(wall).getAllByRole("img")).toHaveLength(2);
  });

  it("falls back to an activity photo when the opening key visual fails", () => {
    const album = readActivityAlbums({})[0];
    album.keyVisual = { ...album.photos[0], id: "poster", src: "/site/public/images/poster.webp", alt: "活動主視覺海報" };
    const { container } = render(<GalleryExperience albums={[album]} detail />);
    const cover = () => container.querySelector<HTMLImageElement>(".archive-opening-photo img")!;
    expect(cover()).toHaveAttribute("alt", "活動主視覺海報");
    fireEvent.error(cover());
    expect(cover()).toHaveAttribute("alt", album.photos[0].alt);
  });

  it("sizes the opening frame from the loaded image instead of stale poster dimensions", async () => {
    const album = readActivityAlbums({})[0];
    album.keyVisual = { ...album.photos[0], id: "poster", src: "/poster.webp", width: 1800, height: 3200 };
    const { container } = render(<GalleryExperience albums={[album]} detail />);
    const image = container.querySelector<HTMLImageElement>(".archive-opening-photo img")!;
    Object.defineProperties(image, { naturalWidth: { value: 1800 }, naturalHeight: { value: 2400 } });
    fireEvent.load(image);
    await waitFor(() => expect(container.querySelector<HTMLElement>(".archive-opening-scene")!.style.getPropertyValue("--opening-ratio")).toBe("0.75"));
    expect(container.querySelector<HTMLElement>(".archive-opening-photo .archive-photo-media")!.style.aspectRatio).toBe("");
  });

  it("preserves a poster-only activity without creating an empty photo wall", () => {
    const album = readActivityAlbums({})[0];
    album.keyVisual = { ...album.photos[0], id: "poster" };
    album.photos = [];
    const { container } = render(<GalleryExperience albums={[album]} detail />);
    expect(container.querySelector(".archive-opening-photo img")).toBeVisible();
    expect(screen.queryByRole("region", { name: "活動照片牆" })).not.toBeInTheDocument();
    expect(screen.queryByText("活動紀錄整理中。")).not.toBeInTheDocument();
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
