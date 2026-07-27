import Image from "next/image";

const OPTIMIZABLE_HOSTS = new Set(["hcca.buckets.hct.works"]);

function canOptimize(src: string) {
  if (src.startsWith("/")) return true;

  try {
    return OPTIMIZABLE_HOSTS.has(new URL(src).hostname);
  } catch {
    return false;
  }
}

export default function PublicEmblem({
  src,
  alt,
  className,
  sizes,
  priority = false,
  variant = "default",
}: {
  src: string;
  alt: string;
  className?: string;
  sizes: string;
  priority?: boolean;
  variant?: "default" | "small";
}) {
  const resolvedSrc = variant === "small" && src === "/brand/hcca-emblem-512.png"
    ? "/brand/hcca-emblem-192.png"
    : src;
  const sourceSize = variant === "small" ? 192 : 512;

  if (canOptimize(resolvedSrc)) {
    return (
      <Image
        src={resolvedSrc}
        alt={alt}
        width={sourceSize}
        height={sourceSize}
        sizes={sizes}
        priority={priority}
        fetchPriority={priority ? "high" : "auto"}
        className={className}
      />
    );
  }

  // 後台允許貼上任意圖片網址；未列入 Next Image 白名單時仍維持相容性。
  // 明確尺寸可避免載入後版面位移，fetchPriority 讓首屏自訂會徽保持可見優先級。
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={resolvedSrc}
      alt={alt}
      width={sourceSize}
      height={sourceSize}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : "auto"}
      className={className}
    />
  );
}
