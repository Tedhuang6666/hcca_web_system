"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

function motionIsReduced(): boolean {
  if (typeof window === "undefined") return true;
  return document.documentElement.dataset.a11yMotion === "true"
    || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

export function AnimatedNumber({
  value,
  cap,
  className,
  style,
}: {
  value: number;
  cap?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const [displayValue, setDisplayValue] = useState(value);
  const previousValue = useRef(value);
  const hasMounted = useRef(false);

  useEffect(() => {
    const from = previousValue.current;
    previousValue.current = value;

    if (!hasMounted.current || from === value || motionIsReduced()) {
      hasMounted.current = true;
      setDisplayValue(value);
      return;
    }

    const duration = 360;
    const startedAt = performance.now();
    let frameId = 0;

    const update = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      setDisplayValue(Math.round(from + (value - from) * easeOutCubic(progress)));
      if (progress < 1) frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, [value]);

  const capped = cap !== undefined && value > cap;
  const visibleValue = capped ? `${cap}+` : displayValue;

  return (
    <span className={`motion-number ${className ?? ""}`} style={style} aria-label={`${value}`}>
      {visibleValue}
    </span>
  );
}
