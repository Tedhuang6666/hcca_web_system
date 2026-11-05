"use client";

import { useEffect, useRef, useState } from "react";
import { Package } from "lucide-react";

import ShopImage from "./ShopImage";
import styles from "./CatalogImage.module.css";

/** Reserve the card's image area and fetch only within the next screen of scrolling. */
export default function CatalogImage({ src, alt, sizes }: {
  src: string;
  alt: string;
  sizes: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const ready = loadedSrc === src;
  const failed = failedSrc === src;

  useEffect(() => {
    const target = frame.current;
    if (!target) return;
    if (typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setNearViewport(true);
      observer.disconnect();
    }, { rootMargin: "600px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={frame} className={styles.frame} data-state={failed ? "error" : ready ? "ready" : "loading"} aria-busy={!ready && !failed}>
      <span className={styles.placeholder} aria-hidden="true">
        <Package size={26} strokeWidth={1.2} />
        <span>{failed ? "圖片暫時無法載入" : "圖片載入中"}</span>
      </span>
      {nearViewport && !failed && (
        <ShopImage
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          loading="lazy"
          className={styles.image}
          onLoad={() => setLoadedSrc(src)}
          onError={() => setFailedSrc(src)}
        />
      )}
    </div>
  );
}
