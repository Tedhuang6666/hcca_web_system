"use client";

import { Mail } from "lucide-react";
import { useEffect, useState } from "react";

import PublicSiteShell from "@/components/site/PublicSiteShell";
import { siteApi } from "@/lib/api";
import type { PublicOfficerOut, PublicSiteBundleOut } from "@/lib/types";

export default function OfficersPage() {
  const [site, setSite] = useState<PublicSiteBundleOut | null>(null);
  const [officers, setOfficers] = useState<PublicOfficerOut[]>([]);

  useEffect(() => {
    siteApi.public().then(setSite).catch(() => setSite(null));
    siteApi.publicOfficers(true).then(setOfficers).catch(() => setOfficers([]));
  }, []);

  return (
    <PublicSiteShell navPages={site?.nav_pages ?? []}>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <header className="mb-8">
          <p className="text-sm font-semibold text-[var(--primary)]">Officers</p>
          <h1 className="mt-2 text-3xl font-bold">班聯會幹部</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--text-secondary)]">
            本頁由後台連結既有任期資料產生，僅顯示已設定公開的幹部資訊。
          </p>
        </header>
        {officers.length === 0 ? (
          <div className="card p-10 text-center text-sm text-[var(--text-muted)]">目前尚未公開幹部名單</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {officers.map((officer) => (
              <article key={officer.profile_id} className="card p-5">
                <div className="flex items-start gap-4">
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-[var(--primary-dim)] text-lg font-bold text-[var(--primary)]">
                    {officer.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={officer.avatar_url}
                        alt={`${officer.display_name} 頭像`}
                        className="h-full w-full rounded-lg object-cover"
                      />
                    ) : (
                      officer.display_name.slice(0, 1)
                    )}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold">{officer.display_name}</h2>
                    <p className="text-sm text-[var(--text-secondary)]">{officer.title}</p>
                    <p className="text-xs text-[var(--text-muted)]">{officer.org_name}</p>
                  </div>
                </div>
                {officer.bio && (
                  <p className="mt-4 text-sm leading-7 text-[var(--text-secondary)]">{officer.bio}</p>
                )}
                {officer.public_email && (
                  <a href={`mailto:${officer.public_email}`} className="btn btn-ghost mt-4 min-h-11">
                    <Mail size={15} aria-hidden />
                    聯絡
                  </a>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </PublicSiteShell>
  );
}
