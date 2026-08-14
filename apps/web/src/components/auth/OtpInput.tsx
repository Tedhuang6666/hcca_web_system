"use client";

import { useEffect, useId, useRef, type RefObject } from "react";

import styles from "./OtpInput.module.css";

export type OtpInputMode = "numeric" | "backup";

type OtpInputProps = {
  value: string;
  onChange: (value: string) => void;
  mode?: OtpInputMode;
  length?: number;
  label?: string;
  describedBy?: string;
  error?: boolean;
  status?: "idle" | "success";
  disabled?: boolean;
  autoFocus?: boolean;
  firstInputRef?: RefObject<HTMLInputElement | null>;
  onComplete?: (value: string) => void;
  onEnter?: () => void;
};

function normalizeValue(input: string, mode: OtpInputMode): string {
  const normalized = input.toUpperCase();
  return mode === "numeric"
    ? normalized.replace(/\D/g, "")
    : normalized.replace(/[^0-9A-F]/g, "");
}

export default function OtpInput({
  value,
  onChange,
  mode = "numeric",
  length: lengthProp,
  label = "驗證碼",
  describedBy,
  error = false,
  status = "idle",
  disabled = false,
  autoFocus = false,
  firstInputRef,
  onComplete,
  onEnter,
}: OtpInputProps) {
  const length = lengthProp ?? (mode === "backup" ? 16 : 6);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const labelId = `otp-label-${useId()}`;

  useEffect(() => {
    if (firstInputRef) firstInputRef.current = inputRefs.current[0];
    return () => {
      if (firstInputRef) firstInputRef.current = null;
    };
  }, [firstInputRef]);

  const focusInput = (index: number) => {
    const input = inputRefs.current[Math.max(0, Math.min(index, length - 1))];
    if (!input) return;
    window.requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  };

  const emitValue = (nextValue: string, focusIndex?: number) => {
    const next = normalizeValue(nextValue, mode).slice(0, length);
    onChange(next);
    if (next.length === length) onComplete?.(next);
    else if (focusIndex !== undefined) focusInput(focusIndex);
  };

  const writeFrom = (index: number, input: string) => {
    const incoming = normalizeValue(input, mode);
    if (!incoming) {
      const nextChars = value.split("");
      nextChars.splice(index, 1);
      emitValue(nextChars.join(""), Math.max(index - 1, 0));
      return;
    }

    if (incoming.length > 1) {
      const nextChars = value.split("");
      incoming.split("").forEach((char, offset) => {
        if (index + offset < length) nextChars[index + offset] = char;
      });
      emitValue(nextChars.join(""), Math.min(index + incoming.length, length - 1));
      return;
    }

    const nextChars = value.split("");
    nextChars[index] = incoming;
    emitValue(nextChars.join(""), Math.min(index + 1, length - 1));
  };

  const handlePaste = (index: number, text: string) => {
    const incoming = normalizeValue(text, mode);
    if (!incoming) return;
    const nextChars = value.split("");
    incoming.split("").forEach((char, offset) => {
      if (index + offset < length) nextChars[index + offset] = char;
    });
    emitValue(nextChars.join(""), Math.min(index + incoming.length, length - 1));
  };

  return (
    <div
      className={styles.grid}
      data-length={length}
      data-error={error || undefined}
      data-status={status}
      role="group"
      aria-labelledby={labelId}
    >
      <span id={labelId} className="sr-only">
        {label}
      </span>
      {Array.from({ length }, (_, index) => {
        const digit = value[index] ?? "";
        return (
          <span
            key={index}
            className={styles.shell}
            data-filled={Boolean(digit)}
            data-status={status}
          >
            <span key={`${index}-${digit}`} className={styles.digit} aria-hidden="true">
              {digit || "·"}
            </span>
            <input
              ref={(node) => {
                inputRefs.current[index] = node;
                if (index === 0 && firstInputRef) firstInputRef.current = node;
              }}
              className={styles.control}
              type="text"
              inputMode={mode === "numeric" ? "numeric" : "text"}
              pattern={mode === "numeric" ? "[0-9]*" : "[0-9A-Fa-f]*"}
              autoComplete={index === 0 ? "one-time-code" : "off"}
              autoFocus={autoFocus && index === 0}
              aria-label={`${label}第 ${index + 1} 位`}
              aria-describedby={describedBy}
              aria-invalid={error || undefined}
              disabled={disabled}
              maxLength={length}
              value={digit}
              onChange={(event) => writeFrom(index, event.currentTarget.value)}
              onPaste={(event) => {
                event.preventDefault();
                handlePaste(index, event.clipboardData.getData("text"));
              }}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onEnter?.();
                  return;
                }
                if (event.key === "Backspace") {
                  event.preventDefault();
                  writeFrom(index, "");
                  return;
                }
                if (event.key === "Delete") {
                  event.preventDefault();
                  const nextChars = value.split("");
                  nextChars.splice(index, 1);
                  emitValue(nextChars.join(""), index);
                  return;
                }
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  focusInput(index - 1);
                }
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  focusInput(index + 1);
                }
              }}
            />
          </span>
        );
      })}
    </div>
  );
}
