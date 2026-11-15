import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { PublicActivityAlbum } from "@/lib/public-activity-albums";
import GalleryCollections from "./GalleryCollections";

vi.mock("./GalleryExperience", () => ({ default: ({ albums }: { albums: PublicActivityAlbum[] }) => <div>{albums.flatMap((album) => album.photos.map((photo) => <span key={photo.id}>{photo.id}</span>))}</div> }));

it("filters photos by photographer and section and can clear an empty result", () => {
  render(<GalleryCollections albums={[{ id: "welcome", title: "迎新", summary: "", sourceUrl: "", layout: "spread", photographer: "活動預設", photos: [
    { id: "first", src: "/one.webp", width: 10, height: 10, caption: "", alt: "", featured: true, photographer: "攝影甲", section: "開場" },
    { id: "second", src: "/two.webp", width: 10, height: 10, caption: "", alt: "", featured: true, section: "結尾" },
  ] }]} />);
  fireEvent.change(screen.getByLabelText("攝影師"), { target: { value: "攝影甲" } });
  expect(screen.getByText("first")).toBeInTheDocument();
  expect(screen.queryByText("second")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("活動環節"), { target: { value: "結尾" } });
  expect(screen.getByRole("status")).toHaveTextContent("沒有符合條件的照片");
  fireEvent.click(screen.getByRole("button", { name: "清除篩選" }));
  expect(screen.getByText("second")).toBeInTheDocument();
});
