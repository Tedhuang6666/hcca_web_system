"use client";

import { useState, type ComponentPropsWithRef } from "react";

/** Numeric state keeps its last value while the user clears and replaces the text. */
export default function NumberInput({
  value,
  onChange,
  onBlur,
  ...props
}: ComponentPropsWithRef<"input">) {
  const [emptyValue, setEmptyValue] = useState<number | null>(null);

  // A reset or another control changing the value must also discard the empty draft.
  if (emptyValue !== null && emptyValue !== value) setEmptyValue(null);

  return (
    <input
      {...props}
      type="number"
      value={emptyValue !== null && emptyValue === value ? "" : value}
      onChange={(event) => {
        if (typeof value === "number" && event.currentTarget.value === "") {
          setEmptyValue(value);
          return;
        }
        setEmptyValue(null);
        onChange?.(event);
      }}
      onBlur={(event) => {
        if (emptyValue !== null && typeof value === "number") {
          setEmptyValue(null);
          event.currentTarget.value = String(value);
        }
        onBlur?.(event);
      }}
    />
  );
}
