"use client";

import { UserRound } from "lucide-react";
import { useState } from "react";

export type OfficerRosterTab = {
  id: string;
  label: string;
  entries: Array<{ title: string; names: string[] }>;
};

export default function OfficerRosterTabs({ tabs }: { tabs: OfficerRosterTab[] }) {
  const [activeId, setActiveId] = useState(tabs[0]?.id ?? "");
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  if (!activeTab) return null;
  const memberCount = activeTab.entries.reduce((total, entry) => total + entry.names.length, 0);

  return (
    <section aria-labelledby="officer-roster-heading">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="officer-roster-heading" className="text-lg font-semibold">組織名單</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">切換頁籤查看不同自治組織的幹部名單。</p>
        </div>
        <div className="flex max-w-full gap-2 overflow-x-auto pb-1" role="tablist" aria-label="自治組織名單">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === activeTab.id}
              onClick={() => setActiveId(tab.id)}
              className="min-h-11 shrink-0 rounded-lg px-4 text-sm font-semibold transition-colors"
              style={tab.id === activeTab.id
                ? { color: "var(--primary-contrast, white)", background: "var(--primary)" }
                : { color: "var(--text-secondary)", background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <h3 className="text-base font-semibold">{activeTab.label}</h3>
        <span className="text-xs text-[var(--text-muted)]">{memberCount} 位幹部</span>
      </div>
      <div className="space-y-3">
        {activeTab.entries.map((role, roleIndex) => (
          <div
            key={`${activeTab.id}-${role.title}-${roleIndex}`}
            className="overflow-hidden rounded-2xl"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
          >
            <div
              className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}
            >
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold tabular-nums" style={{ color: "var(--primary)" }}>
                  {String(roleIndex + 1).padStart(2, "0")}
                </span>
                <h4 className="font-semibold">{role.title}</h4>
              </div>
              <span className="text-xs text-[var(--text-muted)]">{role.names.length} 人</span>
            </div>
            <div className="flex flex-wrap gap-2 p-3">
              {role.names.map((name) => (
                <span
                  key={`${activeTab.id}-${role.title}-${name}`}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                >
                  <UserRound size={15} style={{ color: "var(--primary)" }} aria-hidden />
                  {name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
