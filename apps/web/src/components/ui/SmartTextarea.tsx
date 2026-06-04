"use client";

import { useMemo, useRef, useState } from "react";
import type { TextareaHTMLAttributes } from "react";

import { insertAtCursor, writingQualityChecks, writingSuggestions } from "@/lib/writingAssist";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
};

export default function SmartTextarea({ value, onChange, className = "", style, ...props }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const [cursor, setCursor] = useState(0);
  const suggestions = useMemo(() => writingSuggestions(value, cursor), [cursor, value]);
  const checks = useMemo(() => writingQualityChecks(value), [value]);

  const syncCursor = () => {
    const pos = ref.current?.selectionStart ?? value.length;
    setCursor(pos);
  };

  const applySuggestion = (text: string) => {
    const ta = ref.current;
    const start = ta?.selectionStart ?? value.length;
    const end = ta?.selectionEnd ?? start;
    const next = insertAtCursor(value, text, start, end);
    onChange(next);
    window.setTimeout(() => {
      ref.current?.focus();
      const nextPos = start + text.length;
      if (ref.current) ref.current.selectionStart = ref.current.selectionEnd = nextPos;
      setCursor(nextPos);
    }, 0);
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setCursor(event.target.selectionStart);
        }}
        onFocus={(event) => {
          setFocused(true);
          setCursor(event.currentTarget.selectionStart);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          window.setTimeout(() => setFocused(false), 120);
          props.onBlur?.(event);
        }}
        onKeyUp={syncCursor}
        onClick={syncCursor}
        className={`w-full bg-transparent text-sm p-2 rounded outline-none resize-y ${className}`}
        style={{
          border: "1px solid var(--border)",
          color: "var(--text-primary)",
          ...style,
        }}
        {...props}
      />
      {focused && suggestions.length > 0 && (
        <div
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg shadow-lg"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
        >
          <div className="flex max-h-48 flex-col overflow-y-auto p-1">
            {suggestions.map((item, index) => (
              <button
                key={`${item.group}-${item.label}-${index}`}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  applySuggestion(item.value);
                }}
                className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:opacity-80"
              >
                <span className="min-w-0 truncate" style={{ color: "var(--text-primary)" }}>
                  {item.value}
                </span>
                <span className="flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                  {item.group}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {checks.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {checks.map((check) => (
            <p
              key={check.message}
              className="text-[11px]"
              style={{
                color: check.severity === "warning" ? "var(--warning)" : "var(--text-muted)",
              }}>
              {check.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
