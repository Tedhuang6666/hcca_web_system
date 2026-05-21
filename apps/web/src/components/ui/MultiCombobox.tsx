"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ComboboxOption } from "./Combobox";

interface MultiComboboxProps {
  /** 已選項目（完整物件，作為唯一真實來源） */
  selected: ComboboxOption[];
  onChange: (selected: ComboboxOption[]) => void;
  /** dropdown 候選清單 */
  options: ComboboxOption[];
  placeholder?: string;
  /** 提供時切換為非同步搜尋模式（不本地過濾，options 由父層依關鍵字更新） */
  onSearch?: (keyword: string) => void;
  disabled?: boolean;
  emptyText?: string;
  maxHeight?: string;
}

/**
 * 多選可搜尋下拉選單。已選項目以 chip 顯示於輸入框上方，選取後 dropdown 不關閉。
 * 同步模式（無 onSearch）本地過濾；非同步模式由父層依 onSearch 更新 options。
 */
export default function MultiCombobox({
  selected,
  onChange,
  options,
  placeholder = "搜尋並選擇",
  onSearch,
  disabled = false,
  emptyText = "無相符選項",
  maxHeight = "15rem",
}: MultiComboboxProps) {
  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const selectedValues = useMemo(
    () => new Set(selected.map((s) => s.value)),
    [selected],
  );

  const candidates = useMemo(() => {
    const pool = options.filter((o) => !selectedValues.has(o.value));
    if (onSearch) return pool; // 非同步：伺服器已過濾
    const q = keyword.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter((o) =>
      `${o.label} ${o.description ?? ""} ${o.keywords ?? ""}`.toLowerCase().includes(q),
    );
  }, [options, selectedValues, keyword, onSearch]);

  useEffect(() => {
    setActiveIndex(0);
  }, [candidates.length, open]);

  const add = (opt: ComboboxOption) => {
    onChange([...selected, opt]);
    setKeyword("");
    if (onSearch) onSearch("");
    inputRef.current?.focus();
  };

  const remove = (value: string) => {
    onChange(selected.filter((s) => s.value !== value));
  };

  return (
    <div className="relative">
      {selected.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {selected.map((s) => (
            <span
              key={s.value}
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs"
              style={{ background: "var(--primary-dim)", color: "var(--primary)" }}
            >
              {s.label}
              <button
                type="button"
                aria-label={`移除 ${s.label}`}
                disabled={disabled}
                onMouseDown={(e) => {
                  e.preventDefault();
                  remove(s.value);
                }}
                className="text-sm leading-none hover:opacity-60"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        disabled={disabled}
        value={keyword}
        placeholder={placeholder}
        onChange={(e) => {
          setKeyword(e.target.value);
          setOpen(true);
          onSearch?.(e.target.value);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open && e.key !== "Tab") setOpen(true);
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, candidates.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (candidates[activeIndex]) add(candidates[activeIndex]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
        className="w-full rounded-lg px-3 py-2 text-sm outline-none disabled:opacity-50"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          color: "var(--text-primary)",
        }}
      />

      {open && candidates.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 overflow-y-auto rounded-xl shadow-lg"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", maxHeight }}
        >
          {candidates.map((opt, idx) => (
            <li key={opt.value} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseEnter={() => setActiveIndex(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(opt);
                }}
                className="w-full px-3 py-2 text-left transition-colors"
                style={{
                  background: idx === activeIndex ? "var(--primary-dim)" : "transparent",
                  color: "var(--text-primary)",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <p className="text-sm">{opt.label}</p>
                {opt.description && (
                  <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {opt.description}
                  </p>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && keyword.trim() && candidates.length === 0 && (
        <div
          className="absolute left-0 right-0 top-full z-30 mt-1 rounded-xl px-3 py-2 text-center text-xs"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
          }}
        >
          {emptyText}
        </div>
      )}
    </div>
  );
}
