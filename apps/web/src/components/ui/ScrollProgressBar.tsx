"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

export default function ScrollProgressBar() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const scrollTarget = document.getElementById("main-content") ?? window;

    const update = () => {
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        const el = scrollTarget instanceof HTMLElement ? scrollTarget : document.documentElement;
        const scrolled = el.scrollTop || document.body.scrollTop;
        const total = el.scrollHeight - el.clientHeight;
        setProgress(total > 0 ? (scrolled / total) * 100 : 0);
        frameRef.current = null;
      });
    };

    scrollTarget.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      scrollTarget.removeEventListener("scroll", update);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [pathname]);

  return (
    <div
      className="scroll-progress-bar"
      style={{ width: `${progress}%` }}
      role="progressbar"
      aria-valuenow={Math.round(progress)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="頁面捲動進度"
    />
  );
}
