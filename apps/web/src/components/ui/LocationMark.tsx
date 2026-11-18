"use client";

import { useLayoutEffect, useRef } from "react";

import { MOTION_EASE_OUT, shouldReduceMotion } from "@/lib/motion";

/**
 * 導覽中標示「目前位置」的金線。換頁時從上一個位置滑到新位置，
 * 讓使用者看見自己從哪裡移到哪裡。
 *
 * 公開頁的 header 會隨頁面重新掛載，中間也可能先出現載入畫面，
 * 所以不依賴 View Transition 配對：舊金線卸載時記下位置，新金線
 * 掛載時從該位置以 transform 滑入（FLIP）。首屏與減少動態時不播放。
 */

type MarkSnapshot = { rect: DOMRect | null; at: number };

const SNAPSHOT_TTL_MS = 1600;
const STATE_CHANGE_AFTER_MS = 300;

const snapshots = new Map<string, MarkSnapshot>();
const scopeMountedAt = new Map<string, number>();

function isMeasurable(rect: DOMRect | null | undefined): rect is DOMRect {
  return Boolean(rect && rect.width > 0 && rect.height > 0);
}

function isOnScreen(rect: DOMRect) {
  return rect.bottom > 0 && rect.right > 0
    && rect.top < window.innerHeight && rect.left < window.innerWidth;
}

function glide(mark: HTMLElement, from: DOMRect, to: DOMRect) {
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const distance = Math.hypot(dx, dy);
  if (distance < 1 && Math.abs(from.width - to.width) < 1) return;

  mark.animate(
    [
      {
        transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width}, ${from.height / to.height})`,
      },
      { transform: "none" },
    ],
    // 距離越遠稍微越久：相鄰項目約 320ms，跨越整列不超過 460ms。
    { duration: Math.round(300 + Math.min(distance, 640) * 0.25), easing: MOTION_EASE_OUT },
  );
}

function arrive(mark: HTMLElement, rect: DOMRect) {
  const vertical = rect.height > rect.width;
  const offset = vertical ? `0, ${rect.height * 0.3}px` : `${rect.width * 0.3}px, 0`;
  const scale = vertical ? "1, 0.4" : "0.4, 1";
  mark.animate(
    [
      { opacity: 0, transform: `translate(${offset}) scale(${scale})` },
      { opacity: 1, transform: "none" },
    ],
    { duration: 260, easing: MOTION_EASE_OUT },
  );
}

/**
 * 在導覽容器呼叫：容器卸載時記下「這裡曾有導覽」，讓下一頁的金線以進場呈現。
 * `ready` 為 false（例如仍顯示骨架）時不登記，導覽首次出現不算使用者操作。
 */
export function useLocationMarkScope(group: string, ready = true) {
  useLayoutEffect(() => {
    if (!ready) return;
    scopeMountedAt.set(group, performance.now());
    return () => {
      scopeMountedAt.delete(group);
      const now = performance.now();
      const current = snapshots.get(group);
      // 子元件的金線可能已先記下位置；保留較新的實際位置。
      if (!current || now - current.at > 50) snapshots.set(group, { rect: null, at: now });
    };
  }, [group, ready]);
}

export default function LocationMark({ group, className }: { group: string; className: string }) {
  const markRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const mark = markRef.current;
    if (!mark) return;

    const now = performance.now();
    const previous = snapshots.get(group);
    snapshots.delete(group);
    const rect = mark.getBoundingClientRect();
    const recent = previous !== undefined && now - previous.at < SNAPSHOT_TTL_MS;
    const containerAt = scopeMountedAt.get(group);

    if (isMeasurable(rect) && !shouldReduceMotion()) {
      // 上一個位置不在畫面上（例如收起的手機側欄）時改為原地進場，避免金線從畫面外飛入。
      if (recent && isMeasurable(previous.rect) && isOnScreen(previous.rect)) {
        glide(mark, previous.rect, rect);
      } else if (recent || (containerAt !== undefined && now - containerAt > STATE_CHANGE_AFTER_MS)) {
        arrive(mark, rect);
      }
    }

    return () => {
      // 卸載時節點仍在文件中；取得的位置包含進行中的動畫，連點也能從目前畫面位置接續。
      const last = mark.getBoundingClientRect();
      snapshots.set(group, { rect: isMeasurable(last) ? last : null, at: performance.now() });
    };
  }, [group]);

  return <span ref={markRef} aria-hidden="true" className={`location-mark ${className}`} />;
}
