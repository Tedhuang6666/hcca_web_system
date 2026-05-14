"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, SetStateAction } from "react";

const DEFAULT_ZOOM = 100;
const MIN_ZOOM = 70;
const MAX_ZOOM = 150;

type ZoomStyle = CSSProperties & { zoom: number };

function clampZoom(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value / 10) * 10));
}

export function usePersistedZoom(storageKey: string) {
  const [zoom, setZoomState] = useState(DEFAULT_ZOOM);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) setZoomState(clampZoom(Number(stored)));
    } catch {
      // localStorage may be unavailable in private browsing or restricted contexts.
    }
  }, [storageKey]);

  const setZoom = useCallback((next: SetStateAction<number>) => {
    setZoomState((current) => {
      const value = clampZoom(typeof next === "function" ? next(current) : next);
      try {
        window.localStorage.setItem(storageKey, String(value));
      } catch {
        // Ignore persistence failures; zoom still works for this page view.
      }
      return value;
    });
  }, [storageKey]);

  const zoomStyle = useMemo(() => ({ zoom: zoom / 100 }) as ZoomStyle, [zoom]);

  return { zoom, setZoom, zoomStyle };
}
