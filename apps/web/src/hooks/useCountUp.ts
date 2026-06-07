"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 數字滾動動畫：當 value 改變時，於 durationMs 內以 easeOutCubic 平滑過渡到新值。
 *
 * - prefers-reduced-motion 時直接回傳目標值，不做逐格動畫。
 * - 回傳已四捨五入的整數，適合票數顯示。
 */
export function useCountUp(value: number, durationMs = 650): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const from = fromRef.current;
    const to = value;
    if (reduce || from === to || durationMs <= 0) {
      fromRef.current = to;
      setDisplay(to);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = Math.round(from + (to - from) * eased);
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      fromRef.current = value;
    };
  }, [value, durationMs]);

  return display;
}
