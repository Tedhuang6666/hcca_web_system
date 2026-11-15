import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GalleryExperience from "./GalleryExperience";
import { readActivityAlbums } from "@/lib/public-activity-albums";

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  window.history.replaceState(null, "", "/gallery");
});

describe("影像紀事", () => {
  it("distinguishes unavailable activity data from an empty selection", () => {
    render(<GalleryExperience albums={[]} unavailable />);
    expect(screen.getByRole("alert")).toHaveTextContent("無法載入活動影像");
    expect(screen.queryByText("活動紀錄整理中。")).not.toBeInTheDocument();
  });
  it("filters the collective selection to one activity and supports a flat photo overview", () => {
    const first = readActivityAlbums({})[0];
    const second = { ...first, id: "preparation", title: "籌備紀錄", photos: first.photos.map((photo) => ({ ...photo, id: photo.id + "-2" })) };
    render(<GalleryExperience albums={[first, second]} />);
    fireEvent.change(screen.getByRole("combobox", { name: "選擇活動" }), { target: { value: second.id } });
    expect(screen.getByRole("heading", { level: 2, name: "籌備紀錄" })).toBeVisible();
    expect(screen.queryByRole("heading", { level: 2, name: "迎新" })).not.toBeInTheDocument();
    expect(window.location.search).toBe("?event=preparation");
    fireEvent.click(screen.getByRole("button", { name: "照片總覽" }));
    expect(screen.getByRole("region", { name: "全部影像總覽" })).toBeVisible();
    expect(screen.getByRole("button", { name: "照片總覽" })).toHaveAttribute("aria-pressed", "true");
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

  it("shows event key art prominently and expands the complete contact sheet on request", () => {
    const event = readActivityAlbums({})[0];
    event.photos.push({ ...event.photos[0], id: "unfeatured", featured: false });
    event.keyVisual = { ...event.photos[0], id: "key-visual", alt: "測試活動主視覺", photographer: "設計署名" };
    render(<GalleryExperience albums={[event]} detail />);
    expect(screen.getByText("活動主視覺")).toBeVisible();
    expect(screen.getByAltText("測試活動主視覺")).toBeVisible();
    const toggle = screen.getByRole("button", { name: /瀏覽全部照片/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: /收起全部照片/ })).toHaveAttribute("aria-expanded", "true");
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
});
