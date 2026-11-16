"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Minus, Plus, Scan } from "lucide-react";
import ActivityImage from "./ActivityImage";
import PhotoCaption from "./PhotoCaption";
import type { GalleryItem } from "./GalleryViewer";
import { WALL_TILE_COUNT, wallCell } from "./infinite-wall-layout";

export default function InfinitePhotoWall({ items, paused, onOpen }: {
  items: GalleryItem[];
  paused: boolean;
  onOpen: (item: GalleryItem, origin: HTMLElement) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [indices, setIndices] = useState(() => Array.from({ length: WALL_TILE_COUNT }, (_, index) => index % Math.max(1, items.length)));
  const pausedRef = useRef(paused);
  const [scale, setScale] = useState(1);
  const zoomRef = useRef(1);
  const [imageRatios, setImageRatios] = useState<Record<string, number>>({});
  const ratiosRef = useRef(imageRatios);
  const controlsRef = useRef<{ zoom: (factor: number) => void; reset: () => void } | null>(null);

  useEffect(() => { ratiosRef.current = imageRatios; }, [imageRatios]);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !items.length) return;
    const tiles = Array.from(viewport.querySelectorAll<HTMLElement>(".infinite-wall-tile"));
    const buttons = tiles.map((tile) => tile.querySelector("button")!);
    const target = { x: 0, y: 0 };
    const pointer = { x: 0, y: 0 };
    const velocity = { x: 0, y: 0 };
    const positions = tiles.map(() => ({ x: 0, y: 0 }));
    let assigned = tiles.map((_, index) => index % items.length);
    let cellWidth = 320, cellHeight = 300;
    let viewWidth = 0, viewHeight = 0;
    let frame = 0, lastTime = 0, visible = true;
    let drag: { id: number; x: number; y: number; lastX: number; lastY: number; time: number; moved: boolean; touch: boolean } | null = null;
    let suppressClick = false;
    let currentZoom = zoomRef.current;
    const pointers = new Map<number, { x: number; y: number }>();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const rect = viewport.getBoundingClientRect();
      viewWidth = rect.width; viewHeight = rect.height;
      cellWidth = (rect.width < 768 ? Math.max(190, rect.width * 0.66) : rect.width * 0.3) * currentZoom;
      cellHeight = Math.max(180, rect.height * 0.36) * currentZoom;
    };

    const changeZoom = (factor: number, anchor = { x: viewWidth / 2, y: viewHeight / 2 }) => {
      if (pausedRef.current) return;
      const nextZoom = Math.max(1, Math.min(3, currentZoom * factor));
      const ratio = nextZoom / currentZoom;
      target.x = anchor.x - (anchor.x - target.x) * ratio;
      target.y = anchor.y - (anchor.y - target.y) * ratio;
      positions.forEach((position) => {
        position.x = anchor.x - (anchor.x - position.x) * ratio;
        position.y = anchor.y - (anchor.y - position.y) * ratio;
      });
      velocity.x = velocity.y = 0;
      currentZoom = zoomRef.current = nextZoom;
      setScale(nextZoom);
      resize();
    };
    controlsRef.current = {
      zoom: changeZoom,
      reset: () => {
        if (pausedRef.current) return;
        changeZoom(1 / currentZoom);
        target.x = target.y = pointer.x = pointer.y = velocity.x = velocity.y = 0;
        positions.forEach((position) => { position.x = position.y = 0; });
      },
    };

    const render = (time: number) => {
      frame = 0;
      const elapsed = lastTime ? Math.min((time - lastTime) / 16.667, 2) : 1;
      lastTime = time;
      if (!pausedRef.current && !document.hidden && visible) {
        const focused = viewport.contains(document.activeElement) && document.activeElement !== viewport;
        if (!drag && !pointers.size && !focused && !reducedMotion) {
          target.x += velocity.x * elapsed;
          target.y += velocity.y * elapsed;
          velocity.x *= Math.pow(0.93, elapsed);
          velocity.y *= Math.pow(0.93, elapsed);
        }
        let changed = false;
        const focusable = new Set<number>();
        const next = [...assigned];
        tiles.forEach((tile, index) => {
          // Different settling speeds create depth without splitting the grid at its seams.
          const depth = reducedMotion ? 1 : [0.055, 0.085, 0.12, 0.07, 0.1][index % 5];
          const position = positions[index];
          position.x += (target.x - position.x) * (1 - Math.pow(1 - depth, elapsed));
          position.y += (target.y - position.y) * (1 - Math.pow(1 - depth, elapsed));
          const parallax = reducedMotion ? 0 : 14 + (index % 4) * 9;
          const cell = wallCell(index, position.x + pointer.x * parallax - cellWidth * 0.4,
            position.y + pointer.y * parallax - cellHeight * 0.35, cellWidth, cellHeight, items.length);
          const item = items[cell.photoIndex];
          const size = [1.03, 0.72, 0.92, 0.8, 1.08][index % 5];
          const ratio = ratiosRef.current[item.src] ?? item.width / item.height;
          const imageWidth = Math.min(cellWidth * size - 24, (cellHeight * 0.96 - 52) * ratio);
          const width = imageWidth + 24;
          const height = imageWidth / ratio + 52;
          const x = cell.x + (cellWidth - width) / 2 + (index % 3 - 1) * cellWidth * 0.06;
          const y = cell.y + (cellHeight - height) / 2 + (index % 4 - 1.5) * cellHeight * 0.1;
          tile.style.width = width + "px";
          tile.style.transform = `translate3d(${x}px, ${y}px, 0)`;
          const onScreen = x + width > 0 && x < viewWidth && y + height > 0 && y < viewHeight;
          tile.style.visibility = onScreen ? "visible" : "hidden";
          buttons[index].tabIndex = onScreen && !focusable.has(cell.photoIndex) ? 0 : -1;
          if (onScreen) focusable.add(cell.photoIndex);
          if (assigned[index] !== cell.photoIndex) {
            next[index] = cell.photoIndex;
            changed = true;
          }
        });
        if (changed) { assigned = next; setIndices(next); }
      }
      if (visible && !document.hidden) frame = requestAnimationFrame(render);
    };
    const start = () => { if (!frame && visible && !document.hidden) { lastTime = 0; frame = requestAnimationFrame(render); } };
    const stop = () => { cancelAnimationFrame(frame); frame = 0; };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start(); else stop();
    }, { rootMargin: "100px" });
    observer.observe(viewport);
    const sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(viewport);
    resize();
    start();

    const wheel = (event: WheelEvent) => {
      if (pausedRef.current) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
      velocity.x = velocity.y = 0;
      if (event.ctrlKey || event.metaKey) {
        const rect = viewport.getBoundingClientRect();
        changeZoom(Math.exp(-event.deltaY * unit * 0.006), { x: event.clientX - rect.left, y: event.clientY - rect.top });
      } else {
        target.x -= (event.shiftKey ? event.deltaY : event.deltaX) * unit * 0.7;
        target.y -= (event.shiftKey ? 0 : event.deltaY) * unit * 0.7;
      }
    };
    const down = (event: PointerEvent) => {
      if (pausedRef.current || event.button !== 0 || pointers.size >= 2) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      velocity.x = velocity.y = 0;
      if (pointers.size === 2) { drag = null; suppressClick = true; return; }
      suppressClick = false;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY,
        lastX: event.clientX, lastY: event.clientY, time: event.timeStamp, moved: false, touch: event.pointerType !== "mouse" };
    };
    const move = (event: PointerEvent) => {
      const rect = viewport.getBoundingClientRect();
      if (event.pointerType === "mouse") {
        pointer.x += (((event.clientX - rect.left) / rect.width - 0.5) * 2 - pointer.x) * 0.3;
        pointer.y += (((event.clientY - rect.top) / rect.height - 0.5) * 2 - pointer.y) * 0.3;
      }
      if (pausedRef.current || !pointers.has(event.pointerId)) return;
      const before = [...pointers.values()];
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const after = [...pointers.values()];
      if (after.length === 2) {
        const previousDistance = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
        const distance = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
        const dx = (after[0].x + after[1].x - before[0].x - before[1].x) / 2;
        const dy = (after[0].y + after[1].y - before[0].y - before[1].y) / 2;
        target.x += dx; target.y += dy;
        positions.forEach((position) => { position.x += dx; position.y += dy; });
        changeZoom(previousDistance ? distance / previousDistance : 1, {
          x: (after[0].x + after[1].x) / 2 - rect.left,
          y: (after[0].y + after[1].y) / 2 - rect.top,
        });
        suppressClick = true;
        viewport.dataset.dragging = "true";
        if (!viewport.hasPointerCapture(event.pointerId)) viewport.setPointerCapture(event.pointerId);
        return;
      }
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.lastX, dy = event.clientY - drag.lastY;
      if (!drag.moved) {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 7) return;
        drag.moved = true;
        viewport.focus({ preventScroll: true });
        viewport.setPointerCapture(event.pointerId);
        viewport.dataset.dragging = "true";
      }
      const elapsed = Math.max(event.timeStamp - drag.time, 8);
      target.x += dx; target.y += dy;
      velocity.x = reducedMotion ? 0 : Math.max(-40, Math.min(40, dx / elapsed * 16));
      velocity.y = reducedMotion ? 0 : Math.max(-40, Math.min(40, dy / elapsed * 16));
      drag.lastX = event.clientX; drag.lastY = event.clientY; drag.time = event.timeStamp;
    };
    const up = (event: PointerEvent) => {
      if (!pointers.delete(event.pointerId)) return;
      suppressClick = suppressClick || Boolean(drag?.moved);
      if (drag && event.timeStamp - drag.time > 100) velocity.x = velocity.y = 0;
      const remaining = [...pointers.entries()][0];
      drag = remaining ? { id: remaining[0], x: remaining[1].x, y: remaining[1].y,
        lastX: remaining[1].x, lastY: remaining[1].y, time: event.timeStamp, moved: true, touch: true } : null;
      if (!pointers.size) delete viewport.dataset.dragging;
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    };
    const cancel = () => {
      suppressClick = suppressClick || Boolean(drag?.moved);
      pointers.clear(); drag = null; velocity.x = velocity.y = 0;
      delete viewport.dataset.dragging;
    };
    const lostCapture = (event: PointerEvent) => {
      if (event.target === viewport && pointers.has(event.pointerId)) cancel();
    };
    const click = (event: MouseEvent) => {
      if (suppressClick && event.detail > 0) { event.preventDefault(); event.stopPropagation(); }
      suppressClick = false;
    };
    const keys = (event: KeyboardEvent) => {
      if (event.target !== viewport || pausedRef.current) return;
      const directions: Record<string, [number, number]> = { ArrowLeft: [180, 0], ArrowRight: [-180, 0], ArrowUp: [0, 180], ArrowDown: [0, -180] };
      const direction = directions[event.key];
      if (direction) { event.preventDefault(); velocity.x = velocity.y = 0; target.x += direction[0]; target.y += direction[1]; }
      else if (["+", "=", "-", "Home"].includes(event.key)) {
        event.preventDefault();
        if (event.key === "Home") controlsRef.current?.reset(); else changeZoom(event.key === "-" ? 0.8 : 1.25);
      }
    };
    const leave = () => { pointer.x = pointer.y = 0; if (drag && !drag.moved) cancel(); };
    const visibility = () => { if (document.hidden) stop(); else start(); };
    viewport.addEventListener("pointerdown", down);
    viewport.addEventListener("pointermove", move);
    viewport.addEventListener("pointerup", up);
    viewport.addEventListener("pointercancel", cancel);
    viewport.addEventListener("lostpointercapture", lostCapture);
    viewport.addEventListener("pointerleave", leave);
    viewport.addEventListener("click", click, true);
    viewport.addEventListener("keydown", keys);
    viewport.addEventListener("wheel", wheel, { passive: false });
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stop(); observer.disconnect(); sizeObserver.disconnect(); controlsRef.current = null;
      viewport.removeEventListener("pointerdown", down);
      viewport.removeEventListener("pointermove", move);
      viewport.removeEventListener("pointerup", up);
      viewport.removeEventListener("pointercancel", cancel);
      viewport.removeEventListener("lostpointercapture", lostCapture);
      viewport.removeEventListener("pointerleave", leave);
      viewport.removeEventListener("click", click, true);
      viewport.removeEventListener("keydown", keys);
      viewport.removeEventListener("wheel", wheel);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [items]);

  if (!items.length) return null;
  return <section className="infinite-wall" aria-label="活動照片牆">
    <header className="infinite-wall-heading"><h2 id="infinite-wall-title">活動照片牆</h2><span>{items.length} 幅影像</span></header>
    <div ref={viewportRef} className="infinite-wall-viewport" tabIndex={0}
      aria-label="照片牆，可拖曳、雙指縮放或使用方向鍵，按加減鍵縮放、Home 重設視角">
      <div className="infinite-wall-plane">
        {indices.map((photoIndex, slot) => {
          const item = items[photoIndex];
          return <div key={slot} className="infinite-wall-tile" style={{
            left: 0, top: 0, width: "24%",
            transform: `translate(${(slot % 5) * 125 - 40}%, ${Math.floor(slot / 5) * 170 - 50}%)`,
            "--tile-order": slot,
          } as CSSProperties}>
            <button type="button" className="archive-photo" data-gallery-photo={item.id} data-gallery-album={item.albumId}
              tabIndex={-1}
              aria-label={"放大：" + item.albumTitle + "・" + (item.caption || item.alt || "活動照片")}
              onClick={(event) => onOpen(item, event.currentTarget)}>
              <span className="infinite-wall-image" style={{ aspectRatio: imageRatios[item.src] ?? item.width / item.height }}>
                <ActivityImage key={item.src} photos={[item]} sizes="(max-width: 767px) 60vw, 30vw" fill
                  onDimensions={(width, height) => setImageRatios((current) => current[item.src] === width / height ? current : { ...current, [item.src]: width / height })} />
              </span>
              <PhotoCaption item={item} />
            </button>
          </div>;
        })}
      </div>
    </div>
    <div className="infinite-wall-tools" role="group" aria-label="照片牆縮放">
      <button type="button" aria-label="縮小照片牆" title="縮小照片牆" disabled={paused || scale <= 1} onClick={() => controlsRef.current?.zoom(0.8)}><Minus size={18} aria-hidden /></button>
      <output aria-label="縮放比例">{Math.round(scale * 100)}%</output>
      <button type="button" aria-label="放大照片牆" title="放大照片牆" disabled={paused || scale >= 3} onClick={() => controlsRef.current?.zoom(1.25)}><Plus size={18} aria-hidden /></button>
      <button type="button" aria-label="重設照片牆" title="重設照片牆" disabled={paused} onClick={() => controlsRef.current?.reset()}><Scan size={18} aria-hidden /></button>
    </div>
  </section>;
}
