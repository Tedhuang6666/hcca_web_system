"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Maximize2, MoveUpRight } from "lucide-react";
import ActivityImage from "./ActivityImage";
import type { GalleryItem } from "./GalleryViewer";
import { WALL_TILE_COUNT, wallCell } from "./infinite-wall-layout";

export default function InfinitePhotoWall({ items, paused, onOpen }: {
  items: GalleryItem[];
  paused: boolean;
  onOpen: (item: GalleryItem, origin: HTMLElement) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [indices, setIndices] = useState(() => Array.from({ length: WALL_TILE_COUNT }, (_, index) => index % items.length));
  const pausedRef = useRef(paused);

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
    let lastScroll = window.scrollY;

    const resize = () => {
      const rect = viewport.getBoundingClientRect();
      viewWidth = rect.width; viewHeight = rect.height;
      cellWidth = rect.width < 768 ? Math.max(190, rect.width * 0.66) : rect.width * 0.3;
      cellHeight = Math.max(180, rect.height * 0.36);
    };

    const render = (time: number) => {
      frame = 0;
      const elapsed = lastTime ? Math.min((time - lastTime) / 16.667, 2) : 1;
      lastTime = time;
      if (!pausedRef.current && !document.hidden && visible) {
        const focused = viewport.contains(document.activeElement) && document.activeElement !== viewport;
        if (!drag && !focused) {
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
          const depth = [0.055, 0.085, 0.12, 0.07, 0.1][index % 5];
          const position = positions[index];
          position.x += (target.x - position.x) * (1 - Math.pow(1 - depth, elapsed));
          position.y += (target.y - position.y) * (1 - Math.pow(1 - depth, elapsed));
          const parallax = 14 + (index % 4) * 9;
          const cell = wallCell(index, position.x + pointer.x * parallax - cellWidth * 0.4,
            position.y + pointer.y * parallax - cellHeight * 0.35, cellWidth, cellHeight, items.length);
          const item = items[cell.photoIndex];
          const size = [1.03, 0.72, 0.92, 0.8, 1.08][index % 5];
          const width = Math.min(cellWidth * size, cellHeight * 0.96 * item.width / item.height);
          const height = width * item.height / item.width;
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

    const scroll = () => {
      const delta = window.scrollY - lastScroll;
      lastScroll = window.scrollY;
      if (visible && !pausedRef.current && !drag) { target.y -= delta * 0.48; target.x -= delta * 0.16; }
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || pausedRef.current) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
      target.x -= event.deltaX * unit * 0.7;
      // Vertical scrolling stays native; the page scroll also moves the photo space.
    };
    const down = (event: PointerEvent) => {
      if (pausedRef.current || event.button !== 0) return;
      suppressClick = false;
      velocity.x = velocity.y = 0;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY,
        lastX: event.clientX, lastY: event.clientY, time: event.timeStamp, moved: false, touch: event.pointerType !== "mouse" };
    };
    const move = (event: PointerEvent) => {
      const rect = viewport.getBoundingClientRect();
      pointer.x += (((event.clientX - rect.left) / rect.width - 0.5) * 2 - pointer.x) * 0.3;
      pointer.y += (((event.clientY - rect.top) / rect.height - 0.5) * 2 - pointer.y) * 0.3;
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.lastX, dy = event.clientY - drag.lastY;
      if (!drag.moved) {
        const totalX = event.clientX - drag.x, totalY = event.clientY - drag.y;
        if (Math.abs(totalX) + Math.abs(totalY) < 7) return;
        if (drag.touch && Math.abs(totalY) > Math.abs(totalX)) { drag = null; return; }
        drag.moved = true;
        viewport.setPointerCapture(event.pointerId);
        viewport.dataset.dragging = "true";
      }
      const elapsed = Math.max(event.timeStamp - drag.time, 8);
      target.x += dx;
      if (!drag.touch) target.y += dy;
      velocity.x = Math.max(-40, Math.min(40, dx / elapsed * 16));
      velocity.y = drag.touch ? 0 : Math.max(-40, Math.min(40, dy / elapsed * 16));
      drag.lastX = event.clientX; drag.lastY = event.clientY; drag.time = event.timeStamp;
    };
    const up = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      suppressClick = drag.moved;
      if (event.timeStamp - drag.time > 100) velocity.x = velocity.y = 0;
      drag = null;
      delete viewport.dataset.dragging;
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    };
    const cancel = () => {
      if (!drag) return;
      suppressClick = drag.moved;
      drag = null; velocity.x = velocity.y = 0;
      delete viewport.dataset.dragging;
    };
    const click = (event: MouseEvent) => {
      if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false; }
    };
    const keys = (event: KeyboardEvent) => {
      if (event.target !== viewport || pausedRef.current) return;
      const directions: Record<string, [number, number]> = { ArrowLeft: [180, 0], ArrowRight: [-180, 0], ArrowUp: [0, 180], ArrowDown: [0, -180] };
      const direction = directions[event.key];
      if (direction) { event.preventDefault(); target.x += direction[0]; target.y += direction[1]; }
    };
    const leave = () => { pointer.x = pointer.y = 0; };
    const visibility = () => { if (document.hidden) stop(); else start(); };
    viewport.addEventListener("pointerdown", down);
    viewport.addEventListener("pointermove", move);
    viewport.addEventListener("pointerup", up);
    viewport.addEventListener("pointercancel", cancel);
    viewport.addEventListener("lostpointercapture", cancel);
    viewport.addEventListener("pointerleave", leave);
    viewport.addEventListener("click", click, true);
    viewport.addEventListener("keydown", keys);
    viewport.addEventListener("wheel", wheel, { passive: true });
    window.addEventListener("scroll", scroll, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stop(); observer.disconnect(); sizeObserver.disconnect();
      viewport.removeEventListener("pointerdown", down);
      viewport.removeEventListener("pointermove", move);
      viewport.removeEventListener("pointerup", up);
      viewport.removeEventListener("pointercancel", cancel);
      viewport.removeEventListener("lostpointercapture", cancel);
      viewport.removeEventListener("pointerleave", leave);
      viewport.removeEventListener("click", click, true);
      viewport.removeEventListener("keydown", keys);
      viewport.removeEventListener("wheel", wheel);
      window.removeEventListener("scroll", scroll);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [items]);

  return <section className="infinite-wall" aria-labelledby="infinite-wall-title">
    <header className="infinite-wall-heading"><h2 id="infinite-wall-title">無邊影像</h2><span>{items.length} 幅影像</span></header>
    <div ref={viewportRef} className="infinite-wall-viewport" tabIndex={0}
      aria-label="無限視差攝影牆，可拖曳或使用方向鍵探索">
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
              <span className="infinite-wall-image"><ActivityImage key={item.src} photos={[item]}
                sizes="(max-width: 767px) 60vw, 30vw" /></span>
              <span className="infinite-wall-caption"><span>{item.caption || item.albumTitle}</span><Maximize2 size={14} aria-hidden /></span>
            </button>
          </div>;
        })}
      </div>
      <div className="infinite-wall-compass" aria-hidden><MoveUpRight size={20} /><span>拖曳探索</span></div>
    </div>
    <footer className="infinite-wall-foot"><span>HCCA / INFINITE MEMORIES</span><span>照片沒有邊界，回憶也是。</span></footer>
  </section>;
}
