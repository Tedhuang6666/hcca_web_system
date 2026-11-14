import "./public-home.css";
import { Suspense } from "react";
import type { Metadata } from "next";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchPublicShellData, fetchPublicSurveys } from "@/lib/serverFetch";
import DeferredHomeContent from "./DeferredHomeContent";
import { HomeEntrySection } from "./HomeContent";
import HomeHero from "./HomeHero";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

function DeferredHomeFallback() {
  return (
    <section className="public-home-loading" aria-live="polite" aria-busy="true">
      <div className="public-home-loading-inner" role="status">
        <p>正在取得最新校園動態</p>
        <div className="public-home-loading-lines" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    </section>
  );
}

export default async function PublicHomePage() {
  const [{ bundle, urgentAnnouncement }, openSurveys] = await Promise.all([
    fetchPublicShellData(),
    fetchPublicSurveys("open"),
  ]);
  return (
    <PublicSiteShell
      navPages={bundle?.nav_pages ?? []}
      settings={bundle?.settings}
      urgentAnnouncement={null}
    >
      <HomeHero bundle={bundle} />
      <div className="public-home-deferred-region">
        <Suspense fallback={<DeferredHomeFallback />}>
          <DeferredHomeContent
            bundle={bundle}
            urgentAnnouncement={urgentAnnouncement}
            openSurveys={openSurveys}
          />
        </Suspense>
      </div>
      <HomeEntrySection bundle={bundle} />
    </PublicSiteShell>
  );
}
