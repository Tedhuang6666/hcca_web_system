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

    // online / 重新可見 / 重新聚焦 → 若先前停掉了就恢復
    const resume = () => {
      if (cancelled || !halted) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      halted = false;
      failures = 0;
      run();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") resume();
    };

    run();
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clear();
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, backoffStartMs, backoffMaxMs]);
}
