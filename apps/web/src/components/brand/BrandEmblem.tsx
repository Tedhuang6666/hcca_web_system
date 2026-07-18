import Image from "next/image";

import { BRANDING } from "@/lib/branding";

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
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden ${
        framed ? "rounded-xl bg-[#26193d] p-1 shadow-sm" : ""
      } ${className}`}
      style={{ width: size, height: size }}
    >
      <Image
        src={BRANDING.emblemPath}
        alt={BRANDING.emblemAlt}
        width={size}
        height={size}
        priority={priority}
        className="h-full w-full object-contain"
      />
    </span>
  );
}
