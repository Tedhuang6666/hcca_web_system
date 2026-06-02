"use client";

import Image from "next/image";
import { Mail, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import PublicSiteShell from "@/components/site/PublicSiteShell";
import { siteApi } from "@/lib/api";
import type { PublicOfficerOut, PublicSiteBundleOut } from "@/lib/types";

function OfficerCard({ officer }: { officer: PublicOfficerOut }) {
  return (
    <article className="card p-5">
      <div className="flex items-start gap-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full"
          style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
          {officer.avatar_url ? (
            <Image
              src={officer.avatar_url}
              alt={`${officer.display_name} 頭像`}
              width={56}
              height={56}
              unoptimized
              className="h-14 w-14 rounded-full object-cover"
            />
          ) : (
            <UserRound size={24} aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{officer.display_name}</h2>
            {officer.is_featured && (
              <span className="badge" style={{ color: "var(--primary)", background: "var(--primary-dim)", borderColor: "var(--border-strong)" }}>
                精選
              </span>
            )}
          </div>
          <p className="mt-1 text-sm font-medium text-[var(--text-secondary)]">{officer.title}</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {officer.org_name} / {officer.position_name}
          </p>
          {officer.bio && (
            <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">{officer.bio}</p>
          )}
          {officer.public_email && (
            <a
              href={`mailto:${officer.public_email}`}
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium no-underline"
              style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
              <Mail size={16} aria-hidden />
              {officer.public_email}
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export default function OfficersPage() {
  const [bundle, setBundle] = useState<PublicSiteBundleOut | null>(null);
  const [officers, setOfficers] = useState<PublicOfficerOut[]>([]);

  useEffect(() => {
    Promise.all([siteApi.public(), siteApi.publicOfficers(true)])
      .then(([nextBundle, nextOfficers]) => {
        setBundle(nextBundle);
        setOfficers(nextOfficers);
      })
      .catch(() => {
        setBundle(null);
        setOfficers([]);
      });
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, PublicOfficerOut[]>();
    for (const officer of officers) {
      map.set(officer.org_name, [...(map.get(officer.org_name) ?? []), officer]);
    }
    return Array.from(map.entries());
  }, [officers]);

  return (
    <PublicSiteShell navPages={bundle?.nav_pages ?? []} settings={bundle?.settings}>
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <header className="mb-8">
          <p className="text-sm font-semibold text-[var(--primary)]">Officers</p>
          <h1 className="mt-2 text-3xl font-bold">班聯會幹部</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--text-secondary)]">
            本頁連結既有任期資料，並由後台控制公開稱謂、簡介與排序。
          </p>
        </header>
        <div className="space-y-8">
          {grouped.map(([orgName, items]) => (
            <section key={orgName} aria-labelledby={`org-${orgName}`}>
              <h2 id={`org-${orgName}`} className="mb-3 text-lg font-semibold">{orgName}</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {items.map((officer) => <OfficerCard key={officer.id} officer={officer} />)}
              </div>
            </section>
          ))}
          {grouped.length === 0 && (
            <div className="card p-10 text-center text-sm text-[var(--text-muted)]">
              目前尚未設定公開幹部
            </div>
          )}
        </div>
      </div>
    </PublicSiteShell>
  );
}
