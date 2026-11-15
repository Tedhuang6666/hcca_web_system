"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";

const SCROLL_MEDIA = "(min-height: 540px) and (prefers-reduced-motion: no-preference)";

/** A complete static composition is rendered before optional scroll choreography. */
export default function HomeHeroScene({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root?.querySelector(".campus-hero-activity")) return;

    const query = window.matchMedia(SCROLL_MEDIA);
    let cancelled = false;
    let started = false;
    let revert: (() => void) | undefined;
    const initialize = () => {
      if (started || !query.matches) return;
      started = true;
      void Promise.all([import("gsap"), import("gsap/ScrollTrigger")])
        .then(([{ gsap }, { ScrollTrigger }]) => {
          if (cancelled) return;
          gsap.registerPlugin(ScrollTrigger);
          const media = gsap.matchMedia();
          revert = () => media.revert();
          media.add(
            SCROLL_MEDIA,
            () => {
              if (root.querySelector(".activity-image-unavailable")) return;
              const activity = root.querySelector<HTMLElement>(".campus-hero-activity");
              if (!activity) return;
              root.dataset.motion = "scroll";
              const timeline = gsap.timeline({
                defaults: { ease: "none" },
                scrollTrigger: {
                  trigger: root,
                  start: "top top+=96",
                  end: () => "+=" + Math.min(window.innerHeight * 0.38, 360),
                  scrub: true,
                  invalidateOnRefresh: true,
                },
              });
              timeline
                .fromTo(activity, { x: 40, y: 28, rotation: 4 },
                  { x: 0, y: 0, rotation: 0, duration: 0.5 }, 0)
                .fromTo(activity, { "--photo-bleed": 0 },
                  { "--photo-bleed": 1, duration: 0.55 }, 0.25)
                .fromTo(".campus-event-meta", { opacity: 0.8, y: 12 },
                  { opacity: 1, y: 0, duration: 0.2 }, 0.6)
                .fromTo(".campus-event-title", { opacity: 0.8, y: 12 },
                  { opacity: 1, y: 0, duration: 0.2 }, 0.7)
                .fromTo(".campus-event-link", { opacity: 0.8, y: 12 },
                  { opacity: 1, y: 0, duration: 0.2 }, 0.8);

              // Image failure restores the compact, readable static layout.
              const observer = new MutationObserver(() => {
                if (root.querySelector(".activity-image-unavailable")) media.revert();
              });
              observer.observe(root, { childList: true, subtree: true });
              return () => {
                observer.disconnect();
                delete root.dataset.motion;
              };
            },
            root,
          );
        })
        .catch((error: unknown) => {
          revert?.();
          console.error("Homepage motion could not initialize", error);
        });
    };
    query.addEventListener("change", initialize);
    initialize();

    return () => {
      cancelled = true;
      query.removeEventListener("change", initialize);
      revert?.();
    };
  }, []);

  return (
    <div className="campus-masthead" ref={rootRef}>
      <div className="campus-hero-stage">
        <div className="campus-hero-composition">{children}</div>
        <a className="campus-hero-next" href="#campus-news-title" aria-label="跳至最新消息">
          <ArrowDown size={20} aria-hidden />
        </a>
      </div>
    </div>
  );
}
