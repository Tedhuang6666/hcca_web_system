"use client";

import Link from "next/link";
import type { ComponentProps, PointerEventHandler } from "react";

type PublicSpotlightLinkProps = ComponentProps<typeof Link>;

export default function PublicSpotlightLink({
  children,
  className,
  onPointerMove,
  onPointerLeave,
  ...linkProps
}: PublicSpotlightLinkProps) {
  const handlePointerMove: PointerEventHandler<HTMLAnchorElement> = (event) => {
    onPointerMove?.(event);
    if (event.pointerType !== "mouse") return;

    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--spotlight-x", `${event.clientX - bounds.left}px`);
    event.currentTarget.style.setProperty("--spotlight-y", `${event.clientY - bounds.top}px`);
    event.currentTarget.dataset.spotlightActive = "true";
  };

  const handlePointerLeave: PointerEventHandler<HTMLAnchorElement> = (event) => {
    onPointerLeave?.(event);
    delete event.currentTarget.dataset.spotlightActive;
  };

  return (
    <Link
      {...linkProps}
      className={className}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {children}
    </Link>
  );
}
