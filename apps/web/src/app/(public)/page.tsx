import "./public-home.css";
import { Suspense } from "react";
import type { Metadata } from "next";
import { preload } from "react-dom";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import {
  fetchActiveUrgentAnnouncement,
  fetchPublicBundle,
} from "@/lib/serverFetch";
import DeferredHomeContent from "./DeferredHomeContent";
import HomeHero from "./HomeHero";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

function DeferredHomeFallback() {
  return <div className="min-h-40" aria-hidden="true" />;
}

export default async function PublicHomePage() {
  const [bundle, urgentAnnouncement] = await Promise.all([
    fetchPublicBundle(),
    fetchActiveUrgentAnnouncement(),
  ]);
  const heroImageUrl = bundle?.settings?.site_logo_url?.trim() || "/brand/hcca-emblem-320.avif";
  preload(heroImageUrl, {
    as: "image",
    fetchPriority: "high",
    ...(heroImageUrl.endsWith(".avif") ? { type: "image/avif" } : {}),
  });

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
