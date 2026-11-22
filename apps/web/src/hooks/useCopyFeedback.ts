"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { copyText } from "@/lib/clipboard";

export type CopyResult = "copied" | "failed";

/** 結果停留多久後回到原狀；失敗多留一點時間讓人看清楚。 */
const SETTLE_AFTER_MS: Record<CopyResult, number> = { copied: 1800, failed: 2600 };

/**
 * 複製的狀態機：idle → copied / failed → idle。
 * `result` 保留最後一次結果，讓回到 idle 時的退場動畫知道要收回哪個符號；
 * `attempt` 每次複製遞增，讓連續點擊也能重畫勾號。
 */
export function useCopyFeedback() {
  const [state, setState] = useState<CopyResult | "idle">("idle");
  const [result, setResult] = useState<CopyResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const copy = useCallback(async (value: string): Promise<boolean> => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    let next: CopyResult = "copied";
    try {
      await copyText(value);
    } catch {
      next = "failed";
    }
    setState(next);
    setResult(next);
    setAttempt((count) => count + 1);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setState("idle");
    }, SETTLE_AFTER_MS[next]);
    return next === "copied";
  }, []);

  return { state, result, attempt, copy };
}
