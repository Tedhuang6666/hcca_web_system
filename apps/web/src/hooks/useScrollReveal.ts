"use client";

import { useEffect } from "react";

/**
 * 捲動進場：為帶有 [data-reveal] 的元素在進入視窗時加上 .is-reveal-in。
 *
 * - 公開站內容多在前端載入完成後才掛載，故依 deps 重新掃描尚未顯示的新節點。
 * - prefers-reduced-motion（或無 IntersectionObserver）時直接顯示，不做位移動畫。
 * - 由本 hook 在 <html> 標記 data-reveal-ready；CSS 只在此旗標存在時才隱藏元素，
 *   因此 JS 未執行時內容仍可見（漸進增強，不影響可用性 / SEO 退化）。
 *
 * 與 src/app/globals.css 的 [data-reveal] 規則為單一來源搭配，勿在各頁重寫。
 */
export function useScrollReveal(deps: unknown[] = []) {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-reveal-ready", "");

    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-reveal-in)"),
    );
    if (nodes.length === 0) return;

    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduce || typeof IntersectionObserver === "undefined") {
      nodes.forEach((node) => node.classList.add("is-reveal-in"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-reveal-in");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
