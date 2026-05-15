"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

export interface ComboboxOption {
  /** 唯一鍵值，作為 value 傳遞 */
  value: string;
  /** 顯示主要文字 */
  label: string;
  /** 顯示次要說明（如 email、組織前綴等） */
  description?: string;
  /** 額外搜尋關鍵字（不顯示） */
  keywords?: string;
}

interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  /** 是否允許清空 */
  clearable?: boolean;
  /** 是否禁用 */
  disabled?: boolean;
  /** dropdown 最大高度（CSS 值），預設 16rem */
  maxHeight?: string;
  /** 自訂 className 給 wrapper */
  className?: string;
  /** 自訂 style 給 input */
  inputStyle?: CSSProperties;
  /** 自訂渲染 option（如需 icon / avatar） */
  renderOption?: (opt: ComboboxOption, isActive: boolean) => ReactNode;
  ariaLabel?: string;
}

/**
 * 共用可搜尋下拉選單（Combobox）。
 * 適用於：權限分組、組織選擇、使用者選擇、稽核日誌篩選等需 max-height + scroll 的場景。
 * 行為：focus 顯示全部選項；輸入時做 includes 過濾（label + description + keywords）；
 * 鍵盤 ↑↓ 切換、Enter 選取、Esc 關閉。
 */
export default function Combobox({
  value,
  onChange,
  options,
  placeholder = "搜尋或選擇",
  clearable = false,
  disabled = false,
  maxHeight = "16rem",
  className = "",
  inputStyle,
  renderOption,
  ariaLabel,
}: ComboboxProps) {
  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedLabel = useMemo(
    () => options.find((o) => o.value === value)?.label ?? "",
    [options, value],
  );

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const hay = `${o.label} ${o.description ?? ""} ${o.keywords ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [options, keyword]);

  // 當選項變動時，重置高亮位置到頂部，避免索引越界
  useEffect(() => { setActiveIndex(0); }, [filtered.length, open]);

  const commit = (opt: ComboboxOption) => {
    onChange(opt.value);
    setKeyword("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const clear = () => {
    onChange("");
    setKeyword("");
    inputRef.current?.focus();
  };

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls="combobox-listbox"
        aria-autocomplete="list"
        aria-label={ariaLabel ?? placeholder}
        disabled={disabled}
        value={open ? keyword : (selectedLabel || "")}
        placeholder={selectedLabel ? "" : placeholder}
        onChange={(e) => { setKeyword(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); setKeyword(""); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open && e.key !== "Tab") setOpen(true);
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (filtered[activeIndex]) commit(filtered[activeIndex]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
        className="w-full text-sm px-3 py-2 pr-8 rounded-lg outline-none disabled:opacity-50"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          color: "var(--text-primary)",
          ...inputStyle,
        }}
      />
      {clearable && value && !disabled && (
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); clear(); }}
          aria-label="清除選擇"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center text-[10px] hover:opacity-70"
          style={{ background: "var(--bg-hover)", color: "var(--text-muted)" }}
        >
          ×
        </button>
      )}
      {open && filtered.length > 0 && (
        <ul
          id="combobox-listbox"
          role="listbox"
          className="absolute z-30 left-0 right-0 top-full mt-1 rounded-xl shadow-lg overflow-y-auto"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            maxHeight,
          }}
        >
          {filtered.map((opt, idx) => {
            const isActive = idx === activeIndex;
            return (
              <li key={opt.value} role="option" aria-selected={value === opt.value}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(idx)}
                  onMouseDown={(e) => { e.preventDefault(); commit(opt); }}
                  className="w-full text-left px-3 py-2 transition-colors"
                  style={{
                    background: isActive ? "var(--primary-dim)" : "transparent",
                    color: value === opt.value ? "var(--primary)" : "var(--text-primary)",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  {renderOption ? renderOption(opt, isActive) : (
                    <>
                      <p className="text-sm">{opt.label}</p>
                      {opt.description && (
                        <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                          {opt.description}
                        </p>
                      )}
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && filtered.length === 0 && (
        <div
          className="absolute z-30 left-0 right-0 top-full mt-1 rounded-xl px-3 py-2 text-xs text-center"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
        >
          無相符選項
        </div>
      )}
    </div>
  );
}
