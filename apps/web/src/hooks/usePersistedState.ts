"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

/**
 * useState 的持久化版本：值會寫進 localStorage，下次進頁自動還原。
 *
 * 為避免 SSR/CSR hydration mismatch，初次 render 一律回傳 `initial`，
 * 待 mount 後（effect）才從 localStorage 讀取覆蓋——與 usePersistedZoom 相同模式。
 *
 * 鍵名約定：`hcca:pref:<page>:v1`。
 */
export function usePersistedState<T>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initial);
  // 還沒從 localStorage 讀取前，不要回寫，否則會用 initial 覆蓋掉已存的偏好。
  const hydrated = useRef(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) setValue(JSON.parse(stored) as T);
    } catch {
      // localStorage 不可用（無痕 / 受限環境）或 JSON 損毀，沿用 initial。
    }
    hydrated.current = true;
    // 僅在 key 變動時重新讀取。
  }, [key]);

  const setPersisted = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      setValue((current) => {
        const resolved =
          typeof next === "function"
            ? (next as (prev: T) => T)(current)
            : next;
        if (hydrated.current) {
          try {
            window.localStorage.setItem(key, JSON.stringify(resolved));
          } catch {
            // 持久化失敗不影響本次 view 的狀態。
          }
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, setPersisted];
}
