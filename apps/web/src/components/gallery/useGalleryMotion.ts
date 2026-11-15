"use client";

import { useEffect, type RefObject } from "react";

export function useGalleryMotion(rootRef: RefObject<HTMLDivElement | null>, selection: string) {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    let revert: (() => void) | undefined;
    void Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(([{ gsap }, { ScrollTrigger }]) => {
      if (cancelled || !rootRef.current) return;
      gsap.registerPlugin(ScrollTrigger);
      const root = rootRef.current;
      if (!root.querySelector(".archive-opening-photo")) return;
      const context = gsap.context(() => {
        const opening = gsap.timeline({ defaults: { ease: "expo.out" } });
        opening.from(".archive-opening-photo", { scale: 0.58, opacity: 0, y: 55, duration: 1.7, clearProps: "transform,opacity" }, 0)
          .from(".archive-orbit-photo", { x: (index) => index % 2 ? -220 : 220,
            y: (index) => index % 2 ? -100 : 100, rotation: (index) => index % 2 ? -18 : 18,
            opacity: 0, scale: 0.55, duration: 1.8, stagger: 0.14, clearProps: "transform,opacity" }, 0.65)
          .from(".archive-topline h1, .archive-event-heading", { y: 35, opacity: 0, duration: 1.1, stagger: 0.12, clearProps: "transform,opacity" }, 0.8);
        gsap.utils.toArray<HTMLElement>(".archive-orbit-photo").forEach((photo, index) => {
          gsap.to(photo, { y: index % 2 ? -110 : 80, rotation: index % 2 ? 8 : -7, ease: "none",
            scrollTrigger: { trigger: ".archive-opening-scene", start: "top top", end: "bottom top", scrub: 1.4 } });
        });
        gsap.utils.toArray<HTMLElement>(".archive-spread-item").forEach((photo, index) => {
          gsap.fromTo(photo, { y: index % 2 ? 110 : 60, rotation: index % 2 ? 3 : -3, scale: 0.92 },
            { y: 0, rotation: 0, scale: 1, ease: "none",
              scrollTrigger: { trigger: photo, start: "top bottom", end: "center 55%", scrub: 1 } });
        });
        const wall = root.querySelector(".infinite-wall");
        if (wall) {
          gsap.fromTo(".infinite-wall-plane", { scale: 0.8, rotation: -5 }, { scale: 1, rotation: 0, ease: "none",
            scrollTrigger: { trigger: wall, start: "top bottom", end: "top 15%", scrub: 1.2 } });
          gsap.from(".infinite-wall-heading h2", { xPercent: -16, ease: "none",
            scrollTrigger: { trigger: wall, start: "top bottom", end: "top 20%", scrub: 1 } });
        }
      }, root);
      revert = () => context.revert();
      ScrollTrigger.refresh();
    }).catch((error: unknown) => { console.error("Gallery motion could not initialize", error); });
    return () => { cancelled = true; revert?.(); };
  }, [rootRef, selection]);
}
