"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, Scan } from "lucide-react";
import ActivityImage from "./ActivityImage";
import type { GalleryItem } from "./GalleryViewer";
import { constrainCamera, fitWall, wallLayout, zoomCamera, type WallCamera } from "./infinite-wall-layout";

export default function InfinitePhotoWall({ items, paused, onOpen }: {
  items: GalleryItem[];
  paused: boolean;
  onOpen: (item: GalleryItem, origin: HTMLElement) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragStart = useRef({ x: 0, y: 0 });
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [size, setSize] = useState({ width: 1200, height: 640 });
  const [camera, setCamera] = useState<WallCamera>({ x: 0, y: 0, scale: 1 });
  const layout = useMemo(() => wallLayout(items.map((item) => item.width / item.height), size), [items, size]);
  const view = constrainCamera(camera, layout, size);
  const minimumScale = fitWall(layout, size).scale * 0.75;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const resize = () => {
      const { width, height } = viewport.getBoundingClientRect();
      if (width && height) setSize({ width, height });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      if (paused) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
      const rect = viewport.getBoundingClientRect();
      setCamera((current) => {
        const start = constrainCamera(current, layout, size);
        return event.ctrlKey || event.metaKey
          ? zoomCamera(start, Math.exp(-event.deltaY * unit * 0.006), { x: event.clientX - rect.left, y: event.clientY - rect.top }, layout, size)
          : constrainCamera({ ...start, x: start.x - (event.shiftKey ? event.deltaY : event.deltaX) * unit, y: start.y - (event.shiftKey ? 0 : event.deltaY) * unit }, layout, size);
      });
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => viewport.removeEventListener("wheel", wheel);
  }, [layout, paused, size]);

  const zoom = (factor: number) => setCamera((current) => zoomCamera(constrainCamera(current, layout, size), factor, { x: size.width / 2, y: size.height / 2 }, layout, size));
  const reset = () => setCamera(fitWall(layout, size));

  return <section className="infinite-wall" aria-label="活動照片牆">
    <div ref={viewportRef} className="infinite-wall-viewport" tabIndex={0}
      aria-label="照片牆，可拖曳、雙指縮放或使用方向鍵，按加減鍵縮放、Home 顯示全部"
      data-dragging={dragging || undefined}
      onPointerDown={(event) => {
        if (paused || event.button !== 0 || pointers.current.size >= 2) return;
        if (!pointers.current.size) {
          suppressClick.current = false;
          dragStart.current = { x: event.clientX, y: event.clientY };
        }
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.current.size > 1) suppressClick.current = true;
      }}
      onPointerMove={(event) => {
        const previous = pointers.current.get(event.pointerId);
        if (!previous || paused) return;
        const before = [...pointers.current.values()];
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const after = [...pointers.current.values()];
        if (after.length === 2) {
          const oldDistance = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
          const distance = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
          const rect = event.currentTarget.getBoundingClientRect();
          const center = { x: (after[0].x + after[1].x) / 2 - rect.left, y: (after[0].y + after[1].y) / 2 - rect.top };
          const dx = (after[0].x + after[1].x - before[0].x - before[1].x) / 2;
          const dy = (after[0].y + after[1].y - before[0].y - before[1].y) / 2;
          setCamera((current) => {
            const start = constrainCamera(current, layout, size);
            return zoomCamera({ ...start, x: start.x + dx, y: start.y + dy }, oldDistance > 0 ? distance / oldDistance : 1, center, layout, size);
          });
          suppressClick.current = true;
        } else {
          if (!suppressClick.current && Math.hypot(event.clientX - dragStart.current.x, event.clientY - dragStart.current.y) < 7) return;
          suppressClick.current = true;
          setCamera((current) => {
            const start = constrainCamera(current, layout, size);
            return constrainCamera({ ...start, x: start.x + event.clientX - previous.x, y: start.y + event.clientY - previous.y }, layout, size);
          });
        }
        setDragging(true);
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUp={(event) => {
        pointers.current.delete(event.pointerId);
        if (!pointers.current.size) setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { pointers.current.clear(); setDragging(false); suppressClick.current = true; }}
      onLostPointerCapture={(event) => {
        // A touch initially captured by a photo transfers to the viewport during a drag.
        if (event.target !== event.currentTarget) return;
        pointers.current.delete(event.pointerId);
        if (!pointers.current.size) setDragging(false);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse" && !dragging) pointers.current.delete(event.pointerId);
      }}
      onClickCapture={(event) => {
        if (suppressClick.current && event.detail > 0) { event.preventDefault(); event.stopPropagation(); }
        suppressClick.current = false;
      }}
      onKeyDown={(event) => {
        if (paused || event.target !== event.currentTarget) return;
        const directions: Record<string, [number, number]> = { ArrowLeft: [120, 0], ArrowRight: [-120, 0], ArrowUp: [0, 120], ArrowDown: [0, -120] };
        const direction = directions[event.key];
        if (direction) {
          event.preventDefault();
          setCamera((current) => { const start = constrainCamera(current, layout, size); return constrainCamera({ ...start, x: start.x + direction[0], y: start.y + direction[1] }, layout, size); });
        } else if (["+", "=", "-", "Home"].includes(event.key)) {
          event.preventDefault();
          if (event.key === "Home") reset(); else zoom(event.key === "-" ? 0.8 : 1.25);
        }
      }}>
      <div className="infinite-wall-plane" style={{ width: layout.width, height: layout.height, transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}>
        {items.map((item, index) => {
          const tile = layout.tiles[index];
          return <div key={item.albumId + ":" + item.id} className="infinite-wall-tile" style={{ left: tile.x, top: tile.y, width: tile.width }}>
            <button type="button" className="archive-photo" data-gallery-photo={item.id} data-gallery-album={item.albumId}
              aria-label={"放大：" + item.albumTitle + "・" + (item.caption || item.alt || "活動照片")}
              onFocus={(event) => {
                if (!event.currentTarget.matches(":focus-visible")) return;
                setCamera((current) => {
                  const start = constrainCamera(current, layout, size);
                  const x = tile.x * start.scale + start.x, y = tile.y * start.scale + start.y;
                  if (x >= 16 && y >= 16 && x + tile.width * start.scale <= size.width - 16 && y + tile.height * start.scale <= size.height - 16) return current;
                  return constrainCamera({ ...start, x: size.width / 2 - (tile.x + tile.width / 2) * start.scale, y: size.height / 2 - (tile.y + tile.height / 2) * start.scale }, layout, size);
                });
              }}
              onClick={(event) => { if (!paused) onOpen(item, event.currentTarget); }}>
              <span className="infinite-wall-image" style={{ aspectRatio: item.width / item.height }}>
                <ActivityImage photos={[item]} sizes="(max-width: 767px) 70vw, 35vw" preload={index === 0} fill />
              </span>
              <span className="infinite-wall-caption">{item.caption || item.albumTitle}</span>
            </button>
          </div>;
        })}
      </div>
    </div>
    <div className="infinite-wall-tools" role="group" aria-label="照片牆縮放">
      <button type="button" aria-label="縮小照片牆" title="縮小照片牆" disabled={paused || view.scale <= minimumScale + 0.001} onClick={() => zoom(0.8)}><Minus size={18} aria-hidden /></button>
      <output aria-label="縮放比例">{Math.round(view.scale * 100)}%</output>
      <button type="button" aria-label="放大照片牆" title="放大照片牆" disabled={paused || view.scale >= 3} onClick={() => zoom(1.25)}><Plus size={18} aria-hidden /></button>
      <button type="button" aria-label="顯示全部照片" title="顯示全部照片" disabled={paused} onClick={reset}><Scan size={18} aria-hidden /></button>
    </div>
  </section>;
}
