"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.getClientRects().length > 0 || element === document.activeElement);
}

type ModalSize = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "full";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: ModalSize;
  mobileFullscreen?: boolean;
  footer?: ReactNode;
}

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  full: "max-w-full",
};

export default function Modal({
  title,
  onClose,
  children,
  size,
  mobileFullscreen = true,
  footer,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !dialogRef.current) return;
    const dialog = dialogRef.current;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    const inertSiblings = new Map<HTMLElement, { inert: boolean; ariaHidden: string | null }>();
    document.body.style.overflow = "hidden";
    for (const child of Array.from(document.body.children)) {
      if (child === dialog) continue;
      const element = child as HTMLElement;
      inertSiblings.set(element, {
        inert: element.hasAttribute("inert"),
        ariaHidden: element.getAttribute("aria-hidden"),
      });
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    }
    const focusTarget = dialog.querySelector<HTMLElement>("[data-autofocus]")
      ?? closeButtonRef.current
      ?? focusableElements(dialog)[0]
      ?? dialog;
    const focusFrame = requestAnimationFrame(() => focusTarget.focus());

    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      for (const [element, previous] of inertSiblings) {
        if (previous.inert) element.setAttribute("inert", "");
        else element.removeAttribute("inert");
        if (previous.ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", previous.ariaHidden);
      }
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus();
      previousFocusRef.current = null;
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = focusableElements(dialog);
      if (focusable.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [mounted, onClose]);

  if (!mounted) return null;

  const widthClass = SIZE_CLASS[size ?? "lg"];

  const mobileClass = mobileFullscreen
    ? "h-full max-h-full sm:my-auto sm:h-auto sm:max-h-[calc(100vh-2rem)]"
    : "my-auto max-h-[calc(100vh-2rem)]";
  const mobileRadius = mobileFullscreen ? "rounded-none sm:rounded-2xl" : "rounded-2xl";

  return createPortal(
    <div
      ref={dialogRef}
      data-modal-root="true"
      className={`modal-root fixed inset-0 z-50 flex justify-center overflow-y-auto sm:items-center ${mobileFullscreen ? "items-stretch p-0 sm:p-4" : "items-start p-4"}`}
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={`modal-surface ${mobileFullscreen ? "modal-surface-mobile" : ""} flex w-full ${widthClass} flex-col shadow-2xl ${mobileClass} ${mobileRadius}`}
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        <div
          className="modal-header flex flex-shrink-0 items-center justify-between gap-3 p-5 pb-3"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <h2 id={titleId} className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            {title}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="modal-close-button flex h-11 w-11 items-center justify-center rounded-lg transition-colors"
            style={{ color: "var(--text-muted)" }}
            aria-label="關閉"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="modal-content min-h-0 flex-1 overflow-y-auto p-5 pt-4">{children}</div>
        {footer && (
          <div
            className="modal-footer flex flex-shrink-0 items-center justify-end gap-2 px-5 py-3 flex-wrap"
            style={{ borderTop: "1px solid var(--border)", background: "var(--bg-elevated)" }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
