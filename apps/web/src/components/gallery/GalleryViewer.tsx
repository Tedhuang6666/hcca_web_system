"use client";

import ActivityImage from "./ActivityImage";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, Download, Share2, X, ZoomIn, ZoomOut } from "lucide-react";
import { uploadUrl } from "@/lib/config";
import { galleryDate, type GalleryPhoto } from "@/lib/public-activity-albums";

export type GalleryItem = GalleryPhoto & {
  albumId: string;
  albumTitle: string;
  date?: string;
  sourceUrl?: string;
  isKeyVisual?: boolean;
};

function photoFlight(dialog: HTMLDialogElement, source: HTMLImageElement, from: DOMRect, to: DOMRect, entering: boolean) {
  if (!from.width || !from.height || !to.width || !to.height || typeof source.animate !== "function") return null;
  const ghost = source.cloneNode() as HTMLImageElement;
  ghost.removeAttribute("srcset");
  ghost.removeAttribute("sizes");
  ghost.src = source.currentSrc || source.src;
  ghost.className = "gallery-viewer-flight";
  ghost.alt = "";
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, { position: "fixed", inset: "auto", visibility: "visible", transform: "none",
    left: to.x + "px", top: to.y + "px", width: to.width + "px", height: to.height + "px" });
  dialog.appendChild(ghost);
  const offset = `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.width / to.width}, ${from.height / to.height})`;
  const animation = ghost.animate([{ transform: offset }, { transform: "none" }], {
    duration: entering ? 650 : 440, easing: entering ? "cubic-bezier(.16,1,.3,1)" : "cubic-bezier(.65,0,.35,1)", fill: "both",
  });
  const cleanup = () => { animation.cancel(); ghost.remove(); };
  return { animation, cleanup };
}

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
  const [zoomed, setZoomed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);
  const flightRef = useRef<ReturnType<typeof photoFlight>>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const item = items[index];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    closeRef.current?.focus();
    const backgroundAnimation = dialog.animate?.([{ backgroundColor: "transparent" }, { backgroundColor: "rgba(10,11,13,.97)" }], { duration: 420 });
    const image = imageRef.current;
    const thumbnail = origin?.querySelector("img");
    if (image && thumbnail) {
      const flight = photoFlight(dialog, thumbnail, thumbnail.getBoundingClientRect(), image.getBoundingClientRect(), true);
      if (flight) {
        flightRef.current = flight;
        image.style.visibility = "hidden";
        thumbnail.style.visibility = "hidden";
        void flight.animation.finished.catch(() => undefined).then(() => {
          if (!closing.current) image.style.visibility = "";
          thumbnail.style.visibility = ""; flight.cleanup();
          if (flightRef.current === flight) flightRef.current = null;
        });
      }
    }
    return () => {
      flightRef.current?.cleanup();
      flightRef.current = null;
      backgroundAnimation?.cancel();
      if (thumbnail) thumbnail.style.visibility = "";
      dialog.close();
      document.body.style.overflow = previous;
      origin?.focus({ preventScroll: true });
    };
  }, [origin]);

  const close = async () => {
    if (closing.current) return;
    closing.current = true;
    flightRef.current?.cleanup();
    flightRef.current = null;
    const image = imageRef.current;
    const root = origin?.closest(".gallery-experience");
    const destination = index === initialIndex ? origin : Array.from(root?.querySelectorAll<HTMLElement>("[data-gallery-photo]") ?? []).find((node) => {
      const rect = node.getBoundingClientRect();
      return node.dataset.galleryPhoto === item.id && node.dataset.galleryAlbum === item.albumId
        && rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight
        && rect.right > 0 && rect.left < window.innerWidth && getComputedStyle(node.parentElement ?? node).visibility !== "hidden";
    });
    const thumbnail = destination?.querySelector("img");
    if (image && thumbnail && dialogRef.current && !imageFailed) {
      const flight = photoFlight(dialogRef.current, image, image.getBoundingClientRect(), thumbnail.getBoundingClientRect(), false);
      if (flight) {
        flightRef.current = flight;
        dialogRef.current.dataset.closing = "true";
        image.style.visibility = "hidden"; thumbnail.style.visibility = "hidden";
        await flight.animation.finished.catch(() => undefined);
        thumbnail.style.visibility = ""; flight.cleanup(); flightRef.current = null;
      }
    }
    onClose();
  };

  const change = (step: number) => {
    if (closing.current) return;
    flightRef.current?.cleanup();
    flightRef.current = null;
    setIndex((current) => (current + step + items.length) % items.length);
    setMessage("");
    setShareUrl("");
    setImageFailed(false);
    setZoomed(false);
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
          <button type="button" onClick={() => setZoomed((current) => !current)} aria-label={zoomed ? "縮小照片" : "放大檢視"} aria-pressed={zoomed}>{zoomed ? <ZoomOut size={20} /> : <ZoomIn size={20} />}</button>
          <button type="button" onClick={() => void download()} disabled={downloading} aria-label={downloading ? "正在下載" : "下載照片"}><Download size={20} /></button>
          <button type="button" onClick={() => void share()} aria-label="分享照片"><Share2 size={20} /></button>
          <button ref={closeRef} type="button" onClick={() => void close()} aria-label="關閉照片"><X size={24} /></button>
        </div>
      </header>
      <div className="gallery-viewer-stage"
        onTouchStart={(event) => { if (!zoomed) swipe.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }}
        onTouchEnd={(event) => {
          const start = swipe.current;
          swipe.current = null;
          if (!start || zoomed) return;
          const dx = event.changedTouches[0].clientX - start.x;
          const dy = event.changedTouches[0].clientY - start.y;
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) change(dx < 0 ? 1 : -1);
        }}>
        {items.length > 1 && <button className="gallery-viewer-prev" type="button" aria-label="上一張照片" onClick={() => change(-1)}><ChevronLeft size={28} /></button>}
        <div className={"gallery-viewer-image-frame" + (zoomed ? " is-zoomed" : "")} key={item.albumId + ":" + item.id}
          data-opening={index === initialIndex} onDoubleClick={() => setZoomed((current) => !current)}
          onPointerDown={(event) => {
            if (!zoomed) return;
            const style = event.currentTarget.style;
            pan.current = { x: event.clientX, y: event.clientY, left: parseFloat(style.getPropertyValue("--pan-x")) || 0, top: parseFloat(style.getPropertyValue("--pan-y")) || 0 };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!zoomed || !pan.current) return;
            const frame = event.currentTarget;
            frame.style.setProperty("--pan-x", Math.max(-frame.clientWidth / 2, Math.min(frame.clientWidth / 2, pan.current.left + event.clientX - pan.current.x)) + "px");
            frame.style.setProperty("--pan-y", Math.max(-frame.clientHeight / 2, Math.min(frame.clientHeight / 2, pan.current.top + event.clientY - pan.current.y)) + "px");
          }}
          onPointerUp={() => { pan.current = null; }} onPointerCancel={() => { pan.current = null; }}
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
