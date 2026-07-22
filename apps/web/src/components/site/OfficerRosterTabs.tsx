"use client";

import { UserRound, UsersRound } from "lucide-react";
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
  const memberCount = new Set(activeTab.entries.flatMap((entry) => entry.names)).size;

  return (
    <section aria-labelledby="officer-roster-heading">
      <div className="mb-7 flex flex-col gap-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold tracking-[0.12em] text-[var(--primary-text)]">
            <UsersRound size={15} aria-hidden />
            <span>組織名單</span>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="officer-roster-heading" className="mt-2 text-2xl font-bold">選擇自治組織</h2>
            <span className="text-sm font-medium text-[var(--text-muted)]">{memberCount} 位幹部</span>
          </div>
        </div>
        <div className="flex max-w-full gap-6 overflow-x-auto border-b" role="tablist" aria-label="自治組織名單" style={{ borderColor: "var(--border)" }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`roster-tab-${tab.id}`}
              aria-selected={tab.id === activeTab.id}
              aria-controls={`roster-panel-${tab.id}`}
              onClick={() => setActiveId(tab.id)}
              className="min-h-12 shrink-0 border-b-2 px-0.5 text-sm font-bold transition-[border-color,color] focus-visible:outline-2 focus-visible:outline-offset-4"
              style={tab.id === activeTab.id
                ? { color: "var(--primary-text)", borderColor: "var(--primary)" }
                : { color: "var(--text-muted)", borderColor: "transparent" }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div
        id={`roster-panel-${activeTab.id}`}
        role="tabpanel"
        aria-labelledby={`roster-tab-${activeTab.id}`}
        className="overflow-hidden rounded-2xl border"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center justify-between px-5 py-3" style={{ background: "var(--bg-hover)", borderBottom: "1px solid var(--border)" }}>
          <span className="text-xs font-bold tracking-[0.08em] text-[var(--text-muted)]">職位</span>
          <span className="text-xs font-bold tracking-[0.08em] text-[var(--text-muted)]">成員</span>
        </div>
        {activeTab.entries.map((role) => (
          <div
            key={`${activeTab.id}-${role.title}`}
            className="grid gap-4 border-b px-5 py-5 last:border-0 sm:grid-cols-[10rem,1fr] sm:items-start"
            style={{ borderColor: "var(--border)" }}
          >
            <div>
              <h4 className="text-sm font-bold">{role.title}</h4>
            </div>
            <div className="flex flex-wrap gap-2">
              {role.names.map((name) => (
                <span
                  key={`${activeTab.id}-${role.title}-${name}`}
                  className="inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium"
                  style={{ background: "var(--bg-elevated)", borderColor: "var(--border)", color: "var(--text-primary)" }}
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
