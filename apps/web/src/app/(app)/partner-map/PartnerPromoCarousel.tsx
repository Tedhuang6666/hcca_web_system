"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { apiUrl } from "@/lib/config";

export type PartnerPromoImage = {
  id: string;
  image_url: string;
  filename?: string | null;
  sort_order?: number;
};

export default function PartnerPromoCarousel({
  images,
  businessName,
}: {
  images: PartnerPromoImage[];
  businessName: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    setActiveIndex((current) => (images.length ? current % images.length : 0));
  }, [images.length]);

  const move = useCallback((delta: number) => {
    setActiveIndex((current) => {
      if (images.length <= 1) return 0;
      return (current + delta + images.length) % images.length;
    });
  }, [images.length]);

  useEffect(() => {
    if (images.length <= 1 || isPaused || prefersReducedMotion) return;
    const timer = window.setInterval(() => move(1), 5000);
    return () => window.clearInterval(timer);
  }, [images.length, isPaused, move, prefersReducedMotion]);

  if (!images.length) return null;
  const safeActiveIndex = activeIndex % images.length;
  const activeImage = images[safeActiveIndex];

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    touchStartX.current = event.changedTouches[0]?.clientX ?? null;
    setIsPaused(true);
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const startX = touchStartX.current;
    touchStartX.current = null;
    setIsPaused(false);
    if (startX === null) return;
    const endX = event.changedTouches[0]?.clientX;
    if (endX === undefined) return;
    const distance = endX - startX;
    if (Math.abs(distance) < 40) return;
    move(distance < 0 ? 1 : -1);
  };

  return (
    <section aria-label={`${businessName} 宣傳圖`}>
      <div
        className="relative overflow-hidden rounded-lg border"
        style={{ borderColor: "var(--border)", background: "var(--bg-elevated)", touchAction: "pan-y" }}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onFocus={() => setIsPaused(true)}
        onBlur={() => setIsPaused(false)}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <a
          href={apiUrl(activeImage.image_url)}
          target="_blank"
          rel="noreferrer"
          aria-label={`開啟${businessName}宣傳圖 ${safeActiveIndex + 1}`}
          className="block"
        >
          <Image
            key={activeImage.id}
            src={apiUrl(activeImage.image_url)}
            alt={`${businessName} 宣傳圖 ${safeActiveIndex + 1}`}
            width={640}
            height={420}
            loading="lazy"
            sizes="(min-width: 640px) 384px, calc(100vw - 2rem)"
            className="h-52 w-full object-contain sm:h-64"
          />
        </a>
        {images.length > 1 && (
          <>
            <button
              type="button"
              className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border bg-black/55 text-white transition-colors hover:bg-black/75 focus-visible:outline-2 focus-visible:outline-offset-2"
              onClick={() => move(-1)}
              aria-label="上一張宣傳圖"
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border bg-black/55 text-white transition-colors hover:bg-black/75 focus-visible:outline-2 focus-visible:outline-offset-2"
              onClick={() => move(1)}
              aria-label="下一張宣傳圖"
            >
              <ChevronRight size={20} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
      {images.length > 1 && (
        <div className="mt-2 flex items-center justify-center gap-1.5" role="tablist" aria-label="宣傳圖分頁">
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              role="tab"
              aria-selected={index === safeActiveIndex}
              aria-label={`第 ${index + 1} 張宣傳圖`}
              onClick={() => setActiveIndex(index)}
              className="flex h-8 w-8 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <span
                className="h-2 w-2 rounded-full transition-colors"
                style={{ background: index === safeActiveIndex ? "var(--primary)" : "var(--border-strong)" }}
              />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
