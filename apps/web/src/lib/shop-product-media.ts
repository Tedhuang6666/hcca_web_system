import type { ProductOut } from "@/lib/types";

export interface ProductGalleryImage {
  image_url: string;
  thumbnail_url: string;
  label: string;
  caption: string;
}

/** 主圖保留標註；同一圖片只列一次，選項圖片也能手動切換。 */
export function productGallery(product: ProductOut): ProductGalleryImage[] {
  const images: ProductGalleryImage[] = [];
  const media = product.media ?? [];
  const add = (url: string, label: string, thumbnail = url, caption = "") => {
    if (!images.some((image) => image.image_url === url)) {
      images.push({ image_url: url, thumbnail_url: thumbnail, label, caption });
    }
  };
  const mediaLabel = (item: ProductOut["media"][number], index: number) =>
    item.label?.trim() || (item.kind === "model" ? `模特兒宣傳照 ${index + 1}` : `商品照片 ${index + 1}`);
  if (product.image_url) {
    const coverIndex = media.findIndex((item) => item.image_url === product.image_url);
    add(product.image_url, coverIndex < 0 ? "商品主圖" : mediaLabel(media[coverIndex], coverIndex),
      product.image_url, media[coverIndex]?.label?.trim() ?? "");
  }
  media.forEach((item, index) =>
    add(item.image_url, mediaLabel(item, index), item.image_url, item.label?.trim() ?? ""));
  (product.variant_groups ?? []).forEach((group) => group.options.forEach((option) => {
    if (option.is_active && option.image_url) {
      add(option.image_url, option.value, option.image_url, option.value);
    }
  }));
  return images;
}
