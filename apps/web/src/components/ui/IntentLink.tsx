"use client";

import NextLink from "next/link";
import { useState, type ComponentProps } from "react";

/** Shared navigation waits for intent before downloading another route. */
export default function IntentLink({
  prefetch,
  onMouseEnter,
  onFocus,
  onTouchStart,
  ...props
}: ComponentProps<typeof NextLink>) {
  const [active, setActive] = useState(false);
  return (
    <NextLink
      {...props}
      prefetch={prefetch === undefined ? (active ? null : false) : prefetch}
      onMouseEnter={event => {
        onMouseEnter?.(event);
        if (!event.defaultPrevented) setActive(true);
      }}
      onFocus={event => {
        onFocus?.(event);
        if (!event.defaultPrevented) setActive(true);
      }}
      onTouchStart={event => {
        onTouchStart?.(event);
        if (!event.defaultPrevented) setActive(true);
      }}
    />
  );
}
