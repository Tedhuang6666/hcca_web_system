"use client";

import { Crown } from "lucide-react";
import { useState } from "react";

import { getMemberLeadershipLabel } from "./officerRosterUtils";

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

export default function OfficerRosterTabs({
  tabs,
  showHeading = true,
}: {
  tabs: OfficerRosterTab[];
  showHeading?: boolean;
}) {
  const [activeId, setActiveId] = useState(tabs[0]?.id ?? "");
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  if (!activeTab) return null;
  const memberCount = new Set(activeTab.entries.flatMap((entry) => entry.names)).size;
  const chairRoles = ["主席", "副主席"].flatMap((title) => {
    const role = activeTab.entries.find((entry) => entry.title.trim() === title);
    return role ? [role] : [];
  });
  const hasChairPair = chairRoles.length === 2;
  const otherRoles = hasChairPair
    ? activeTab.entries.filter((role) => !chairRoles.includes(role))
    : activeTab.entries;

  const renderLeadershipLabel = (
    role: OfficerRosterTab["entries"][number],
    name: string,
  ) => {
    const label = getMemberLeadershipLabel(
      role.title,
      name,
      role.member_labels,
      role.highlight_label,
      role.is_lead,
    );
    return label ? (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
        style={{ background: "var(--primary-dim)", color: "var(--primary-text)" }}
      >
        <Crown size={12} aria-hidden />
        {label}
      </span>
    ) : null;
  };

  return (
    <section
      aria-labelledby={showHeading ? "officer-roster-heading" : undefined}
      aria-label={showHeading ? undefined : "班聯會幹部名冊"}
    >
      {(showHeading || memberCount > 1) && (
        <header
          className={`mb-6 flex flex-wrap items-end gap-4 ${showHeading ? "justify-between" : "justify-end"}`}
        >
          {showHeading && (
            <h2 id="officer-roster-heading" className="text-2xl font-bold tracking-[-0.02em]">
              班聯會幹部
            </h2>
          )}
          {memberCount > 1 && (
            <p className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
              {memberCount} 位現任成員
            </p>
          )}
        </header>
      )}

      {tabs.length > 1 && (
        <div
          className="mb-8 flex max-w-full gap-1 overflow-x-auto rounded-lg border p-1"
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
      )}

      <div
        id={tabs.length > 1 ? `roster-panel-${activeTab.id}` : undefined}
        role={tabs.length > 1 ? "tabpanel" : undefined}
        aria-labelledby={tabs.length > 1 ? `roster-tab-${activeTab.id}` : undefined}
        className="space-y-8"
      >
        {activeTab.entries.length === 0 && (
          <p
            className="border-y py-8 text-center text-sm"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            目前尚未設定公開幹部
          </p>
        )}

        {hasChairPair && (
          <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
            {chairRoles.map((role) => (
              <section key={`${activeTab.id}-${role.title}`} className="min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b pb-3" style={{ borderColor: "var(--border)" }}>
                  <h3 className="text-xl font-bold text-[var(--text-primary)]">{role.title}</h3>
                  {role.names.length > 1 && (
                    <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                      {role.names.length} 位成員
                    </span>
                  )}
                </div>
                <ul className="mt-2">
                  {role.names.map((name) => (
                    <li
                      key={`${activeTab.id}-${role.title}-${name}`}
                      className="flex min-h-12 min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b py-3 last:border-0"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <span className="min-w-0 text-base font-semibold text-[var(--text-primary)]">{name}</span>
                      {renderLeadershipLabel(role, name)}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {otherRoles.length > 0 && (
          <div className="border-y" style={{ borderColor: "var(--border)" }}>
            {otherRoles.map((role) => (
              <div
                key={`${activeTab.id}-${role.title}`}
                className="grid gap-2 border-b py-4 last:border-0 sm:grid-cols-[12rem,1fr] sm:items-center sm:gap-6"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 className="text-base font-bold text-[var(--text-primary)]">{role.title}</h3>
                  {role.names.length > 1 && (
                    <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                      {role.names.length} 位成員
                    </span>
                  )}
                </div>
                <ul className="flex flex-wrap gap-x-6 gap-y-1">
                  {role.names.map((name) => (
                    <li
                      key={`${activeTab.id}-${role.title}-${name}`}
                      className="flex min-h-11 min-w-0 flex-wrap items-center gap-2 py-1 text-base font-medium text-[var(--text-primary)]"
                    >
                      {name}
                      {renderLeadershipLabel(role, name)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
