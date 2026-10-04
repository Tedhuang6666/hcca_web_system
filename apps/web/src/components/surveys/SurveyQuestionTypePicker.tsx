"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  AlignJustify,
  AlignLeft,
  CalendarDays,
  ChevronDown,
  CircleDot,
  FileText,
  Grid3X3,
  Image as ImageIcon,
  ListOrdered,
  PanelTop,
  SlidersHorizontal,
  SquareCheck,
  Star,
  TextCursorInput,
  Video,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { QuestionType } from "@/lib/types";

export type SurveyQuestionTypeOption = {
  value: QuestionType;
  label: string;
};

const TYPE_ICONS: Record<QuestionType, LucideIcon> = {
  text: AlignLeft,
  textarea: AlignJustify,
  single: CircleDot,
  single_grid: Grid3X3,
  multiple: SquareCheck,
  multi_text: TextCursorInput,
  ranking: ListOrdered,
  rating: Star,
  linear_scale: SlidersHorizontal,
  date: CalendarDays,
  section_text: FileText,
  page_break: PanelTop,
  image: ImageIcon,
  video: Video,
};

type MenuPosition = {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
};

export default function SurveyQuestionTypePicker({
  value,
  options,
  onChange,
}: {
  value: QuestionType;
  options: SurveyQuestionTypeOption[];
  onChange: (value: QuestionType) => void;
}) {
  const id = useId().replaceAll(":", "");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selectedOption = options[selectedIndex];
  const SelectedIcon = TYPE_ICONS[value];

  const updatePosition = useCallback(() => {
    const anchor = triggerRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const viewportPadding = 8;
    const width = Math.min(Math.max(rect.width, 256), window.innerWidth - viewportPadding * 2);
    const roomBelow = Math.max(0, window.innerHeight - rect.bottom - viewportPadding);
    const roomAbove = Math.max(0, rect.top - viewportPadding);
    const requestedHeight = Math.min(400, options.length * 44 + 8);
    const openAbove = roomBelow < requestedHeight && roomAbove > roomBelow;
    const availableHeight = openAbove ? roomAbove : roomBelow;
    setPosition({
      left: Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - width - viewportPadding)),
      top: openAbove ? undefined : rect.bottom + 4,
      bottom: openAbove ? window.innerHeight - rect.top + 4 : undefined,
      width,
      maxHeight: Math.max(1, Math.min(requestedHeight, availableHeight)),
    });
  }, [options.length]);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const focusActiveOption = window.requestAnimationFrame(() => {
      optionRefs.current[activeIndex]?.focus({ preventScroll: true });
    });
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(focusActiveOption);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [activeIndex, open, updatePosition]);

  const moveFocus = (index: number) => {
    const next = (index + options.length) % options.length;
    setActiveIndex(next);
    optionRefs.current[next]?.focus();
  };

  const handleOptionKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveFocus(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveFocus(options.length - 1);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  const menu = open && position && typeof document !== "undefined" ? createPortal(
    <div
      ref={menuRef}
      id={`${id}-options`}
      role="listbox"
      aria-label="題型"
      className="overflow-y-auto rounded-xl p-1.5 shadow-2xl"
      style={{
        position: "fixed",
        zIndex: 1400,
        left: position.left,
        top: position.top,
        bottom: position.bottom,
        width: position.width,
        maxHeight: position.maxHeight,
        background: "var(--bg-surface)",
        border: "1px solid var(--border-strong)",
        color: "var(--text-primary)",
      }}
    >
      {options.map((option, index) => {
        const Icon = TYPE_ICONS[option.value];
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={element => { optionRefs.current[index] = element; }}
            type="button"
            role="option"
            aria-selected={selected}
            tabIndex={activeIndex === index ? 0 : -1}
            onFocus={() => setActiveIndex(index)}
            onKeyDown={event => handleOptionKeyDown(event, index)}
            onClick={() => {
              onChange(option.value);
              setOpen(false);
              triggerRef.current?.focus();
            }}
            className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
            style={{
              color: selected ? "var(--primary)" : "var(--text-primary)",
              background: selected ? "var(--primary-dim)" : undefined,
            }}
          >
            <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-options`}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            setActiveIndex(selectedIndex);
            updatePosition();
            setOpen(true);
          }
        }}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex(selectedIndex);
            updatePosition();
            setOpen(true);
          }
        }}
        className="input flex min-h-11 w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <SelectedIcon size={18} strokeWidth={1.8} aria-hidden="true" />
          <span className="truncate">{selectedOption?.label ?? "選擇題型"}</span>
        </span>
        <ChevronDown size={16} className="shrink-0" aria-hidden="true" />
      </button>
      {menu}
    </>
  );
}
