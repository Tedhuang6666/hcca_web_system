"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";

type ShopImageProps = Omit<ImageProps, "src" | "loader" | "unoptimized"> & {
  src: string;
  fallbackToOriginal?: boolean;
};

/** 商品公開圖片依顯示尺寸載入；縮圖服務失敗時只回退原圖一次。 */
export default function ShopImage({ src, alt, onError, fallbackToOriginal = true, ...props }: ShopImageProps) {
  const [originalSrc, setOriginalSrc] = useState<string | null>(null);
  // 歷史商品可使用外部圖床；未在 Next allowlist 的來源保留直接載入。
  const optimizable = src.startsWith("/api/uploads/shop/")
    || src.startsWith("https://hcca.buckets.hct.works/");
  const unoptimized = !optimizable || originalSrc === src;

  return (
    <Image
      {...props}
      src={src}
      alt={alt}
      unoptimized={unoptimized}
      decoding="async"
      onError={(event) => {
        if (!unoptimized && fallbackToOriginal) setOriginalSrc(src);
        else onError?.(event);
      }}
    />
  );
}
