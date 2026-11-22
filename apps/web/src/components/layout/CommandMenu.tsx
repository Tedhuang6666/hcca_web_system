"use client";

import { lazy, Suspense, useEffect, useState } from "react";

export const OPEN_COMMAND_MENU_EVENT = "hcca:open-command-menu";

const CommandMenuDialog = lazy(() => import("./CommandMenuDialog"));

export default function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    };
    const openMenu = () => setOpen(true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_COMMAND_MENU_EVENT, openMenu);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_COMMAND_MENU_EVENT, openMenu);
    };
  }, []);

  if (!open) return null;

  return (
    <Suspense fallback={
      <div role="status" className="fixed left-1/2 top-20 z-[160] -translate-x-1/2 rounded-lg border px-4 py-3"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
        正在開啟功能選單…
      </div>
    }>
      <CommandMenuDialog query={query} setQuery={setQuery} onClose={() => setOpen(false)} />
    </Suspense>
  );
}
