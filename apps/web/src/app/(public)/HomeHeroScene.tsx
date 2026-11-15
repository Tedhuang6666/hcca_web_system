"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";

const SCROLL_MEDIA = "(min-width: 1024px) and (min-height: 700px) and (prefers-reduced-motion: no-preference)";

/** The server-rendered split layout remains usable when motion cannot initialize. */
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
              root.dataset.motion = "scroll";
              const copy = root.querySelector<HTMLElement>(".campus-masthead-copy");
              const composition = root.querySelector<HTMLElement>(".campus-hero-composition");
              if (copy && composition && copy.scrollHeight > composition.clientHeight) {
                delete root.dataset.motion;
                return;
              }
              const timeline = gsap.timeline({
                defaults: { ease: "none" },
                scrollTrigger: {
                  trigger: root,
                  start: "top top",
                  end: "bottom bottom",
                  scrub: true,
                  invalidateOnRefresh: true,
                },
              });
              timeline
                .to(".campus-masthead-copy", { opacity: 0, y: -32, duration: 0.3 }, 0)
                .fromTo(".campus-hero-activity", { width: "54%", rotation: 4 },
                  { width: "100%", rotation: 0, duration: 1 }, 0);

              // A failed image must also restore the title and remove the scroll runway.
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
        <a className="campus-hero-next" href="#campus-news-title">
          最新消息<ArrowDown size={18} aria-hidden />
        </a>
      </div>
    </div>
  );
}
