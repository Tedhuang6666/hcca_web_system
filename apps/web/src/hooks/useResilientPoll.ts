"use client";
import { useEffect, useRef } from "react";

export type PollOutcome = "ok" | "stop";

interface Options {
  /** 是否啟用輪詢（例如未登入時傳 false，連一次都不打）。 */
  enabled: boolean;
  /** 正常情況下的輪詢間隔（毫秒）。 */
  intervalMs: number;
  /** 暫時性錯誤的退避起點（毫秒）。 */
  backoffStartMs?: number;
  /** 退避上限（毫秒）。 */
  backoffMaxMs?: number;
}

/**
 * 具備退避與「停止後可恢復」能力的輪詢，用來取代裸 setInterval。
 *
 *  - `task()` 回傳 `"ok"`：成功，依 `intervalMs` 排下一次。
 *  - `task()` 回傳 `"stop"`：致命錯誤（如 401/403/522）→ 停止輪詢，
 *    直到 `online` / 視窗重新可見 / 重新聚焦 才恢復，避免對著掛掉的後端或
 *    失效的 session 空打。
 *  - `task()` 拋出例外：視為暫時性網路錯誤，以指數退避重試（封頂 `backoffMaxMs`）。
 *
 * enabled 變為 false 或 unmount 時會清掉計時器並移除所有事件監聽。
 */
export function useResilientPoll(task: () => Promise<PollOutcome>, opts: Options) {
  const { enabled, intervalMs, backoffStartMs = 5_000, backoffMaxMs = 60_000 } = opts;
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let halted = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clear = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const schedule = (ms: number) => {
      clear();
      timer = setTimeout(run, ms);
    };

    // 頁面可見且未離線時才算「醒著」，否則一律停止輪詢
    const isAwake = () =>
      (typeof document === "undefined" || document.visibilityState === "visible")
      && (typeof navigator === "undefined" || navigator.onLine !== false);

    async function run() {
      if (cancelled) return;
      let outcome: PollOutcome;
      try {
        outcome = await taskRef.current();
      } catch {
        // 暫時性錯誤：指數退避（1→2→4… 倍 backoffStartMs，封頂 backoffMaxMs）
        if (cancelled) return;
        failures += 1;
        schedule(Math.min(backoffMaxMs, backoffStartMs * 2 ** (failures - 1)));
        return;
      }
      if (cancelled) return;
      if (outcome === "stop") {
        halted = true;
        clear();
        return;
      }
      failures = 0;
      schedule(intervalMs);
    }

    // online / 重新可見 / 重新聚焦 → 若先前停掉了且已醒著就恢復
    const resume = () => {
      if (cancelled || !halted || !isAwake()) return;
      halted = false;
      failures = 0;
      run();
    };
    // 頁面隱藏或離線 → 立即停止輪詢（清計時器並標記 halted，待喚醒再續）
    const pause = () => {
      if (cancelled || halted) return;
      halted = true;
      clear();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") resume();
      else pause();
    };

    // 啟動時若已隱藏/離線就先不發第一發
    if (isAwake()) run();
    else halted = true;

    window.addEventListener("online", resume);
    window.addEventListener("offline", pause);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clear();
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", pause);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, backoffStartMs, backoffMaxMs]);
}
