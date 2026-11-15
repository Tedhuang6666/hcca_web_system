import { siteApi } from "@/lib/api";
import type { GalleryPhoto } from "@/lib/public-activity-albums";

/** 只上傳網站用圖，移除相機 metadata；序列處理避免多張大圖同時解碼。 */
export async function uploadGalleryPhoto(file: File, photographer?: string): Promise<GalleryPhoto> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("僅支援 JPEG、PNG 與 WebP");
  }
  if (file.size > 30 * 1024 * 1024) throw new Error("單張照片不可超過 30 MB");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("無法處理圖片，請換一張後重試");
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error("無法轉換圖片")),
      "image/webp", 0.86,
    ));
    const converted = new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" });
    const uploaded = await siteApi.uploadImage(converted);
    return {
      id: crypto.randomUUID(), src: uploaded.url, width, height,
      alt: "", caption: "", photographer: photographer?.trim() || undefined, featured: true,
    };
  } finally {
    bitmap.close();
  }
}
