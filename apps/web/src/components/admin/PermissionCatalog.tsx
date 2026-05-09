"use client";

import { useMemo, useState } from "react";
import type { ReactElement } from "react";

import type { PermissionCodeInfo } from "@/lib/types";

const REQUIRED_PERMISSION_CODES: PermissionCodeInfo[] = [
  {
    group: "系統管理",
    code: "audit:view_org",
    label: "查看本組織稽核日誌",
    desc: "查看目前任期所屬組織內的操作軌跡",
  },
  {
    group: "系統管理",
    code: "audit:view_all",
    label: "查看所有稽核日誌",
    desc: "查看全站所有操作軌跡與稽核事件",
  },
];

export function ensurePermissionCatalog(items: PermissionCodeInfo[]): PermissionCodeInfo[] {
  const map = new Map(items.map((item) => [item.code, item]));
  for (const required of REQUIRED_PERMISSION_CODES) {
    if (!map.has(required.code)) map.set(required.code, required);
  }
  return Array.from(map.values()).sort((a, b) => {
    const byGroup = a.group.localeCompare(b.group, "zh-Hant");
    return byGroup || a.label.localeCompare(b.label, "zh-Hant");
  });
}

const PERM_ICONS: Record<string, ReactElement> = {
  settings: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  org: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  document: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  serial: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  regulation: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  ),
  announcement: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M22 17H2a3 3 0 0 0 3-3V9a7 7 0 0 1 14 0v5a3 3 0 0 0 3 3z" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  meal: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
      <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
      <line x1="6" y1="1" x2="6" y2="4" />
      <line x1="10" y1="1" x2="10" y2="4" />
      <line x1="14" y1="1" x2="14" y2="4" />
    </svg>
  ),
  survey: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  ),
  shop: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  ),
};

function groupIconKey(group: string): string {
  if (group.includes("系統")) return "settings";
  if (group.includes("組織")) return "org";
  if (group.includes("公文")) return "document";
  if (group.includes("字號")) return "serial";
  if (group.includes("法規")) return "regulation";
  if (group.includes("公告")) return "announcement";
  if (group.includes("學餐")) return "meal";
  if (group.includes("問卷")) return "survey";
  if (group.includes("商品") || group.includes("財務")) return "shop";
  return "settings";
}

interface PermCheckboxesProps {
  selected: string[];
  onChange: (codes: string[]) => void;
  permCodes: PermissionCodeInfo[];
}

function isHighRiskPermission(code: string): boolean {
  return (
    code === "admin:all" ||
    code.includes("view_all") ||
    code.includes("admin") ||
    code.includes("delete") ||
    code.includes("publish") ||
    code.includes("issue_direct")
  );
}

