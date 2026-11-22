import Image from "next/image";

const OPTIMIZABLE_HOSTS = new Set(["hcca.buckets.hct.works"]);

const STATIC_EMBLEM_ASSETS = {
  default: {
    avif: "/brand/hcca-emblem-320.avif",
    webp: "/brand/hcca-emblem-320.webp",
    size: 320,
  },
  small: {
    avif: "/brand/hcca-emblem-64.avif",
    webp: "/brand/hcca-emblem-64.webp",
    size: 64,
  },
} as const;

function getStaticAsset(src: string, variant: "default" | "small") {
  const size = STATIC_EMBLEM_ASSETS[variant].size;
  const staticPaths = new Set([
    `/brand/hcca-emblem-${size}.avif`,
    `/brand/hcca-emblem-${size}.webp`,
  ]);
  if (staticPaths.has(src) || src === "/brand/hcca-emblem-512.png") {
    return STATIC_EMBLEM_ASSETS[variant];
  }
  return null;
}

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
  const staticAsset = getStaticAsset(src, variant);
  const sourceSize = staticAsset?.size ?? (variant === "small" ? 192 : 512);

  if (staticAsset) {
    return (
      <picture>
        <source type="image/avif" srcSet={staticAsset.avif} />
        <img
          src={staticAsset.webp}
          alt={alt}
          width={sourceSize}
          height={sourceSize}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          className={className}
        />
      </picture>
    );
  }

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
