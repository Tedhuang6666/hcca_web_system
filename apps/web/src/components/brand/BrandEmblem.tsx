import { BRANDING } from "@/lib/branding";

const STATIC_EMBLEM_ASSETS = {
  small: {
    avif: "/brand/hcca-emblem-64.avif",
    webp: "/brand/hcca-emblem-64.webp",
    sourceSize: 64,
  },
  default: {
    avif: "/brand/hcca-emblem-320.avif",
    webp: "/brand/hcca-emblem-320.webp",
    sourceSize: 320,
  },
} as const;

type BrandEmblemProps = {
  className?: string;
  size?: number;
  priority?: boolean;
  framed?: boolean;
};

export default function BrandEmblem({
  className = "",
  size = 40,
  priority = false,
  framed = false,
}: BrandEmblemProps) {
  const asset = size <= 64 ? STATIC_EMBLEM_ASSETS.small : STATIC_EMBLEM_ASSETS.default;

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden ${
        framed ? "rounded-xl bg-[#1f3a5f] p-1 shadow-sm" : ""
      } ${className}`}
      style={{ width: size, height: size }}
    >
      <picture>
        <source type="image/avif" srcSet={asset.avif} />
        <img
          src={asset.webp}
          alt={BRANDING.emblemAlt}
          width={asset.sourceSize}
          height={asset.sourceSize}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          className="h-full w-full object-contain"
        />
      </picture>
    </span>
  );
}
