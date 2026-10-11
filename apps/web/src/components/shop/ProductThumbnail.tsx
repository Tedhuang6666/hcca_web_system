"use client";

import { useState } from "react";
import { uploadUrl } from "@/lib/config";

export default function ProductThumbnail({ url, size = 44 }: {
  url: string | null | undefined;
  size?: number;
}) {
  const src = uploadUrl(url);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-lg"
        style={{
          width: size,
          height: size,
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
        }}
        aria-hidden="true"
      >
        <svg
          width={size * 0.4}
          height={size * 0.4}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          style={{ color: "var(--text-disabled)" }}
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-3.6-3.6a2 2 0 0 0-2.8 0L6 21" />
        </svg>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className="shrink-0 rounded-lg object-cover"
      style={{ width: size, height: size, border: "1px solid var(--border)" }}
      onError={() => setFailedSrc(src)}
    />
  );
}
