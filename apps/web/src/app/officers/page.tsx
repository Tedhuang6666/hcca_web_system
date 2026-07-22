import Image from "next/image";
import { Mail, UserRound, UsersRound } from "lucide-react";

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
      className="group flex min-w-0 items-center gap-3 border-b py-3 last:border-0"
      data-reveal
      style={{ "--reveal-delay": `${Math.min(index, 8) * 55}ms`, borderColor: "var(--border)" } as React.CSSProperties}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border"
        style={{ background: "var(--primary-dim)", color: "var(--primary)", borderColor: "var(--border-strong)" }}
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
          <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{officer.display_name}</h3>
          {officer.is_featured && (
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ color: "var(--primary-text)", background: "var(--primary-dim)" }}
            >
              精選
            </span>
          )}
        </div>
        {officer.bio && <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--text-muted)]">{officer.bio}</p>}
        {officer.public_email && (
          <a
            href={`mailto:${officer.public_email}`}
            className="mt-1 inline-flex min-h-8 items-center gap-1.5 text-xs font-semibold no-underline"
            style={{ color: "var(--primary-text)" }}
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
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 lg:pt-12">
        <header
          className="public-page-head mb-12 rounded-2xl border p-6 sm:p-8 lg:p-10"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
        >
          <div className="max-w-3xl">
            <div>
              <p className="mb-5 text-xs font-bold tracking-[0.16em] text-[var(--primary-text)]">HCCA / 公開名冊</p>
              <h1 className="text-5xl font-bold tracking-[-0.04em] sm:text-6xl">班聯會幹部</h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-[var(--text-secondary)]">
                認識正在服務校園的自治幹部，依組織與職位找到正確的聯絡對象。
              </p>
            </div>
          </div>
        </header>
        <div className="space-y-10">
          {directRosters.length > 0 && <OfficerRosterTabs tabs={directRosters} />}
          {directRosters.length === 0 && grouped.map(({ orgName, roles }) => (
            <section key={orgName} aria-labelledby={`org-${orgName}`}>
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-bold tracking-[0.12em] text-[var(--primary-text)]">自治組織</p>
                  <h2 id={`org-${orgName}`} className="mt-2 text-2xl font-bold">{orgName}</h2>
                </div>
                <span className="text-sm font-medium text-[var(--text-muted)]">
                  {new Set(roles.flatMap((role) => role.officers.map((officer) => officer.display_name))).size} 位幹部
                </span>
              </div>
              <div className="overflow-hidden rounded-2xl border" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
                {roles.map((role) => (
                  <div key={role.positionName} className="grid gap-4 border-b px-5 py-5 last:border-0 sm:grid-cols-[10rem,1fr] sm:items-start" style={{ borderColor: "var(--border)" }}>
                    <div>
                      <h3 className="text-sm font-bold">{role.positionName}</h3>
                    </div>
                    <div className="grid gap-x-5 sm:grid-cols-2">
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
            <div className="rounded-xl border p-10 text-center" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
              <UsersRound className="mx-auto" size={24} style={{ color: "var(--primary-text)" }} aria-hidden />
              <p className="mt-3 text-sm font-semibold">目前尚未設定公開幹部</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">公開名冊更新後會在這裡顯示。</p>
            </div>
          )}
        </div>
      </div>
    </PublicSiteShell>
  );
}
