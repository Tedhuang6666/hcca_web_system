"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { uploadUrl } from "@/lib/config";

type SurveyImageViewerProps = {
  images: string[];
  optionLabel: string;
  compact?: boolean;
  gallery?: SurveyImageGalleryItem[];
  onSelect?: (optionIndex: number) => void;
  selectedOptionIndexes?: number[];
};

export type SurveyImageGalleryItem = {
  image: string;
  optionLabel: string;
  optionIndex: number;
};

/** 顯示選項的圖稿縮圖，並提供適合觸控裝置的完整圖片檢視。 */
export default function SurveyImageViewer({
  images,
  optionLabel,
  compact = false,
  gallery,
  onSelect,
  selectedOptionIndexes = [],
}: SurveyImageViewerProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const touchStartX = useRef<number | null>(null);
  const allImages = gallery?.length
    ? gallery
    : images.map((image) => ({ image, optionLabel, optionIndex: 0 }));
  const activeItem = activeIndex === null ? null : allImages[activeIndex];

  const goToPrevious = () => setActiveIndex((current) => {
    if (current === null) return current;
    return Math.max(current - 1, 0);
  });
  const goToNext = () => setActiveIndex((current) => {
    if (current === null) return current;
    return Math.min(current + 1, allImages.length - 1);
  });

  useEffect(() => {
    if (activeIndex === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveIndex(null);
      if (event.key === "ArrowRight") setActiveIndex((current) => {
        if (current === null) return current;
        return Math.min(current + 1, allImages.length - 1);
      });
      if (event.key === "ArrowLeft") setActiveIndex((current) => {
        if (current === null) return current;
        return Math.max(current - 1, 0);
      });
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [activeIndex, allImages.length]);

  if (images.length === 0) return null;

  const preventImageSave = (event: SyntheticEvent) => event.preventDefault();

  return (
    <>
      <div className={compact ? "flex items-center gap-1" : images.length === 1 ? "mt-3 max-w-md" : "mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3"}>
        {images.map((image, index) => (
          <button
            key={image}
            type="button"
            onClick={() => {
              const galleryIndex = allImages.findIndex((item) => item.image === image && item.optionLabel === optionLabel);
              setActiveIndex(galleryIndex >= 0 ? galleryIndex : index);
            }}
            className={`group relative overflow-hidden text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 ${
              compact ? "h-12 w-12 shrink-0 rounded-lg" : "min-h-28 w-full rounded-xl"
            }`}
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
            aria-label={`查看「${optionLabel}」的完整圖片 ${index + 1}`}
          >
            <Image
              src={uploadUrl(image)}
              alt={`「${optionLabel}」圖稿 ${index + 1}`}
              fill
              unoptimized
              draggable={false}
              onContextMenu={preventImageSave}
              onDragStart={preventImageSave}
              sizes={compact ? "48px" : "(max-width: 640px) 46vw, (max-width: 1024px) 30vw, 224px"}
              className="select-none object-contain p-1.5"
            />
          </button>
        ))}
      </div>

      {activeItem && activeIndex !== null && typeof document !== "undefined" && createPortal((
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`「${optionLabel}」完整圖片`}
          onClick={() => setActiveIndex(null)}
        >
          <div
            className="relative flex h-full w-full items-center justify-center"
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => { touchStartX.current = event.changedTouches[0]?.clientX ?? null; }}
            onTouchEnd={(event) => {
              const startX = touchStartX.current;
              const endX = event.changedTouches[0]?.clientX;
              touchStartX.current = null;
              if (startX === null || endX === undefined || Math.abs(endX - startX) < 42) return;
              if (endX < startX) goToNext(); else goToPrevious();
            }}
          >
            <Image
              src={uploadUrl(activeItem.image)}
              alt={`「${activeItem.optionLabel}」完整圖片 ${activeIndex + 1}`}
              width={2400}
              height={2400}
              unoptimized
              priority
              draggable={false}
              onContextMenu={preventImageSave}
              onDragStart={preventImageSave}
              className="max-h-[calc(100dvh-7rem)] max-w-full select-none object-contain"
            />
            {activeIndex > 0 && (
              <button
                type="button"
                onClick={goToPrevious}
                className="absolute left-0 top-1/2 inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full text-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                style={{ background: "rgba(15, 23, 42, 0.9)", color: "white" }}
                aria-label="查看上一張圖片"
              >
                <ChevronLeft size={24} aria-hidden="true" />
              </button>
            )}
            {activeIndex < allImages.length - 1 && (
              <button
                type="button"
                onClick={goToNext}
                className="absolute right-0 top-1/2 inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full text-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                style={{ background: "rgba(15, 23, 42, 0.9)", color: "white" }}
                aria-label="查看下一張圖片"
              >
                <ChevronRight size={24} aria-hidden="true" />
              </button>
            )}
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => setActiveIndex(null)}
              className="absolute right-0 top-0 inline-flex h-12 min-w-12 items-center justify-center gap-1 rounded-full px-3 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={{ background: "rgba(15, 23, 42, 0.9)", color: "white" }}
            >
              <X size={18} aria-hidden="true" />
              關閉
            </button>
            <div className="absolute bottom-0 left-1/2 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-col items-center gap-2">
              {onSelect && (
                <button
                  type="button"
                  onClick={() => {
                    onSelect(activeItem.optionIndex);
                    setActiveIndex(null);
                  }}
                  className="min-h-11 rounded-full px-4 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  style={{ background: "var(--primary)", color: "var(--primary-fg)" }}
                >
                  {selectedOptionIndexes.includes(activeItem.optionIndex)
                    ? `已選擇「${activeItem.optionLabel}」`
                    : `選擇「${activeItem.optionLabel}」`}
                </button>
              )}
              {allImages.length > 1 && (
                <p className="rounded-full px-3 py-2 text-xs" style={{ background: "rgba(15, 23, 42, 0.9)", color: "white" }}>
                  {activeIndex + 1} / {allImages.length}（可左右滑動或按方向鍵）
                </p>
              )}
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  );
}
