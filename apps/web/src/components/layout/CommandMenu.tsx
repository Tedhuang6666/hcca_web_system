"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  CalendarDays,
  CheckSquare,
  Clock,
  FilePlus2,
  FileText,
  FolderKanban,
  Gavel,
  Megaphone,
  Search,
  Settings,
  Users,
} from "lucide-react";
import { searchApi } from "@/lib/api";
import type { SearchResultOut } from "@/lib/types";
import { isMeetingsUnlocked } from "@/lib/navigation";
import { useRecentItems } from "@/hooks/useRecentItems";

type CommandAction = {
  label: string;
  href: string;
  icon: typeof Search;
  keywords?: string;
};

const STATIC_ACTIONS: CommandAction[] = [
  { label: "治理中樞", href: "/governance", icon: FolderKanban, keywords: "事情 matter 專案 案件" },
  { label: "建立事情", href: "/governance#quick-create", icon: FilePlus2, keywords: "新增 matter 專案 活動" },
  { label: "我的待辦", href: "/tasks", icon: CheckSquare, keywords: "任務 工作 task" },
  { label: "行政行事曆", href: "/calendar", icon: CalendarDays, keywords: "日期 期限 日程" },
  { label: "公文列表", href: "/documents", icon: FileText },
  { label: "法規資料庫", href: "/regulations", icon: Gavel },
  { label: "公告中心", href: "/announcements", icon: Megaphone },
  { label: "介面設定", href: "/settings/navigation", icon: Settings },
  { label: "通知設定", href: "/settings/notifications", icon: Settings },
  { label: "安全設定", href: "/settings/security", icon: Settings },
];

export const OPEN_COMMAND_MENU_EVENT = "hcca:open-command-menu";

// 議事系統：與側邊欄一致，僅會議管理者/管理員或已掃描簽到連結解鎖者可見。
const MEETINGS_ACTION: CommandAction = { label: "會議系統", href: "/meetings", icon: Users };

function canSeeMeetings(): boolean {
  if (typeof window === "undefined") return false;
  if (isMeetingsUnlocked()) return true;
  if (localStorage.getItem("is_superuser") === "true" || localStorage.getItem("is_owner") === "true") {
    return true;
  }
  try {
    const perms: string[] = JSON.parse(localStorage.getItem("permissions") || "[]");
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

  const filteredActions = useMemo(() => {
    const actions = meetingsVisible
      ? [STATIC_ACTIONS[0], STATIC_ACTIONS[1], MEETINGS_ACTION, ...STATIC_ACTIONS.slice(2)]
      : STATIC_ACTIONS;
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.keywords?.toLowerCase().includes(q),
    );
  }, [query, meetingsVisible]);

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
              {filteredActions.map((item) => {
                const Icon = item.icon;
                return (
                  <Command.Item
                    key={item.href}
                    value={`action-${item.label}`}
                    onSelect={() => go(item.href)}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm"
                  >
                    <Icon size={16} aria-hidden={true} />
                    <span>{item.label}</span>
                  </Command.Item>
                );
              })}
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
