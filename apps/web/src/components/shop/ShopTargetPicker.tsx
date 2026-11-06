"use client";

import { useEffect, useId, useState } from "react";
import { Search, X } from "lucide-react";
import { apiErrorMessage, shopApi } from "@/lib/api";
import type { ShopTargetOut } from "@/lib/types";

export function targetIdentifiers(text: string): string[] {
  return [...new Set(text.split(/[\s,，;；]+/u).map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

function identityDetails(person: ShopTargetOut) {
  return [person.student_id ? `學號 ${person.student_id}` : person.email,
    person.class_label, person.seat_number ? `${person.seat_number} 號` : null].filter(Boolean).join(" · ");
}

export default function ShopTargetPicker({ label, value, onChange, activityId = null, disabled = false, max = 2000, help }: {
  label: string;
  value: string[];
  onChange: (identifiers: string[]) => void;
  activityId?: string | null;
  disabled?: boolean;
  max?: number;
  help: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [visibleCount, setVisibleCount] = useState(50);
  const valueKey = value.join("\n");
  const [bulk, setBulk] = useState({ key: valueKey, text: valueKey });
  if (bulk.key !== valueKey) setBulk({ key: valueKey, text: valueKey });
  const [search, setSearch] = useState<{ key: string; rows: ShopTargetOut[]; error: string } | null>(null);
  const [resolved, setResolved] = useState<{ key: string; rows: ShopTargetOut[]; error: string } | null>(null);
  const keyword = query.trim();
  const searchKey = JSON.stringify([activityId, keyword, attempt]);
  const lookupKey = JSON.stringify([activityId, valueKey, attempt]);

  useEffect(() => {
    if (!keyword) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void shopApi.lookupTargets({ activity_id: activityId, keyword }).then((rows) => {
        if (!cancelled) setSearch({ key: searchKey, rows, error: "" });
      }).catch((error) => {
        if (!cancelled) setSearch({ key: searchKey, rows: [], error: apiErrorMessage(error, "搜尋失敗，請重新搜尋。") });
      });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [activityId, keyword, searchKey]);

  useEffect(() => {
    if (!valueKey || valueKey.split("\n").length > max) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void shopApi.lookupTargets({ activity_id: activityId, keyword: "", identifiers: valueKey.split("\n") }).then((rows) => {
        if (!cancelled) setResolved({ key: lookupKey, rows, error: "" });
      }).catch((error) => {
        if (!cancelled) setResolved({ key: lookupKey, rows: [], error: apiErrorMessage(error, "名單核對失敗，輸入內容已保留。") });
      });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [activityId, valueKey, lookupKey, max]);

  const results = search?.key === searchKey ? search : null;
  const checked = resolved?.key === lookupKey ? resolved : null;
  const people = new Map(checked?.rows.map((person) => [person.identifier, person]));
  const invalid = value.filter((item) => !/^(?:[0-9]{1,20}|[^\s@]+@[^\s@]+)$/u.test(item) || item.length > 255);
  const unknown = checked?.rows.filter((person) => !person.matched).length ?? 0;

  return <fieldset disabled={disabled} className="min-w-0 space-y-3" aria-describedby={`${id}-help`}>
    <legend className="text-sm font-medium">{label}</legend>
    <p id={`${id}-help`} className="text-sm" style={{ color: "var(--text-secondary)" }}>{help}</p>
    <label htmlFor={`${id}-search`} className="block text-sm">搜尋姓名、學號或 Email</label>
    <div className="relative">
      <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5" style={{ color: "var(--text-secondary)" }} />
      <input id={`${id}-search`} type="search" className="input min-h-11 w-full pl-10 text-base"
        aria-label={`${label}：搜尋姓名、學號或 Email`} autoComplete="off" value={query}
        placeholder="例如：王小明或 310001" onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} />
    </div>
    {keyword && <div aria-live="polite">
      {!results ? <p role="status" className="text-sm">正在搜尋人員…</p>
        : results.error ? <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{results.error}
          <button type="button" className="ml-2 min-h-11 underline" onClick={() => setAttempt((current) => current + 1)}>重新搜尋</button></p>
          : results.rows.length === 0 ? <p className="text-sm">找不到相符人員。可換個姓名或學號；尚未建檔的學號可用下方批次輸入預先指定。</p>
            : <><ul aria-label={`${label}搜尋結果`} className="max-h-64 divide-y overflow-y-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
              {results.rows.map((person) => {
                const selected = value.includes(person.identifier) || Boolean(person.email && value.includes(person.email.toLowerCase()));
                return <li key={person.identifier}>
                  <button type="button" className="flex min-h-14 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-[var(--primary)] disabled:opacity-60"
                    disabled={selected || value.length >= max} aria-label={`加入 ${person.display_name ?? person.identifier}（${identityDetails(person)}）`}
                    onClick={() => onChange([...value, person.identifier])}>
                    <span className="min-w-0 break-words"><span className="block text-base font-medium">{person.display_name ?? "尚無姓名資料"}</span>
                      <span className="block text-sm" style={{ color: "var(--text-secondary)" }}>{identityDetails(person)}</span></span>
                    <span className="shrink-0 text-sm">{selected ? "已加入" : "加入"}</span>
                  </button>
                </li>;
              })}
            </ul>{results.rows.length >= 50 && <p className="mt-2 text-sm">目前顯示前 50 筆，請輸入更完整的姓名或學號縮小範圍。</p>}</>}
    </div>}
    <div className="space-y-2">
      <p className="text-sm font-medium" role="status">已選 {value.length} 人{unknown > 0 ? ` · ${unknown} 筆查無人員資料，請確認學號` : ""}</p>
      {value.length === 0 ? <p className="text-sm" style={{ color: "var(--text-secondary)" }}>尚未加入人員。</p>
        : <>
          {!checked && value.length <= max && <p className="text-sm" role="status">正在核對姓名與班級…</p>}
          {checked?.error && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{checked.error}
            <button type="button" className="ml-2 min-h-11 underline" onClick={() => setAttempt((current) => current + 1)}>重新核對</button></p>}
          <ul aria-label={`${label}已選名單`} className="max-h-80 divide-y overflow-y-auto" style={{ borderColor: "var(--border)" }}>
            {value.slice(0, visibleCount).map((identifier) => {
              const person = people.get(identifier);
              return <li key={identifier} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0 break-words text-sm">
                  <p className="font-medium">{person?.display_name ?? identifier}</p>
                  {person && <p style={{ color: "var(--text-secondary)" }}>{identityDetails(person) || identifier}</p>}
                  {person && <p style={{ color: person.matched ? "var(--text-secondary)" : "var(--warning)" }}>
                    {!person.matched ? "查無人員資料，請確認輸入；學號仍可預先指定。"
                      : person.account_active === null ? "尚未註冊帳號" : person.account_active ? "已建立帳號" : "帳號已停用"}
                  </p>}
                </div>
                <button type="button" className="btn btn-secondary flex min-h-11 min-w-11 shrink-0 items-center justify-center" aria-label={`移除 ${person?.display_name ?? identifier}（${identifier}）`}
                  onClick={() => onChange(value.filter((item) => item !== identifier))}><X size={16} aria-hidden="true" /></button>
              </li>;
            })}
          </ul>
          {value.length > visibleCount && <button type="button" className="btn btn-secondary min-h-11" onClick={() => setVisibleCount((current) => current + 50)}>再顯示 50 人（剩餘 {value.length - visibleCount} 人）</button>}
        </>}
    </div>
    <details>
      <summary className="min-h-11 cursor-pointer py-3 text-sm underline underline-offset-4">批次輸入學號或 Email</summary>
      <label htmlFor={`${id}-bulk`} className="mb-2 block text-sm">{label}（批次輸入）</label>
      <textarea id={`${id}-bulk`} rows={3} className="input w-full text-base" value={bulk.text}
        aria-describedby={`${id}-bulk-help`} placeholder="每行一筆學號或 Email，也可用逗號分隔"
        onChange={(event) => {
          const next = targetIdentifiers(event.target.value);
          setBulk({ key: next.join("\n"), text: event.target.value });
          onChange(next);
        }} />
      <p id={`${id}-bulk-help`} className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>貼上後會自動核對並顯示姓名與班級，重複資料只保留一筆。最多 {max.toLocaleString()} 人；姓名請用上方搜尋後選取。</p>
    </details>
    {(invalid.length > 0 || value.length > max) && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
      {value.length > max ? `名單超過 ${max.toLocaleString()} 人，請刪減後再儲存。` : `「${invalid.slice(0, 3).join("、")}」不是學號或 Email，姓名請用上方搜尋後選取。`}
    </p>}
  </fieldset>;
}
