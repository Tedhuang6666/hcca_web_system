import "./agencies.css";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import PublicSiteShell from "@/components/site/PublicSiteShell";
import { BRANCH_META } from "@/lib/agency-meta";
import { pageMetadata } from "@/lib/seo";
import { fetchPublicAgencies, fetchPublicShellData } from "@/lib/serverFetch";

export const metadata = pageMetadata({
  title: "自治機關",
  description: "學生會、學生議會、評議委員會與學生代表團的組織、議事與公開資訊。",
  path: "/agencies",
  type: "website",
});

export default async function AgenciesPage() {
  const [{ bundle, urgentAnnouncement }, agencies] = await Promise.all([
    fetchPublicShellData(),
    fetchPublicAgencies(),
  ]);

  return (
    <PublicSiteShell
      navPages={bundle?.nav_pages ?? []}
      settings={bundle?.settings}
      urgentAnnouncement={urgentAnnouncement}
    >
      <div className="agency-hub">
        <header className="public-page-head mb-8">
          <h1 className="text-3xl font-bold">自治機關</h1>
        </header>
        {agencies.length === 0 ? (
          <p className="agency-empty">尚未公開任何機關專頁</p>
        ) : (
          <ul className="agency-hub-list">
            {agencies.map((agency) => (
              <li key={agency.slug}>
                <Link href={`/agencies/${encodeURIComponent(agency.slug)}`}>
                  <span>
                    <span className="agency-meta">{BRANCH_META[agency.branch].label}</span>
                    <strong>{agency.name}</strong>
                    {agency.tagline && <p>{agency.tagline}</p>}
                  </span>
                  <ArrowRight size={22} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PublicSiteShell>
  );
}
