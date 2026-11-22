"use client";

import { useSyncExternalStore } from "react";
import { prefersReducedNetworkUsage } from "@/lib/data-saver";

const VECTOR_VIEWPORT = "(min-width: 1024px)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(VECTOR_VIEWPORT);
  media.addEventListener("change", onChange);
  window.addEventListener("hcca:low-data-mode-change", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener("hcca:low-data-mode-change", onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot() {
  return window.matchMedia(VECTOR_VIEWPORT).matches && !prefersReducedNetworkUsage();
}

export function useVectorBasemap() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
