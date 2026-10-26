import Image from "next/image";
import { uploadUrl } from "@/lib/config";

type SafeImagePreviewProps = {
  url: string;
  alt: string;
  className: string;
  height: number;
};

export default function SafeImagePreview({
  url,
  alt,
  className,
  height,
}: SafeImagePreviewProps) {
  const src = uploadUrl(url);
  if (!src) return null;
  return (
    <Image
      src={src}
      alt={alt}
      width={640}
      height={height}
      unoptimized
      className={className}
    />
  );
}
