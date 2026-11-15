import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { PublicActivityAlbum } from "@/lib/public-activity-albums";
import GalleryCollections from "./GalleryCollections";

vi.mock("./GalleryExperience", () => ({ default: ({ albums }: { albums: PublicActivityAlbum[] }) => <div>{albums.flatMap((album) => album.photos.map((photo) => <span key={photo.id}>{photo.id}</span>))}</div> }));

const albums: PublicActivityAlbum[] = [{ id: "welcome", title: "迎新", summary: "", sourceUrl: "", layout: "spread", photographer: "活動預設", photos: [
  { id: "first", src: "/one.webp", width: 10, height: 10, caption: "", alt: "", featured: true, photographer: "攝影甲", section: "開場" },
  { id: "second", src: "/two.webp", width: 10, height: 10, caption: "", alt: "", featured: true, section: "結尾" },
] }];

it("removes the photographer selector while keeping section filtering", () => {
  render(<GalleryCollections albums={albums} />);
  expect(screen.queryByRole("combobox", { name: "攝影師" })).not.toBeInTheDocument();
  expect(screen.getByText("first")).toBeInTheDocument();
  expect(screen.getByText("second")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("活動環節"), { target: { value: "結尾" } });
  expect(screen.queryByText("first")).not.toBeInTheDocument();
  expect(screen.getByText("second")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "清除篩選" }));
  expect(screen.getByText("first")).toBeInTheDocument();
});

it("omits the filter container when there is only one section", () => {
  render(<GalleryCollections albums={[{ ...albums[0], photos: [albums[0].photos[0]] }]} />);
  expect(screen.queryByRole("form")).not.toBeInTheDocument();
});
