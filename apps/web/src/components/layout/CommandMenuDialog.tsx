"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Clock, Search } from "lucide-react";
import { searchApi } from "@/lib/api";
import Modal from "@/components/ui/Modal";
import type { SearchResultOut } from "@/lib/types";
import {
  filterNavItems,
  isNavItemVisible,
  NAV_ITEMS,
} from "@/lib/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { useRecentItems } from "@/hooks/useRecentItems";
import { useModuleStatus } from "@/contexts/ModuleStatusContext";
import { NAV_ID_TO_MODULE } from "@/lib/modules";
import NavIcon from "./NavIcon";

const ACTION_GROUPS = [
  { heading: "工作", ids: ["dashboard", "tasks", "workItems", "announcements"] },
  {
    heading: "治理與公開",
    ids: ["documents", "regulations", "councilProposals", "petitions", "judicialPetitions"],
  },
  { heading: "校園服務", ids: ["surveys", "shop", "partnerMap", "recommendedVendors", "examPapers"] },
] as const;

function kindLabel(kind: string) {
  return {
    document: "公文",
    regulation: "法規",
    announcement: "公告",
    survey: "問卷",
  }[kind] ?? kind;
}

export default function CommandMenuDialog({ query, setQuery, onClose }: {
  query: string;
  setQuery: (value: string) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const { can, isAdmin, permissions } = usePermissions();
  const { isModuleClosed } = useModuleStatus();
  const [results, setResults] = useState<SearchResultOut[]>([]);
  const recents = useRecentItems(6);
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      searchApi.global(query, 8).then(setResults).catch(() => setResults([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query]);

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
    const items = filterNavItems(NAV_ITEMS, can, hasPrefix)
      .filter((item) => item.id !== "tasks" || hasPrefix("document:") || hasPrefix("regulation:"))
      .filter((item) => item.id !== "adminDashboard" || isNavItemVisible(item, { can, hasPrefix, isAdmin }))
      .filter((item) => !isModuleClosed(NAV_ID_TO_MODULE[item.id] ?? null));

    return items;
  }, [can, hasPrefix, isAdmin, isModuleClosed]);

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
    onClose();
    setQuery("");
    router.push(href);
  };

  return (
    <Modal
      title="搜尋功能或資料"
      onClose={onClose}
      size="xl"
      mobileFullscreen={false}
    >
      <Command className="w-full overflow-hidden" label="搜尋功能或資料">
        {/* 對話框只有這一個輸入欄且自動聚焦；以底線顏色表示焦點，避免外框被圓角裁切。 */}
        <div className="command-menu-search flex items-center gap-2 px-4">
          <Search size={17} aria-hidden={true} style={{ color: "var(--text-muted)" }} />
          <Command.Input
            autoFocus
            data-autofocus=""
            value={query}
            onValueChange={setQuery}
            placeholder="搜尋功能、公文、法規或公告"
            aria-label="搜尋功能或資料"
            className="h-14 flex-1 bg-transparent text-sm"
            style={{ color: "var(--text-primary)" }}
          />
        </div>
        <Command.List className="max-h-[min(56dvh,420px)] overflow-y-auto px-4 py-3">
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
                  <span className="flex flex-shrink-0" style={{ color: "var(--text-muted)" }}>
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
    </Modal>
  );
}
