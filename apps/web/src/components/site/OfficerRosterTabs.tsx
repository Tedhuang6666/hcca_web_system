"use client";

import { Crown, UsersRound } from "lucide-react";
import { useState } from "react";

export function isLeadershipTitle(title: string): boolean {
  return /(?:長|主席|召集人)$/.test(title.trim());
}

export function getMemberLeadershipLabel(
  title: string,
  name: string,
  memberLabels?: Record<string, string>,
  legacyRoleLabel?: string,
  legacyLead = false,
): string {
  if (memberLabels !== undefined) return memberLabels[name]?.trim() ?? "";
  if (legacyRoleLabel !== undefined) return legacyRoleLabel.trim();
  if (legacyLead || isLeadershipTitle(title)) return "長級";
  return "";
}

export type OfficerRosterTab = {
  id: string;
  label: string;
  entries: Array<{
    title: string;
    names: string[];
    member_labels?: Record<string, string>;
    highlight_label?: string;
    is_lead?: boolean;
  }>;
};

export default function OfficerRosterTabs({ tabs }: { tabs: OfficerRosterTab[] }) {
  const [activeId, setActiveId] = useState(tabs[0]?.id ?? "");
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  if (!activeTab) return null;
  const memberCount = new Set(activeTab.entries.flatMap((entry) => entry.names)).size;

  return (
    <section aria-labelledby="officer-roster-heading">
      <div className="mb-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold tracking-[0.12em] text-[var(--primary-text)]">
              <UsersRound size={15} aria-hidden />
              <span>公開名冊</span>
            </div>
            <h2 id="officer-roster-heading" className="mt-2 text-2xl font-bold tracking-[-0.02em]">自治幹部</h2>
          </div>
          <div className="flex items-baseline gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
            <strong className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{memberCount}</strong>
            <span>位現任成員</span>
          </div>
        </div>
        <div
          className="flex max-w-full gap-1 overflow-x-auto rounded-lg border p-1"
          role="tablist"
          aria-label="自治組織名單"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`roster-tab-${tab.id}`}
              aria-selected={tab.id === activeTab.id}
              aria-controls={`roster-panel-${tab.id}`}
              onClick={() => setActiveId(tab.id)}
              className="min-h-10 shrink-0 rounded-md px-4 text-sm font-semibold transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2"
              style={tab.id === activeTab.id
                ? { color: "var(--primary-text)", background: "var(--primary-dim)" }
                : { color: "var(--text-secondary)" }}
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
        className="overflow-hidden rounded-xl border"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
      >
        <div className="hidden border-b px-6 py-3 sm:grid sm:grid-cols-[12rem,1fr]" style={{ borderColor: "var(--border)" }}>
          <span className="text-[11px] font-bold tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>職位</span>
          <span className="text-[11px] font-bold tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>在任成員</span>
        </div>
        {activeTab.entries.map((role) => {
          return (
            <div
              key={`${activeTab.id}-${role.title}`}
              className="grid gap-4 border-b px-5 py-5 last:border-0 sm:grid-cols-[12rem,1fr] sm:items-start sm:px-6"
              style={{ borderColor: "var(--border)" }}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[var(--bg-hover)] text-[var(--text-muted)]" aria-hidden>
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                </span>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold leading-7">{role.title}</h4>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>{role.names.length} 位成員</p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {role.names.map((name) => {
                  const leadershipLabel = getMemberLeadershipLabel(
                    role.title,
                    name,
                    role.member_labels,
                    role.highlight_label,
                    role.is_lead,
                  );
                  return (
                    <span
                      key={`${activeTab.id}-${role.title}-${name}`}
                      className="inline-flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-colors hover:bg-[var(--bg-hover)]"
                      style={{ background: "var(--bg-elevated)", color: "var(--text-primary)" }}
                    >
                      <span
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold"
                        style={{
                          background: leadershipLabel ? "var(--primary-dim)" : "var(--bg-hover)",
                          color: leadershipLabel ? "var(--primary-text)" : "var(--text-muted)",
                        }}
                        aria-hidden
                      >
                        {leadershipLabel ? <Crown size={14} /> : name.slice(0, 1)}
                      </span>
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="truncate">{name}</span>
                        {leadershipLabel && (
                          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: "var(--primary-dim)", color: "var(--primary-text)" }}>
                            {leadershipLabel}
                          </span>
                        )}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
