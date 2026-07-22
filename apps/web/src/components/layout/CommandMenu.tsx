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
  NAV_ITEMS,
  type NavItem,
} from "@/lib/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { useRecentItems } from "@/hooks/useRecentItems";
import { useModuleStatus } from "@/contexts/ModuleStatusContext";
import { NAV_ID_TO_MODULE } from "@/lib/modules";
import NavIcon from "./NavIcon";

export const OPEN_COMMAND_MENU_EVENT = "hcca:open-command-menu";

// 議事系統：與側邊欄一致，僅會議管理者/管理員或已掃描簽到連結解鎖者可見。
const MEETINGS_ITEM: NavItem = { id: "meetings", href: "/meetings", iconKey: "meetings", label: "議事系統" };

const ACTION_GROUPS = [
  { heading: "現在要處理", ids: ["dashboard", "tasks", "workItems", "calendar", "announcements"] },
  {
    heading: "治理事務",
    ids: ["matters", "governanceHub", "documents", "regulations", "meetings", "councilProposals", "petitions", "judicialPetitions"],
  },
  { heading: "校園服務", ids: ["surveys", "meal", "shop", "partnerMap", "recommendedVendors", "examPapers"] },
] as const;

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
  const { isModuleClosed } = useModuleStatus();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultOut[]>([]);
  const recents = useRecentItems(6);
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
  const visibleRecents = recents.filter(
    (item) => item.href !== "/tasks" || hasPrefix("document:") || hasPrefix("regulation:"),
  );
  const showRecents = query.trim().length === 0 && visibleRecents.length > 0;

  const allNavActions = useMemo(() => {
    // 這是「所有服務」入口：不能只跟隨目前角色視角，否則被精簡的功能會無法抵達。
    const hasOperationsAccess = (
      isAdmin
      || permissions.has("admin:all")
      || hasPrefix("announcement:")
      || hasPrefix("email:")
      || hasPrefix("activity:")
      || hasPrefix("site:")
      || hasPrefix("analytics:")
      || hasPrefix("finance:")
    );
    const hasBackofficeAccess = (
      isAdmin
      || permissions.has("admin:all")
      || hasPrefix("class:")
      || hasPrefix("document:")
      || hasPrefix("serial:")
      || hasPrefix("exam:")
      || hasPrefix("shop:")
      || hasPrefix("meal:")
      || hasPrefix("partner_map:")
      || hasPrefix("election:")
      || hasPrefix("petition:")
      || hasPrefix("org:")
    );
    const items = filterNavItems(NAV_ITEMS, can, hasPrefix)
      .filter((item) => item.id !== "meetings")
      .filter((item) => item.id !== "tasks" || hasPrefix("document:") || hasPrefix("regulation:"))
      .filter((item) => item.id !== "operations" || hasOperationsAccess)
      .filter((item) => item.id !== "moduleBackoffice" || hasBackofficeAccess)
      .filter((item) => !isModuleClosed(NAV_ID_TO_MODULE[item.id] ?? null));

    if (meetingsVisible && !isModuleClosed(NAV_ID_TO_MODULE.meetings ?? null)) {
      items.unshift(MEETINGS_ITEM);
    }
    return items;
  }, [can, hasPrefix, isAdmin, isModuleClosed, meetingsVisible, permissions]);

  const actionGroups = useMemo(() => {
    const groupedIds = new Set<string>(ACTION_GROUPS.flatMap((group) => group.ids));
    const byId = new Map(allNavActions.map((item) => [item.id, item]));
    const groups = ACTION_GROUPS.map((group) => ({
      heading: group.heading,
      items: group.ids.flatMap((id) => {
        const item = byId.get(id);
        return item ? [item] : [];
      }),
    })).filter((group) => group.items.length > 0);
    const managementItems = allNavActions.filter((item) => !groupedIds.has(item.id));

    return managementItems.length > 0
      ? [...groups, { heading: "管理與設定", items: managementItems }]
      : groups;
  }, [allNavActions]);

  const filteredActions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allNavActions;
    return allNavActions.filter((item) => item.label.toLowerCase().includes(q));
  }, [query, allNavActions]);

  const displayedGroups = query.trim()
    ? [{ heading: "符合的服務", items: filteredActions }]
    : actionGroups;

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
        className="w-full max-w-xl overflow-hidden rounded-xl"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-strong)",
          boxShadow: "0 14px 32px rgba(0,0,0,0.28)",
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <h2 className="text-base font-semibold">所有功能</h2>
          <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
            依工作類型選擇，或直接搜尋功能名稱
          </p>
        </div>
        <div
          className="mx-4 mt-3 flex items-center gap-2 rounded-md px-3"
          style={{ background: "var(--bg-muted)", border: "1px solid var(--border)" }}
        >
          <Search size={17} aria-hidden={true} style={{ color: "var(--text-muted)" }} />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="搜尋功能，例如公文、問卷或學餐"
            className="h-11 flex-1 bg-transparent text-sm outline-none"
            style={{ color: "var(--text-primary)" }}
          />
        </div>
        <Command.List className="max-h-[min(56vh,420px)] overflow-y-auto px-4 py-3">
          <Command.Empty
            className="px-3 py-8 text-center text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            沒有找到結果
          </Command.Empty>

          {showRecents && (
            <Command.Group heading="最近開啟">
              {visibleRecents.map((item) => (
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

          {displayedGroups.map((group) => (
            <Command.Group key={group.heading} heading={group.heading} className="mb-3 last:mb-0">
              {group.items.map((item) => (
                <Command.Item
                  key={item.href}
                  value={`action-${item.label}`}
                  onSelect={() => go(item.href)}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm"
                >
                  <span
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md"
                    style={{ background: "var(--bg-muted)", color: "var(--text-muted)" }}
                  >
                    <NavIcon iconKey={item.iconKey} size={16} />
                  </span>
                  <span>{item.label}</span>
                </Command.Item>
              ))}
            </Command.Group>
          ))}

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
