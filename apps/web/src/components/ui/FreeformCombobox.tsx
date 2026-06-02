"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import type { ComboboxOption } from "./Combobox";

interface FreeformComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  maxHeight?: string;
  className?: string;
  inputClassName?: string;
  inputStyle?: CSSProperties;
  emptyText?: string;
  createLabel?: (keyword: string) => string;
  renderOption?: (opt: ComboboxOption, isActive: boolean) => ReactNode;
  ariaLabel?: string;
}

export default function FreeformCombobox({
  value,
  onChange,
  options,
  placeholder = "搜尋、選擇或輸入新內容",
  disabled = false,
  clearable = false,
  maxHeight = "16rem",
  className = "",
  inputClassName = "",
  inputStyle,
  emptyText = "輸入後按 Enter 使用新內容",
  createLabel = (keyword) => `使用「${keyword}」`,
  renderOption,
  ariaLabel,
}: FreeformComboboxProps) {
  const [keyword, setKeyword] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  useEffect(() => {
    if (!open) setKeyword(value);
  }, [open, value]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) =>
      `${option.label} ${option.value} ${option.description ?? ""} ${option.keywords ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [keyword, options]);

  const hasExact = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return options.some((option) =>
      option.value.toLowerCase() === q || option.label.toLowerCase() === q,
    );
  }, [keyword, options]);

  const canCreate = keyword.trim().length > 0 && !hasExact;
  const itemCount = filtered.length + (canCreate ? 1 : 0);

  useEffect(() => {
    setActiveIndex(0);
  }, [itemCount, open]);

  const commit = (next: string) => {
    const trimmed = next.trim();
    onChange(trimmed);
    setKeyword(trimmed);
    setOpen(false);
    inputRef.current?.blur();
  };

  const commitActive = () => {
    if (filtered[activeIndex]) {
      commit(filtered[activeIndex].value);
      return;
    }
    if (canCreate && activeIndex === filtered.length) commit(keyword);
  };

  const clear = () => {
    onChange("");
    setKeyword("");
    inputRef.current?.focus();
    setOpen(true);
  };

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-label={ariaLabel ?? placeholder}
        disabled={disabled}
        value={keyword}
        placeholder={placeholder}
        onChange={(event) => {
          const next = event.target.value;
          setKeyword(next);
          onChange(next);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          window.setTimeout(() => {
            setOpen(false);
            onChange(keyword.trim());
          }, 150);
        }}
        onKeyDown={(event) => {
          if (!open && event.key !== "Tab") setOpen(true);
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((index) => Math.min(index + 1, itemCount - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            commitActive();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
        className={`w-full rounded-lg px-3 py-2 pr-8 text-sm outline-none disabled:opacity-50 ${inputClassName}`}
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
          onMouseDown={(event) => {
            event.preventDefault();
            clear();
          }}
          aria-label="清除內容"
          className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-[10px] hover:opacity-70"
          style={{ background: "var(--bg-hover)", color: "var(--text-muted)" }}
        >
          x
        </button>
      )}
      {open && itemCount > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 overflow-y-auto rounded-xl shadow-lg"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            maxHeight,
          }}
        >
          {filtered.map((option, index) => {
            const isActive = index === activeIndex;
            return (
              <li key={option.value} role="option" aria-selected={option.value === value}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commit(option.value);
                  }}
                  className="w-full px-3 py-2 text-left transition-colors"
                  style={{
                    background: isActive ? "var(--primary-dim)" : "transparent",
                    color: option.value === value ? "var(--primary)" : "var(--text-primary)",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  {renderOption ? renderOption(option, isActive) : (
                    <>
                      <p className="text-sm">{option.label}</p>
                      {option.description && (
                        <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {option.description}
                        </p>
                      )}
                    </>
                  )}
                </button>
              </li>
            );
          })}
          {canCreate && (
            <li role="option" aria-selected={activeIndex === filtered.length}>
              <button
                type="button"
                onMouseEnter={() => setActiveIndex(filtered.length)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(keyword);
                }}
                className="w-full px-3 py-2 text-left text-sm transition-colors"
                style={{
                  background: activeIndex === filtered.length ? "var(--primary-dim)" : "transparent",
                  color: "var(--primary)",
                }}
              >
                {createLabel(keyword.trim())}
              </button>
            </li>
          )}
        </ul>
      )}
      {open && itemCount === 0 && (
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
