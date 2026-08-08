import "./public-home.css";
import { Suspense } from "react";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import {
  fetchActiveUrgentAnnouncement,
  fetchPublicBundle,
} from "@/lib/serverFetch";
import DeferredHomeContent from "./DeferredHomeContent";
import HomeHero from "./HomeHero";

function DeferredHomeFallback() {
  return <div className="min-h-40" aria-hidden="true" />;
}

export default async function PublicHomePage() {
  const [bundle, urgentAnnouncement] = await Promise.all([
    fetchPublicBundle(),
    fetchActiveUrgentAnnouncement(),
  ]);

  return (
    <PublicSiteShell
      navPages={bundle?.nav_pages ?? []}
      settings={bundle?.settings}
      urgentAnnouncement={urgentAnnouncement}
    >
      <HomeHero bundle={bundle} />
      <Suspense fallback={<DeferredHomeFallback />}>
        <DeferredHomeContent bundle={bundle} urgentAnnouncement={urgentAnnouncement} />
      </Suspense>
    </PublicSiteShell>
  );
}
