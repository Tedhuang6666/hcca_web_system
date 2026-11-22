"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import LocationMark, { useLocationMarkScope } from "@/components/ui/LocationMark";

export interface TabBarItem<K extends string> {
  key: K;
  label: ReactNode;
  icon?: ReactNode;
  /** 分頁名稱後的數量或附註。 */
  meta?: ReactNode;
}

interface TabBarProps<K extends string> {
  items: readonly TabBarItem<K>[];
  value: K;
  onChange: (key: K) => void;
  /** 分頁列的無障礙名稱。 */
  label: string;
  className?: string;
  tabClassName?: string;
}

/**
 * 頁面內切換檢視的分頁列，外觀與模組分頁相同。
 * 選取時金線從原分頁滑到新分頁；鍵盤用左右鍵、Home、End 切換。
 */
export default function TabBar<K extends string>({
  items,
  value,
  onChange,
  label,
  className,
  tabClassName,
}: TabBarProps<K>) {
  const markGroup = `tab-bar:${useId()}`;
  const tabRefs = useRef(new Map<K, HTMLButtonElement>());
  useLocationMarkScope(markGroup);

  const moveWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = items.length - 1;
    const target = event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
        : event.key === "Home" ? 0
          : event.key === "End" ? last
            : -1;
    if (target < 0) return;
    event.preventDefault();
    const key = items[target].key;
    onChange(key);
    tabRefs.current.get(key)?.focus();
  };

  return (
    <div className={`module-tabs-scroll max-w-full overflow-x-auto${className ? ` ${className}` : ""}`}>
      <div className="module-tabs-list" role="tablist" aria-label={label}>
        {items.map((item, index) => {
          const active = item.key === value;
          return (
            <button
              key={item.key}
              ref={(node) => {
                if (node) tabRefs.current.set(item.key, node);
                else tabRefs.current.delete(item.key);
              }}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(item.key)}
              onKeyDown={(event) => moveWithKeyboard(event, index)}
              className={`module-tab-link cursor-pointer${active ? " is-active" : ""}${tabClassName ? ` ${tabClassName}` : ""}`}
            >
              {active && <LocationMark group={markGroup} className="module-tab-mark" />}
              {item.icon}
              <span>{item.label}</span>
              {item.meta}
            </button>
          );
        })}
      </div>
    </div>
  );
}
