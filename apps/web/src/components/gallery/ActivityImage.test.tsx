import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ActivityImage from "./ActivityImage";
import { readActivityAlbums } from "@/lib/public-activity-albums";

const photos = readActivityAlbums({})[0].photos;

describe("活動圖片容錯", () => {
  it("loads uploaded key art directly without the failing same-origin optimizer", () => {
    render(<ActivityImage photos={[{ ...photos[0], src: "/site/public/images/public-site/key.webp" }]} sizes="100vw" />);
    expect(screen.getByRole("img")).toHaveAttribute("src", new URL("/api/site/public/images/public-site/key.webp", window.location.origin).href);
    expect(screen.getByRole("img")).not.toHaveAttribute("srcset");
  });

  it("retries the original when optimization fails, then uses the next event photo", () => {
    render(<ActivityImage photos={photos} sizes="100vw" />);
    expect(screen.getByRole("img").getAttribute("src")).toContain("/_next/image");
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("img")).toHaveAttribute("src", new URL(photos[0].src, window.location.origin).href);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("img")).toHaveAttribute("alt", photos[1].alt);
  });

  it("replaces failed images with compact status text instead of a broken image", () => {
    render(<ActivityImage photos={[{ ...photos[0], src: "https://example.com/missing.webp" }]} sizes="100vw" />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("照片暫時無法顯示");
  });
});
