import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import ShopImage from "./ShopImage";
import ProductThumbnail from "./ProductThumbnail";

const src = "/api/uploads/shop/front.png";

it("公開商品圖使用指定尺寸的縮圖，優化失敗只回退原圖一次", () => {
  const onError = vi.fn();
  const { rerender } = render(<ShopImage src={src} alt="商品" width={64} height={64} sizes="64px" onError={onError} />);
  const image = screen.getByRole("img", { name: "商品" });
  expect(image).toHaveAttribute("sizes", "64px");
  expect(image).toHaveAttribute("decoding", "async");
  expect(image.getAttribute("src")).toContain("/_next/image?");

  fireEvent.error(image);
  expect(image).toHaveAttribute("src", src);
  expect(image).not.toHaveAttribute("srcset");
  expect(onError).not.toHaveBeenCalled();
  fireEvent.error(image);
  expect(onError).toHaveBeenCalledOnce();
  expect(image).toHaveAttribute("src", src);

  rerender(<ShopImage src="/api/uploads/shop/back.png" alt="商品" width={64} height={64} sizes="64px" onError={onError} />);
  expect(image.getAttribute("src")).toContain("/_next/image?");
});

it("歷史外部圖床維持直接載入，失敗交給既有錯誤狀態", () => {
  const onError = vi.fn();
  const url = "https://legacy.example.com/photo.jpg";
  render(<ShopImage src={url} alt="舊商品" width={64} height={64} onError={onError} />);
  const image = screen.getByRole("img", { name: "舊商品" });
  expect(image).toHaveAttribute("src", url);
  fireEvent.error(image);
  expect(onError).toHaveBeenCalledOnce();
});

it("管理縮圖延後載入，原圖也失敗才顯示佔位，換圖後可恢復", () => {
  const { rerender } = render(<ProductThumbnail url="/uploads/shop/front.png" alt="商品" size={44} />);
  const image = screen.getByRole("img", { name: "商品" });
  expect(image).toHaveAttribute("loading", "lazy");
  expect(image).toHaveAttribute("sizes", "44px");
  fireEvent.error(image);
  expect(screen.getByRole("img", { name: "商品" })).toHaveAttribute("src", src);
  fireEvent.error(image);
  expect(screen.queryByRole("img", { name: "商品" })).not.toBeInTheDocument();
  rerender(<ProductThumbnail url="/uploads/shop/back.png" alt="商品" size={44} />);
  expect(screen.getByRole("img", { name: "商品" }).getAttribute("src")).toContain("/_next/image?");
});
