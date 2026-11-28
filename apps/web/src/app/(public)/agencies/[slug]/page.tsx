import "../agencies.css";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import AgencyPage from "@/components/agencies/AgencyPage";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import { pageMetadata } from "@/lib/seo";
import { fetchPublicAgency, fetchPublicShellData } from "@/lib/serverFetch";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchPublicAgency(slug);
  if (!data) return {};
  return pageMetadata({
    title: data.agency.name,
    description: data.agency.tagline || `${data.agency.name}的組織、職權與公開資訊。`,
    path: `/agencies/${encodeURIComponent(slug)}`,
    type: "website",
  });
}

export default async function AgencySlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [{ bundle, urgentAnnouncement }, data] = await Promise.all([
    fetchPublicShellData(),
    fetchPublicAgency(slug),
  ]);
  if (!data) notFound();

  return (
    <PublicSiteShell
      navPages={bundle?.nav_pages ?? []}
      settings={bundle?.settings}
      urgentAnnouncement={urgentAnnouncement}
    >
      <AgencyPage data={data} />
    </PublicSiteShell>
  );
}
