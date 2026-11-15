"use client";

import ActivityImage from "./ActivityImage";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, Download, Share2, X } from "lucide-react";
import { uploadUrl } from "@/lib/config";
import { galleryDate, type GalleryPhoto } from "@/lib/public-activity-albums";

export type GalleryItem = GalleryPhoto & {
  albumId: string;
  albumTitle: string;
  date?: string;
  sourceUrl?: string;
  isKeyVisual?: boolean;
};

export default function GalleryViewer({ items, initialIndex, origin, onClose }: {
  items: GalleryItem[];
  initialIndex: number;
  origin: HTMLElement | null;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [message, setMessage] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const item = items[index];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    closeRef.current?.focus();
    let animation: Animation | undefined;
    const image = imageRef.current;
    if (image && origin && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const from = origin.querySelector("img")?.getBoundingClientRect() ?? origin.getBoundingClientRect();
      const to = image.getBoundingClientRect();
      if (to.width && to.height) animation = image.animate([
        { transform: "translate(" + (from.x - to.x) + "px," + (from.y - to.y) + "px) scale(" + from.width / to.width + "," + from.height / to.height + ")" },
        { transform: "none" },
      ], { duration: 440, easing: "cubic-bezier(.16,1,.3,1)" });
    }
    return () => {
      animation?.cancel();
      dialog.close();
      document.body.style.overflow = previous;
      origin?.focus({ preventScroll: true });
    };
  }, [origin]);

  const close = async () => {
    if (closing.current) return;
    closing.current = true;
    const image = imageRef.current;
    if (image && origin && index === initialIndex && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const from = image.getBoundingClientRect();
      const to = origin.querySelector("img")?.getBoundingClientRect() ?? origin.getBoundingClientRect();
      if (from.width && from.height) {
        const animation = image.animate([
          { transform: "none" },
          { transform: "translate(" + (to.x - from.x) + "px," + (to.y - from.y) + "px) scale(" + to.width / from.width + "," + to.height / from.height + ")", opacity: 0 },
        ], { duration: 240, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" });
        await animation.finished.catch(() => undefined);
      }
    }
    onClose();
  };

  const change = (step: number) => {
    setIndex((current) => (current + step + items.length) % items.length);
    setMessage("");
    setShareUrl("");
    setImageFailed(false);
  };

  const share = async () => {
    const url = new URL("/gallery/" + item.albumId, window.location.origin);
    url.searchParams.set("photo", item.id);
    try {
      if (navigator.share) await navigator.share({ title: item.albumTitle, url: url.href });
      else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url.href);
        setMessage("照片連結已複製");
      } else setShareUrl(url.href);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setShareUrl(url.href);
    }
  };

  const download = async () => {
    setDownloading(true);
    setMessage("");
    try {
      const response = await fetch(uploadUrl(item.src), { credentials: "same-origin" });
      if (!response.ok) throw new Error("download");
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      const extension = blob.type === "image/png" ? ".png" : blob.type === "image/jpeg" ? ".jpg" : ".webp";
      link.download = item.albumId + "-" + item.id.replace(/[^a-z0-9-]/gi, "") + extension;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
      setMessage("下載失敗，請稍後重試。");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="gallery-viewer" aria-label="全螢幕照片檢視"
      onCancel={(event) => { event.preventDefault(); void close(); }}
      onClick={(event) => { if (event.target === event.currentTarget) void close(); }}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement) return;
        if (event.key === "ArrowRight") { event.preventDefault(); change(1); }
        if (event.key === "ArrowLeft") { event.preventDefault(); change(-1); }
      }}>
      <header className="gallery-viewer-toolbar">
        <span aria-live="polite">{index + 1} / {items.length}</span>
        <div>
          <button type="button" onClick={() => void download()} disabled={downloading} aria-label={downloading ? "正在下載" : "下載照片"}><Download size={20} /></button>
          <button type="button" onClick={() => void share()} aria-label="分享照片"><Share2 size={20} /></button>
          <button ref={closeRef} type="button" onClick={() => void close()} aria-label="關閉照片"><X size={24} /></button>
        </div>
      </header>
      <div className="gallery-viewer-stage"
        onTouchStart={(event) => { swipe.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }}
        onTouchEnd={(event) => {
          const start = swipe.current;
          swipe.current = null;
          if (!start) return;
          const dx = event.changedTouches[0].clientX - start.x;
          const dy = event.changedTouches[0].clientY - start.y;
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) change(dx < 0 ? 1 : -1);
        }}>
        {items.length > 1 && <button className="gallery-viewer-prev" type="button" aria-label="上一張照片" onClick={() => change(-1)}><ChevronLeft size={28} /></button>}
        <div className="gallery-viewer-image-frame" key={item.id}
          style={{ "--photo-ratio": item.width / item.height } as CSSProperties}>
          <ActivityImage imageRef={imageRef} photos={[{ ...item, alt: item.alt || item.caption || item.albumTitle }]}
            fill sizes="100vw" preload onUnavailable={() => setImageFailed(true)} />
        </div>
        {items.length > 1 && <button className="gallery-viewer-next" type="button" aria-label="下一張照片" onClick={() => change(1)}><ChevronRight size={28} /></button>}
      </div>
      <footer className="gallery-viewer-caption">
        <div><strong>{item.caption || item.albumTitle}</strong><span>{item.albumTitle}{item.date ? " · " + galleryDate(item.date) : ""}{item.photographer ? (item.isKeyVisual ? " · 主視覺／" : " · 攝影／") + item.photographer : ""}</span></div>
        {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">來源相簿<span className="sr-only">（另開分頁）</span></a>}
        {imageFailed && <p role="alert">照片載入失敗，請關閉後重試。</p>}
        {message && <p role="status">{message}</p>}
        {shareUrl && <label>照片連結<input readOnly value={shareUrl} onFocus={(event) => event.target.select()} /></label>}
      </footer>
    </dialog>
  );
}
