"use client";

import { Children, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

export default function BundleCarousel({ children }: { children: ReactNode }) {
  const items = Children.toArray(children);
  const [rotation, setRotation] = useState(0);
  const [overflow, setOverflow] = useState(false);
  const [stopped, setStopped] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);
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
    let loopable = false;
    let fractionalDistance = 0;
    let previousTime: number | null = null;
    let active = true;

    const stop = () => {
      stoppedRef.current = true;
      setStopped(true);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
    const measure = () => {
      const first = track.firstElementChild;
      strideRef.current = first
        ? first.getBoundingClientRect().width + (parseFloat(getComputedStyle(track).columnGap) || 0)
        : 0;
      setOverflow(viewport.scrollWidth > viewport.clientWidth + 1);
      loopable = items.length > 1 && strideRef.current > 0
        && viewport.scrollWidth - viewport.clientWidth >= strideRef.current - 1;
    };
    const tick = (time: number) => {
      if (!active || stoppedRef.current) return;
      const stride = strideRef.current;
      // 留一個完整品項的空間，移到最左側後再接到隊尾，不複製優惠或操作按鈕。
      if (previousTime !== null && loopable && visible && !document.hidden && !motion?.matches
        && !pendingShift.current) {
        fractionalDistance += Math.min(time - previousTime, 64) * 0.032;
        const distance = Math.floor(fractionalDistance);
        viewport.scrollLeft += distance;
        fractionalDistance -= distance;
        if (viewport.scrollLeft >= stride - 1) {
          pendingShift.current = stride;
          setRotation((current) => current + 1);
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
    document.addEventListener("pointerdown", stop, true);
    document.addEventListener("click", stop, true);
    document.addEventListener("focusin", stop, true);
    viewport.addEventListener("wheel", stop, { capture: true, passive: true });
    document.addEventListener("touchstart", stop, { capture: true, passive: true });
    motion?.addEventListener("change", stop);
    if (motion?.matches) stop();
    else if (items.length > 1 && !stoppedRef.current) frameRef.current = window.requestAnimationFrame(tick);

    return () => {
      active = false;
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      resize?.disconnect();
      intersection?.disconnect();
      document.removeEventListener("pointerdown", stop, true);
      document.removeEventListener("click", stop, true);
      document.removeEventListener("focusin", stop, true);
      viewport.removeEventListener("wheel", stop, true);
      document.removeEventListener("touchstart", stop, true);
      motion?.removeEventListener("change", stop);
    };
  }, [items.length]);

  const browse = (direction: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const maximum = viewport.scrollWidth - viewport.clientWidth;
    const left = direction < 0 && viewport.scrollLeft <= 1 ? maximum
      : direction > 0 && viewport.scrollLeft >= maximum - 1 ? 0
        : viewport.scrollLeft + direction * strideRef.current;
    viewport.scrollTo({ left, behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ? "instant" : "smooth" });
  };

  return <div className="shop-bundle-carousel" data-single={items.length === 1 || undefined}
    role="region" aria-roledescription="輪播" aria-label="套組優惠">
    <div ref={viewportRef} className="shop-bundle-carousel-viewport" tabIndex={overflow ? 0 : undefined}
      role="group" aria-label="套組清單，可左右捲動">
      <div className="shop-bundle-carousel-track">{ordered}</div>
    </div>
    {overflow && <div className="shop-bundle-carousel-controls">
      <p>{stopped ? "左右滑動瀏覽套組" : "自動滑動瀏覽，點擊頁面即可停止"}</p>
      <div>
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
