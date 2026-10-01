"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { useRef, useState } from "react";

import { uploadUrl } from "@/lib/config";

export type ArticleGalleryPhoto = {
  url: string;
  description: string;
};

export default function ArticleGallery({ photos }: { photos: ArticleGalleryPhoto[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const photo = photos[activeIndex];
  const imageSrc = uploadUrl(photo?.url);

  if (!photo || !imageSrc) return null;

  const showPrevious = () => {
    setActiveIndex((current) => (current - 1 + photos.length) % photos.length);
  };
  const showNext = () => {
    setActiveIndex((current) => (current + 1) % photos.length);
  };

  return (
    <figure className="article-markdown-gallery" role="region" aria-label="文章圖片集" aria-roledescription="輪播">
      <div
        className="article-markdown-gallery-viewport"
        role="group"
        aria-roledescription="投影片"
        aria-label={`第 ${activeIndex + 1} 張，共 ${photos.length} 張`}
        onTouchStart={(event) => {
          if (event.touches.length !== 1) return;
          touchStartRef.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
        }}
        onTouchEnd={(event) => {
          const start = touchStartRef.current;
          touchStartRef.current = null;
          if (!start || event.changedTouches.length !== 1) return;
          const deltaX = event.changedTouches[0].clientX - start.x;
          const deltaY = event.changedTouches[0].clientY - start.y;
          if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;
          if (deltaX < 0) showNext();
          else showPrevious();
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="article-markdown-gallery-image"
          src={imageSrc}
          alt={photo.description.trim() ? "" : `第 ${activeIndex + 1} 張文章圖片`}
          loading="lazy"
          draggable={false}
        />
      </div>
      <div className="article-markdown-gallery-controls">
        <button type="button" onClick={showPrevious} aria-label="上一張圖片">
          <ArrowLeft size={18} aria-hidden />
        </button>
        <span aria-live="polite" aria-atomic="true">{activeIndex + 1} / {photos.length}</span>
        <button type="button" onClick={showNext} aria-label="下一張圖片">
          <ArrowRight size={18} aria-hidden />
        </button>
      </div>
      <div className="article-markdown-gallery-dots" role="group" aria-label="選擇圖片">
        {photos.map((item, index) => (
          <button
            type="button"
            key={`${item.url}-${index}`}
            aria-label={`顯示第 ${index + 1} 張圖片${item.description.trim() ? `：${item.description}` : ""}`}
            aria-pressed={index === activeIndex}
            onClick={() => setActiveIndex(index)}
          >
            <span aria-hidden="true" />
          </button>
        ))}
      </div>
      {photo.description.trim() && (
        <figcaption className="article-markdown-gallery-caption">{photo.description.trim()}</figcaption>
      )}
    </figure>
  );
}
