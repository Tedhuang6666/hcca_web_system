import Image from "next/image";
import { Mail, UserRound } from "lucide-react";

import OfficerRosterTabs, { type OfficerRosterTab } from "@/components/site/OfficerRosterTabs";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchPublicBundle, fetchPublicOfficers } from "@/lib/serverFetch";
import type { PublicOfficerOut } from "@/lib/types";

function parseDirectOfficerRosters(themeConfig: Record<string, unknown> | undefined): OfficerRosterTab[] {
  if (Array.isArray(themeConfig?.officer_rosters)) {
    const tabs = themeConfig.officer_rosters.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id.trim() : "";
      const label = typeof record.label === "string" ? record.label.trim() : "";
      const entries = parseRosterEntries(record.entries);
      return id && label ? [{ id, label, entries }] : [];
    });
    if (tabs.length > 0) return tabs;
  }
  const entries = parseRosterEntries(themeConfig?.officer_roster);
  return entries.length > 0 ? [{ id: "campus-council", label: "班聯會", entries }] : [];
}

function parseRosterEntries(value: unknown): Array<{ title: string; names: string[] }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const names = Array.isArray(record.names)
      ? record.names.filter((name): name is string => typeof name === "string").map((name) => name.trim()).filter(Boolean)
      : [];
    return title && names.length > 0 ? [{ title, names: [...new Set(names)] }] : [];
  });
}

function OfficerCard({ officer, index = 0 }: { officer: PublicOfficerOut; index?: number }) {
  return (
    <article
      className="flex min-w-0 items-center gap-3 rounded-xl p-3 transition-colors"
      data-reveal
      style={{ "--reveal-delay": `${Math.min(index, 8) * 55}ms` } as React.CSSProperties}
    >
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
        style={{ background: "var(--primary-dim)", color: "var(--primary)" }}
      >
        {officer.avatar_url ? (
          <Image
            src={officer.avatar_url}
            alt={`${officer.display_name} 頭像`}
            width={44}
            height={44}
            unoptimized
            className="h-11 w-11 rounded-full object-cover"
          />
        ) : (
          <UserRound size={19} aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-semibold">{officer.display_name}</h3>
          {officer.is_featured && (
            <span
              className="badge"
              style={{ color: "var(--primary)", background: "var(--primary-dim)", borderColor: "var(--border-strong)" }}
            >
              精選
            </span>
          )}
        </div>
        {officer.bio && <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--text-muted)]">{officer.bio}</p>}
        {officer.public_email && (
          <a
            href={`mailto:${officer.public_email}`}
            className="mt-1 inline-flex min-h-8 items-center gap-1.5 text-xs font-medium no-underline"
            style={{ color: "var(--primary)" }}
          >
            <Mail size={13} aria-hidden /> 聯絡
          </a>
        )}
      </div>
    </article>
  );
}

type OfficerRoleGroup = {
  positionName: string;
  officers: PublicOfficerOut[];
};

function groupOfficersByOrganization(officers: PublicOfficerOut[]) {
  const groups = new Map<string, OfficerRoleGroup[]>();
  for (const officer of officers) {
    const orgName = officer.org_name || "未分組";
    const positionName = officer.title || officer.position_name || "未命名職位";
    const roles = groups.get(orgName) ?? [];
    const role = roles.find((item) => item.positionName === positionName);
    if (role) {
      role.officers.push(officer);
    } else {
      roles.push({ positionName, officers: [officer] });
    }
    groups.set(orgName, roles);
  }
  return Array.from(groups, ([orgName, roles]) => ({ orgName, roles }));
}

export default async function OfficersPage() {
  const [bundle, officers] = await Promise.all([
    fetchPublicBundle(),
    fetchPublicOfficers(),
  ]);

  const directRosters = parseDirectOfficerRosters(bundle?.settings?.theme_config);
  const grouped = groupOfficersByOrganization(officers);

  return (
    <PublicSiteShell navPages={bundle?.nav_pages ?? []} settings={bundle?.settings}>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <header className="public-page-head mb-8">
          <p className="public-section-kicker">Officers</p>
          <h1 className="mt-2 text-3xl font-bold">班聯會幹部</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--text-secondary)]">
            依職位整理當屆幹部名冊，讓每個部門的分工與成員一眼可見。
          </p>
        </header>
        <div className="space-y-8">
          {directRosters.length > 0 && <OfficerRosterTabs tabs={directRosters} />}
          {directRosters.length === 0 && grouped.map(({ orgName, roles }) => (
            <section key={orgName} aria-labelledby={`org-${orgName}`}>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <h2 id={`org-${orgName}`} className="text-lg font-semibold">{orgName}</h2>
                <span className="text-xs text-[var(--text-muted)]">
                  {roles.reduce((total, role) => total + role.officers.length, 0)} 位幹部
                </span>
              </div>
              <div className="space-y-3">
                {roles.map((role, roleIndex) => (
                  <div
                    key={role.positionName}
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
                        <h3 className="font-semibold">{role.positionName}</h3>
                      </div>
                      <span className="text-xs text-[var(--text-muted)]">{role.officers.length} 人</span>
                    </div>
                    <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
                      {role.officers.map((officer, index) => (
                        <OfficerCard key={officer.id} officer={officer} index={index} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {directRosters.length === 0 && grouped.length === 0 && (
            <div className="card p-10 text-center text-sm text-[var(--text-muted)]">
              目前尚未設定公開幹部
            </div>
          )}
        </div>
      </div>
    </PublicSiteShell>
  );
}