export function PermCheckboxes({ selected, onChange, permCodes }: PermCheckboxesProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["系統管理"]));
  const [keyword, setKeyword] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const permGroups = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    const groupMap = new Map<string, PermissionCodeInfo[]>();
    for (const item of permCodes) {
      if (groupFilter !== "all" && item.group !== groupFilter) continue;
      if (
        q &&
        !item.group.toLowerCase().includes(q) &&
        !item.code.toLowerCase().includes(q) &&
        !item.label.toLowerCase().includes(q) &&
        !item.desc.toLowerCase().includes(q)
      ) {
        continue;
      }
      if (!groupMap.has(item.group)) groupMap.set(item.group, []);
      groupMap.get(item.group)!.push(item);
    }
    return Array.from(groupMap.entries())
      .map(([label, items]) => ({
        label,
        iconKey: groupIconKey(label),
        items: items.sort((a, b) => a.label.localeCompare(b.label, "zh-Hant")),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "zh-Hant"));
  }, [groupFilter, keyword, permCodes]);
  const allGroups = useMemo(
    () => Array.from(new Set(permCodes.map((item) => item.group))).sort((a, b) => a.localeCompare(b, "zh-Hant")),
    [permCodes],
  );
  const selectedItems = useMemo(
    () => selected.map((code) => permCodes.find((item) => item.code === code) ?? {
      group: "未知",
      code,
      label: code,
      desc: "",
    }),
    [permCodes, selected],
  );
  const highRiskSelected = selectedItems.filter((item) => isHighRiskPermission(item.code));

  const toggle = (code: string) =>
    onChange(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]);
  const toggleGroup = (label: string) =>
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(label)) s.delete(label);
      else s.add(label);
      return s;
    });

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-2">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" width="13" height="13"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜尋權限名稱、代碼或說明"
            className="w-full text-xs pl-8 pr-3 py-2 rounded-lg outline-none"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          />
        </div>
        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          className="w-full text-xs px-3 py-2 rounded-lg outline-none"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
        >
          <option value="all">全部模組</option>
          {allGroups.map((group) => <option key={group} value={group}>{group}</option>)}
        </select>
      </div>

      {selected.length > 0 && (
        <div className="rounded-xl px-3 py-2 space-y-1.5" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
              已選 {selected.length} 個權限
            </p>
            {highRiskSelected.length > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ color: "#f59e0b", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.28)" }}>
                {highRiskSelected.length} 個高風險
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {selectedItems.slice(0, 10).map((item) => (
              <button
                type="button"
                key={item.code}
                onClick={() => toggle(item.code)}
                className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full cursor-pointer transition-colors"
                style={{
                  background: isHighRiskPermission(item.code) ? "rgba(245,158,11,0.12)" : "var(--primary-dim)",
                  color: isHighRiskPermission(item.code) ? "#f59e0b" : "var(--primary)",
                  border: `1px solid ${isHighRiskPermission(item.code) ? "rgba(245,158,11,0.28)" : "var(--border-strong)"}`,
                }}
                title="點擊移除此權限"
              >
                {item.label}
                <span aria-hidden="true">×</span>
              </button>
            ))}
            {selectedItems.length > 10 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                +{selectedItems.length - 10}
              </span>
            )}
          </div>
        </div>
      )}

      {permGroups.map((g) => {
        const groupCodes = g.items.map((item) => item.code);
        if (!groupCodes.length) return null;
        const isOpen = expanded.has(g.label);
        const selectedCount = groupCodes.filter((c) => selected.includes(c)).length;
        return (
          <div
            key={g.label}
            className="rounded-xl overflow-hidden"
            style={{ border: "1px solid var(--border)" }}
          >
            <button
              type="button"
              onClick={() => toggleGroup(g.label)}
              className="flex items-center gap-2 w-full px-3 py-2.5 text-left transition-colors hover:opacity-80"
              style={{ background: isOpen ? "var(--primary-dim)" : "var(--bg-elevated)" }}
            >
              <span
                className="w-4 h-4 flex items-center justify-center flex-shrink-0"
                style={{ color: "var(--text-muted)" }}
              >
                {PERM_ICONS[g.iconKey]}
              </span>
              <span className="text-xs font-semibold flex-1" style={{ color: "var(--text-secondary)" }}>
                {g.label}
              </span>
              {selectedCount > 0 && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                  style={{ background: "var(--primary-dim)", color: "var(--primary)" }}
                >
                  {selectedCount}/{groupCodes.length}
                </span>
              )}
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                className="flex-shrink-0 transition-transform"
                style={{ color: "var(--text-muted)", transform: isOpen ? "rotate(90deg)" : "none" }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            {isOpen && (
              <div className="px-2 pb-2 pt-1 space-y-1" style={{ borderTop: "1px solid var(--border)" }}>
                {g.items.map((info) => {
                  const code = info.code;
                  const on = selected.includes(code);
                  return (
                    <label
                      key={code}
                      className="flex items-start gap-2.5 cursor-pointer px-3 py-2.5 rounded-xl transition-all"
                      style={{
                        background: on ? "var(--primary-dim)" : "transparent",
                        border: `1px solid ${on ? "var(--border-strong)" : "transparent"}`,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(code)}
                        className="accent-blue-600 flex-shrink-0 mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-xs font-medium"
                          style={{ color: on ? "var(--primary)" : "var(--text-primary)" }}
                        >
                          {info.label ?? code}
                          {isHighRiskPermission(code) && (
                            <span className="ml-1 text-[10px] font-normal" style={{ color: "#f59e0b" }}>
                              高風險
                            </span>
                          )}
                        </p>
                        {info.desc && (
                          <p className="text-[11px] mt-0.5 leading-tight" style={{ color: "var(--text-muted)" }}>
                            {info.desc}
                          </p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
