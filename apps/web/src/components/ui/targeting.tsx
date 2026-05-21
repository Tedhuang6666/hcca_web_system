"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ComboboxOption } from "@/components/ui/Combobox";
import { emailApi, orgsApi, usersApi } from "@/lib/api";

/**
 * 對象選擇共用元件與 hooks。
 *
 * 「特定組織 / 特定職位 / 特定成員 / 全體」這套開放式選單邏輯散落在公告對象、
 * 郵件收件人、問卷限定對象等多處，此模組把重複的部分（模式切換列、組織清單載入、
 * 職位清單載入、使用者搜尋去抖）收斂成單一來源，供各 picker 組裝。
 */

/** 把帶 id/name 的參照陣列轉為 ComboboxOption。 */
export const toOptions = (refs?: { id: string; name: string }[]): ComboboxOption[] =>
  (refs ?? []).map((r) => ({ value: r.id, label: r.name }));

/** 模式切換 pill 列（公告對象、收件人模式、全體子範圍共用同一視覺）。 */
export function ModeTabs<T extends string>({
  modes,
  value,
  onChange,
  disabled = false,
}: {
  modes: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {modes.map((m) => (
        <button
          key={m.key}
          type="button"
          disabled={disabled}
          onClick={() => onChange(m.key)}
          className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
          style={
            value === m.key
              ? { background: "var(--primary)", color: "#1a1a2e" }
              : { background: "var(--bg-elevated)", color: "var(--text-muted)" }
          }
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** 載入啟用中的組織清單為 ComboboxOption。 */
export function useOrgOptions(): ComboboxOption[] {
  const [orgOptions, setOrgOptions] = useState<ComboboxOption[]>([]);
  useEffect(() => {
    orgsApi
      .list({ active_only: true })
      .then((orgs) => setOrgOptions(orgs.map((o) => ({ value: o.id, label: o.name }))))
      .catch(() => setOrgOptions([]));
  }, []);
  return orgOptions;
}

/** 依組織載入其職位清單為 ComboboxOption（orgId 為空時回傳空陣列）。 */
export function usePositionOptions(orgId: string): ComboboxOption[] {
  const [posOptions, setPosOptions] = useState<ComboboxOption[]>([]);
  useEffect(() => {
    if (!orgId) {
      setPosOptions([]);
      return;
    }
    emailApi
      .orgPositions(orgId)
      .then((ps) => setPosOptions(ps.map((p) => ({ value: p.id, label: p.name }))))
      .catch(() => setPosOptions([]));
  }, [orgId]);
  return posOptions;
}

/**
 * 使用者開放式搜尋（去抖、至少 2 字才查）。
 * 回傳目前候選清單與一個 search 觸發函式，給 MultiCombobox 的 onSearch 使用。
 */
export function useUserSearch(minChars = 2, delayMs = 250): {
  results: ComboboxOption[];
  search: (keyword: string) => void;
} {
  const [results, setResults] = useState<ComboboxOption[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(
    (kw: string) => {
      if (timer.current) clearTimeout(timer.current);
      if (kw.trim().length < minChars) {
        setResults([]);
        return;
      }
      timer.current = setTimeout(() => {
        usersApi
          .listForSearch(kw)
          .then((us) =>
            setResults(
              us.map((u) => ({ value: u.id, label: u.display_name, description: u.email })),
            ),
          )
          .catch(() => setResults([]));
      }, delayMs);
    },
    [minChars, delayMs],
  );

  return { results, search };
}
