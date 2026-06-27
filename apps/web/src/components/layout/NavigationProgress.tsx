"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * 全域導航進度條。
 * 偵測到內部連結被點擊時立即顯示，pathname 變動後完成並淡出。
 * 解決 Next.js App Router 切換頁面時毫無視覺回饋、使用者重複點擊的問題。
 */
export default function NavigationProgress() {
  const pathname = usePathname();
  const barRef = useRef<HTMLDivElement>(null);
  const s = useRef({ active: false, raf: null as number | null, timer: null as ReturnType<typeof setTimeout> | null });

  // 導航完成：pathname 改變時觸發
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || !s.current.active) return;
    s.current.active = false;
    if (s.current.raf !== null) { cancelAnimationFrame(s.current.raf); s.current.raf = null; }
    if (s.current.timer !== null) { clearTimeout(s.current.timer); s.current.timer = null; }
    bar.style.transition = "width 0.15s ease-out";
    bar.style.width = "100%";
    s.current.timer = setTimeout(() => {
      if (barRef.current) barRef.current.style.opacity = "0";
      document.documentElement.removeAttribute("data-navigation");
    }, 200);
  }, [pathname]);

  // 導航開始：監聽內部連結點擊
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as Element).closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      // 只處理內部路徑
      if (!href.startsWith("/") && !href.startsWith(window.location.origin)) return;
      if (anchor.target === "_blank") return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const bar = barRef.current;
      if (!bar) return;
      if (s.current.timer !== null) { clearTimeout(s.current.timer); s.current.timer = null; }
      if (s.current.raf !== null) { cancelAnimationFrame(s.current.raf); s.current.raf = null; }
      s.current.active = true;
      document.documentElement.setAttribute("data-navigation", "pending");
      bar.style.transition = "none";
      bar.style.opacity = "1";
      bar.style.width = "0%";
      s.current.raf = requestAnimationFrame(() => {
        if (!barRef.current) return;
        barRef.current.style.transition = "width 8s cubic-bezier(0.1, 0.8, 0.5, 1)";
        barRef.current.style.width = "80%";
      });
    };

    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      document.documentElement.removeAttribute("data-navigation");
    };
  }, []);

  return (
    <div
      ref={barRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        height: "2px",
        width: "0%",
        opacity: 0,
        background: "var(--primary)",
        zIndex: 9999,
        pointerEvents: "none",
        boxShadow: "0 0 8px color-mix(in srgb, var(--primary) 60%, transparent)",
      }}
    />
  );
}
