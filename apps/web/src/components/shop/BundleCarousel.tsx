"use client";

import { Children, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Pause, Play } from "lucide-react";

export default function BundleCarousel({ children }: { children: ReactNode }) {
  const items = Children.toArray(children);
  const [rotation, setRotation] = useState(0);
  const [overflow, setOverflow] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const carouselRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const hoveredRef = useRef(false);
  const focusedRef = useRef(false);
  const resumeAtRef = useRef(0);
  const pendingShift = useRef(0);
  const strideRef = useRef(0);
  const start = rotation % Math.max(1, items.length);
  const ordered = [...items.slice(start), ...items.slice(0, start)];

  useLayoutEffect(() => {
    if (viewportRef.current && pendingShift.current) {
      viewportRef.current.scrollLeft -= pendingShift.current;
      pendingShift.current = 0;
    }
  }, [rotation]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const track = viewport.firstElementChild as HTMLElement;
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let visible = true;
    let maximum = 0;
    let direction = 1;
    let fractionalDistance = 0;
    let previousTime: number | null = null;
    let active = true;

    const syncMotion = () => setReducedMotion(Boolean(motion?.matches));
    syncMotion();
    const measure = () => {
      const first = track.firstElementChild;
      strideRef.current = first
        ? first.getBoundingClientRect().width + (parseFloat(getComputedStyle(track).columnGap) || 0)
        : 0;
      maximum = viewport.scrollWidth - viewport.clientWidth;
      setOverflow(maximum > 1);
    };
    const tick = (time: number) => {
      if (!active) return;
      const stride = strideRef.current;
      // 留一個完整品項的空間，移到最左側後再接到隊尾，不複製優惠或操作按鈕。
      if (previousTime !== null && items.length > 1 && maximum > 1 && stride > 0
        && visible && !document.hidden && !motion?.matches && !paused
        && !hoveredRef.current && !focusedRef.current && time >= resumeAtRef.current
        && !pendingShift.current) {
        fractionalDistance += Math.min(time - previousTime, 64) * 0.024;
        const distance = Math.floor(fractionalDistance);
        fractionalDistance -= distance;
        viewport.scrollLeft = Math.max(0, Math.min(maximum, viewport.scrollLeft + distance * direction));
        if (maximum >= stride - 1 && viewport.scrollLeft >= stride - 1) {
          pendingShift.current = stride;
          setRotation((current) => current + 1);
        } else if (distance > 0 && maximum < stride - 1 && (viewport.scrollLeft >= maximum || viewport.scrollLeft <= 0)) {
          // 只有少量溢出時往返瀏覽，兩組優惠也能自動展示完整內容。
          direction *= -1;
        }
      }
      previousTime = time;
      frameRef.current = window.requestAnimationFrame(tick);
    };
    measure();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(viewport);
    const intersection = typeof IntersectionObserver === "undefined" ? null
      : new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    intersection?.observe(viewport);
    motion?.addEventListener("change", syncMotion);
    if (!motion?.matches && !paused && items.length > 1) frameRef.current = window.requestAnimationFrame(tick);

    return () => {
      active = false;
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      resize?.disconnect();
      intersection?.disconnect();
      motion?.removeEventListener("change", syncMotion);
    };
  }, [items.length, paused, reducedMotion]);

  const pauseBriefly = () => { resumeAtRef.current = performance.now() + 2500; };

  const browse = (direction: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    pauseBriefly();
    const maximum = viewport.scrollWidth - viewport.clientWidth;
    const left = direction < 0 && viewport.scrollLeft <= 1 ? maximum
      : direction > 0 && viewport.scrollLeft >= maximum - 1 ? 0
        : viewport.scrollLeft + direction * strideRef.current;
    viewport.scrollTo({ left, behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ? "instant" : "smooth" });
  };

  return <div ref={carouselRef} className="shop-bundle-carousel" data-single={items.length === 1 || undefined}
    onPointerEnter={(event) => { if (event.pointerType === "mouse") hoveredRef.current = true; }}
    onPointerLeave={() => { hoveredRef.current = false; }}
    onFocusCapture={() => { focusedRef.current = true; }}
    onBlurCapture={(event) => {
      if (!carouselRef.current?.contains(event.relatedTarget as Node | null)) focusedRef.current = false;
    }}
    onPointerDown={pauseBriefly} onTouchStart={pauseBriefly} onTouchMove={pauseBriefly} onWheel={pauseBriefly}
    role="region" aria-roledescription="輪播" aria-label="套組優惠">
    <div ref={viewportRef} className="shop-bundle-carousel-viewport" tabIndex={overflow ? 0 : undefined}
      role="group" aria-label="套組清單，可左右捲動">
      <div className="shop-bundle-carousel-track">{ordered}</div>
    </div>
    {overflow && <div className="shop-bundle-carousel-controls">
      <p>{paused || reducedMotion ? "左右滑動瀏覽套組" : "套組緩慢自動展示，也可左右滑動"}</p>
      <div>
        {!reducedMotion && <button type="button" aria-label={paused ? "繼續自動滑動" : "暫停自動滑動"}
          onClick={() => setPaused((current) => !current)}>
          {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
        </button>}
        <button type="button" aria-label="上一個套組" onClick={() => browse(-1)}>
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <button type="button" aria-label="下一個套組" onClick={() => browse(1)}>
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </div>
    </div>}
  </div>;
}
