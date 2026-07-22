"use client";
import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * 全域導航進度條。
 * 偵測到內部連結被點擊時立即顯示，pathname 變動後完成並淡出。
 * 解決 Next.js App Router 切換頁面時毫無視覺回饋、使用者重複點擊的問題。
 */
export default function NavigationProgress() {
  const pathname = usePathname();
  const router = useRouter();
  const barRef = useRef<HTMLDivElement>(null);
  const s = useRef({ active: false, raf: null as number | null, timer: null as ReturnType<typeof setTimeout> | null });
  const prefetched = useRef(new Set<string>());
  const lastStart = useRef<{ href: string; at: number } | null>(null);
  const prefetchOnIntent = process.env.NODE_ENV !== "development";

  const isFullNavigation = (anchor: HTMLAnchorElement) =>
    anchor.dataset.fullNavigation === "true"
    || anchor.getAttribute("href")?.startsWith("/api/") === true;

  const internalPathFromAnchor = useCallback((anchor: HTMLAnchorElement): string | null => {
    const href = anchor.getAttribute("href") ?? "";
    if (!href || href.startsWith("#")) return null;
    if (anchor.target === "_blank") return null;

    try {
      const url = new URL(href, window.location.origin);
      if (url.origin !== window.location.origin) return null;
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return null;
      }
      return `${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  }, []);

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
    const startNavigation = (href: string) => {
      const now = Date.now();
      const recent = lastStart.current;
      if (recent?.href === href && now - recent.at < 600) return;
      lastStart.current = { href, at: now };

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

    const handlePointerDown = (e: PointerEvent) => {
      const anchor = (e.target as Element).closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (isFullNavigation(anchor)) return;
      const href = internalPathFromAnchor(anchor);
      if (!href) return;
      startNavigation(href);
    };

    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as Element).closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (isFullNavigation(anchor)) return;
      const href = internalPathFromAnchor(anchor);
      if (!href) return;
      startNavigation(href);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("click", handleClick, true);
      document.documentElement.removeAttribute("data-navigation");
    };
  }, [internalPathFromAnchor]);

  // 預熱高頻導航：使用者 hover / focus / touch 到內部連結時先載入 RSC payload。
  useEffect(() => {
    const warmup = (target: EventTarget | null) => {
      if (!prefetchOnIntent) return;
      const anchor = (target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (isFullNavigation(anchor)) return;
      // OAuth login endpoints create a server-side state/session and redirect
      // to the provider; prefetching them starts an unintended login flow.
      if (anchor.dataset.noPrefetch === "true") return;
      const href = internalPathFromAnchor(anchor);
      if (!href || prefetched.current.has(href)) return;
      prefetched.current.add(href);
      router.prefetch(href);
    };

    const handlePointerOver = (e: PointerEvent) => warmup(e.target);
    const handleFocusIn = (e: FocusEvent) => warmup(e.target);
    const handleTouchStart = (e: TouchEvent) => warmup(e.target);

    document.addEventListener("pointerover", handlePointerOver, { passive: true });
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    return () => {
      document.removeEventListener("pointerover", handlePointerOver);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("touchstart", handleTouchStart);
    };
  }, [internalPathFromAnchor, prefetchOnIntent, router]);

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
