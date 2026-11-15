"use client";

import Image from "next/image";
import { useState, type Ref } from "react";
import { ImageOff } from "lucide-react";
import { uploadUrl } from "@/lib/config";
import type { GalleryPhoto } from "@/lib/public-activity-albums";
import "./activity-image.css";

/** Keep image failures local: retry the original, then the next photo, then compact text. */
export default function ActivityImage({ photos, sizes, preload = false, fill = false, imageRef, onUnavailable, onDimensions }: {
  photos: GalleryPhoto[];
  sizes: string;
  preload?: boolean;
  fill?: boolean;
  imageRef?: Ref<HTMLImageElement>;
  onUnavailable?: (src: string) => void;
  onDimensions?: (width: number, height: number) => void;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const [originals, setOriginals] = useState<string[]>([]);
  const photo = photos.find((candidate) => !failed.includes(candidate.src));
  if (!photo) return <span className="activity-image-unavailable" role="status">
    <ImageOff size={22} aria-hidden />照片暫時無法顯示
  </span>;

  const src = uploadUrl(photo.src);
  // Uploaded WebP files are already sized and compressed. The optimizer cannot
  // reliably fetch a same-origin /api rewrite in the standalone production server.
  const unoptimized = photo.src.startsWith("/site/public/images/")
    || photo.src.startsWith("/uploads/") || src.startsWith("/api/")
    || /^https?:/.test(src) || originals.includes(photo.src);

  return <Image key={src + unoptimized} ref={imageRef} src={src} alt={photo.alt || photo.caption}
    {...(fill ? { fill: true } : { width: photo.width, height: photo.height })}
    sizes={sizes} preload={preload} draggable={false} unoptimized={unoptimized}
    onLoad={(event) => {
      const { naturalWidth, naturalHeight } = event.currentTarget;
      if (naturalWidth && naturalHeight) onDimensions?.(naturalWidth, naturalHeight);
    }}
    onError={() => {
      if (!unoptimized) setOriginals((current) => [...current, photo.src]);
      else {
        setFailed((current) => [...current, photo.src]);
        onUnavailable?.(photo.src);
      }
    }} />;
}
