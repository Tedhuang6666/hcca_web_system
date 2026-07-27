import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Crown, Mail, UserRound, UsersRound } from "lucide-react";

import OfficerRosterTabs, {
  isLeadershipTitle,
  type OfficerRosterTab,
} from "@/components/site/OfficerRosterTabs";
import type { PublicOfficerOut } from "@/lib/types";

export function parseDirectOfficerRosters(
  themeConfig: Record<string, unknown> | undefined,
): OfficerRosterTab[] {
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

function parseRosterEntries(value: unknown): OfficerRosterTab["entries"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const names = Array.isArray(record.names)
      ? record.names
          .filter((name): name is string => typeof name === "string")
          .map((name) => name.trim())
          .filter(Boolean)
      : [];
    const highlightLabel = Object.prototype.hasOwnProperty.call(record, "highlight_label")
      ? (typeof record.highlight_label === "string" ? record.highlight_label.trim() : "")
      : undefined;
    const isLead = typeof record.is_lead === "boolean" ? record.is_lead : false;
    const memberLabels = record.member_labels && typeof record.member_labels === "object" && !Array.isArray(record.member_labels)
      ? Object.fromEntries(
          Object.entries(record.member_labels as Record<string, unknown>).flatMap(([name, label]) => (
            typeof label === "string" && names.includes(name) && label.trim()
              ? [[name, label.trim()]]
              : []
          )),
        )
      : highlightLabel && names[0] ? { [names[0]]: highlightLabel } : undefined;
    return title && names.length > 0
      ? [{ title, names: [...new Set(names)], member_labels: memberLabels, highlight_label: highlightLabel, is_lead: isLead }]
      : [];
  });
}

function OfficerCard({ officer, index = 0 }: { officer: PublicOfficerOut; index?: number }) {
  const isLeader = isLeadershipTitle(officer.title);

  return (
    <article
      className={`group flex min-w-0 items-center gap-3 border-b py-3 last:border-0 ${
        isLeader ? "rounded-lg px-2" : ""
      }`}
      data-reveal
      style={{
        "--reveal-delay": `${Math.min(index, 8) * 55}ms`,
        borderColor: "var(--border)",
        background: isLeader ? "var(--primary-dim)" : undefined,
      } as React.CSSProperties}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border"
        style={{
          background: isLeader ? "var(--primary)" : "var(--primary-dim)",
          color: isLeader ? "var(--primary-text)" : "var(--primary)",
          borderColor: isLeader ? "var(--primary)" : "var(--border-strong)",
        }}
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
        ) : isLeader ? (
          <Crown size={18} aria-hidden />
        ) : (
          <UserRound size={19} aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">
            {officer.display_name}
          </h3>
          {isLeader && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold"
              style={{ color: "var(--primary-text)", background: "var(--primary)" }}
            >
              <Crown size={11} aria-hidden /> 部門主管
            </span>
          )}
          {officer.is_featured && (
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ color: "var(--primary-text)", background: "var(--primary-dim)" }}
            >
              精選
            </span>
          )}
        </div>
        {officer.bio && (
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--text-muted)]">
            {officer.bio}
          </p>
        )}
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
  return Array.from(groups, ([orgName, roles]) => ({
    orgName,
    roles: roles.sort(
      (a, b) => Number(isLeadershipTitle(b.positionName)) - Number(isLeadershipTitle(a.positionName)),
    ),
  }));
}

export default function PublicOfficerDirectory({
  officers,
  themeConfig,
  showHeading = true,
  showFullPageLink = true,
}: {
  officers: PublicOfficerOut[];
  themeConfig?: Record<string, unknown>;
  showHeading?: boolean;
  showFullPageLink?: boolean;
}) {
  const directRosters = parseDirectOfficerRosters(themeConfig);
  const grouped = groupOfficersByOrganization(officers);

  return (
    <div className="space-y-10">
      {showHeading && (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold tracking-[0.12em] text-[var(--primary-text)]">
              <UsersRound size={15} aria-hidden />
              <span>組織名單</span>
            </div>
            <h2 className="mt-2 text-2xl font-bold">班聯會幹部</h2>
          </div>
          {showFullPageLink && (
            <Link href="/officers" className="public-text-link inline-flex items-center gap-1.5">
              開啟完整幹部頁面
              <ArrowUpRight size={15} aria-hidden />
            </Link>
          )}
        </div>
      )}
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
          <div
            className="overflow-hidden rounded-2xl border"
            style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
          >
            {roles.map((role) => {
              const isLeader = isLeadershipTitle(role.positionName);
              return (
                <div
                  key={role.positionName}
                  className="grid gap-4 border-b px-5 py-5 last:border-0 sm:grid-cols-[10rem,1fr] sm:items-start"
                  style={{
                    borderColor: "var(--border)",
                    background: isLeader ? "var(--primary-dim)" : undefined,
                  }}
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold">{role.positionName}</h3>
                      {isLeader && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                          style={{ color: "var(--primary-text)", background: "var(--primary)" }}
                        >
                          長級
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-x-5 sm:grid-cols-2">
                    {role.officers.map((officer, index) => (
                      <OfficerCard key={officer.id} officer={officer} index={index} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {directRosters.length === 0 && grouped.length === 0 && (
        <div
          className="rounded-xl border p-10 text-center"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
        >
          <UsersRound className="mx-auto" size={24} style={{ color: "var(--primary-text)" }} aria-hidden />
          <p className="mt-3 text-sm font-semibold">目前尚未設定公開幹部</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">公開名冊更新後會在這裡顯示。</p>
        </div>
      )}
    </div>
  );
}
