"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Clock, Search } from "lucide-react";
import { searchApi } from "@/lib/api";
import type { SearchResultOut } from "@/lib/types";
import {
  filterNavItems,
  isMeetingsUnlocked,
  isSection,
  navDefinitionForProfile,
  resolveNavigationProfile,
  type NavItem,
} from "@/lib/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { useRecentItems } from "@/hooks/useRecentItems";
import NavIcon from "./NavIcon";

export const OPEN_COMMAND_MENU_EVENT = "hcca:open-command-menu";

// 議事系統：與側邊欄一致，僅會議管理者/管理員或已掃描簽到連結解鎖者可見。
const MEETINGS_ITEM: NavItem = { id: "meetings", href: "/meetings", iconKey: "meetings", label: "議事系統" };

function canSeeMeetings(): boolean {
  if (typeof window === "undefined") return false;
  if (isMeetingsUnlocked()) return true;
  if (sessionStorage.getItem("is_superuser") === "true" || sessionStorage.getItem("is_owner") === "true") {
    return true;
  }
  try {
    const perms: string[] = JSON.parse(sessionStorage.getItem("permissions") || "[]");
    return perms.includes("admin:all") || perms.some((p) => p.startsWith("meeting:"));
  } catch {
    return false;
  }
}

function kindLabel(kind: string) {
  return {
    document: "公文",
    regulation: "法規",
    meeting: "會議",
    announcement: "公告",
    survey: "問卷",
  }[kind] ?? kind;
}

export default function CommandMenu() {
  const router = useRouter();
  const { can, isAdmin, permissions } = usePermissions();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultOut[]>([]);
  const recents = useRecentItems(6);
  const showRecents = query.trim().length === 0 && recents.length > 0;
  const [meetingsVisible, setMeetingsVisible] = useState(false);

  useEffect(() => {
    setMeetingsVisible(canSeeMeetings());
  }, [open]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
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

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      searchApi.global(query, 8).then(setResults).catch(() => setResults([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  const hasPrefix = useMemo(() => (prefix: string): boolean => {
    if (isAdmin) return true;
    if (permissions.has("admin:all")) return true;
    for (const p of permissions) {
      if (p.startsWith(prefix)) return true;
    }
    return false;
  }, [isAdmin, permissions]);

  const allNavActions = useMemo(() => {
    const items: NavItem[] = [];
    const profile = resolveNavigationProfile(permissions, isAdmin);
    for (const entry of navDefinitionForProfile(profile)) {
      const candidates = isSection(entry) ? entry.items : [entry];
      // meetings 由 canSeeMeetings() 單獨控制，此處先排除
      const filtered = filterNavItems(candidates, can, hasPrefix).filter((i) => i.id !== "meetings");
      items.push(...filtered);
    }
    if (meetingsVisible) items.unshift(MEETINGS_ITEM);
    return items;
  }, [can, hasPrefix, isAdmin, meetingsVisible, permissions]);

  const filteredActions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allNavActions;
    return allNavActions.filter((item) => item.label.toLowerCase().includes(q));
  }, [query, allNavActions]);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[160] flex items-start justify-center px-3 pt-[14vh]"
      style={{ background: "var(--bg-overlay)" }}
      onMouseDown={() => setOpen(false)}
    >
      <Command
        className="w-full max-w-2xl overflow-hidden rounded-lg"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-strong)",
          boxShadow: "var(--shadow-xl)",
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div
          className="flex items-center gap-2 px-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <Search size={17} aria-hidden={true} style={{ color: "var(--text-muted)" }} />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="搜尋事情、公文、法規、會議或直接執行操作"
            className="h-12 flex-1 bg-transparent text-sm outline-none"
            style={{ color: "var(--text-primary)" }}
          />
        </div>
        <Command.List className="max-h-[55vh] overflow-y-auto p-2">
          <Command.Empty
            className="px-3 py-8 text-center text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            沒有找到結果
          </Command.Empty>

          {showRecents && (
            <Command.Group heading="最近開啟">
              {recents.map((item) => (
                <Command.Item
                  key={`recent-${item.kind}-${item.id}`}
                  value={`recent-${item.title}`}
                  onSelect={() => go(item.href)}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm"
                >
                  <Clock size={15} aria-hidden={true} style={{ color: "var(--text-muted)" }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.title}</span>
                    <span className="mt-0.5 block truncate text-xs" style={{ color: "var(--text-muted)" }}>
                      {kindLabel(item.kind)}
                    </span>
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {filteredActions.length > 0 && (
            <Command.Group heading="快速前往">
              {filteredActions.map((item) => (
                <Command.Item
                  key={item.href}
                  value={`action-${item.label}`}
                  onSelect={() => go(item.href)}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm"
                >
                  <span className="flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                    <NavIcon iconKey={item.iconKey} size={16} />
                  </span>
                  <span>{item.label}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {results.length > 0 && (
            <Command.Group heading="搜尋結果">
              {results.map((item) => (
                <Command.Item
                  key={`${item.kind}:${item.id}`}
                  value={`${item.kind}-${item.title}`}
                  onSelect={() => go(item.href)}
                  className="flex cursor-pointer items-start gap-3 rounded-md px-3 py-2 text-sm"
                >
                  <Search size={15} aria-hidden={true} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.title}</span>
                    <span className="mt-0.5 block truncate text-xs" style={{ color: "var(--text-muted)" }}>
                      {kindLabel(item.kind)} {item.summary}
                    </span>
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
