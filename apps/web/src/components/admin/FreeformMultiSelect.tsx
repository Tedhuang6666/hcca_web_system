"use client";

import { useId, useMemo, useState } from "react";
import { X } from "lucide-react";

export interface FreeformOption {
  value: string;
  label?: string;
  description?: string;
}

interface FreeformMultiSelectProps {
  value: string[];
  onChange: (value: string[]) => void;
  options: FreeformOption[];
  placeholder?: string;
  disabled?: boolean;
  maxSuggestions?: number;
}

export default function FreeformMultiSelect({
  value,
  onChange,
  options,
  placeholder = "輸入後按 Enter",
  disabled = false,
  maxSuggestions = 8,
}: FreeformMultiSelectProps) {
  const id = useId();
  const [text, setText] = useState("");
  const selected = useMemo(() => new Set(value), [value]);
  const optionByValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const suggestions = useMemo(() => {
    const q = text.trim().toLowerCase();
    return options
      .filter((o) => !selected.has(o.value))
      .filter((o) => {
        if (!q) return true;
        return (
          o.value.toLowerCase().includes(q) ||
          o.label?.toLowerCase().includes(q) ||
          o.description?.toLowerCase().includes(q)
        );
      })
      .slice(0, maxSuggestions);
  }, [maxSuggestions, options, selected, text]);

  const add = (raw: string) => {
    const next = raw.trim();
    if (!next || selected.has(next)) return;
    onChange([...value, next]);
    setText("");
  };

  const remove = (item: string) => onChange(value.filter((v) => v !== item));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((item) => {
          const opt = optionByValue.get(item);
          return (
            <span
              key={item}
              className="inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-xs"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg-base)",
                color: "var(--text-secondary)",
              }}
              title={opt?.description ?? item}>
              <span className="truncate font-mono">{opt?.label ?? item}</span>
              <button
                type="button"
                className="inline-flex h-4 w-4 items-center justify-center"
                onClick={() => remove(item)}
                disabled={disabled}
                aria-label={`移除 ${item}`}>
                <X size={12} aria-hidden />
              </button>
            </span>
          );
        })}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(text);
            }
            if (e.key === "Backspace" && !text && value.length > 0) {
              remove(value[value.length - 1]);
            }
          }}
          onBlur={() => add(text)}
          list={id}
          placeholder={placeholder}
          className="input min-w-[12rem] flex-1 font-mono text-xs"
          disabled={disabled}
        />
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => add(text)}
          disabled={disabled || !text.trim()}>
          加入
        </button>
        <datalist id={id}>
          {options
            .filter((o) => !selected.has(o.value))
            .map((o) => (
              <option key={o.value} value={o.value}>
                {o.label ? `${o.label} - ${o.description ?? ""}` : o.description ?? ""}
              </option>
            ))}
        </datalist>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((o) => (
            <button
              key={o.value}
              type="button"
              className="rounded-md border px-2 py-1 text-left text-[11px]"
              style={{
                borderColor: "var(--border)",
                background: "var(--bg-surface)",
                color: "var(--text-secondary)",
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(o.value)}
              disabled={disabled}
              title={o.description ?? o.value}>
              <span className="font-mono">{o.label ?? o.value}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
