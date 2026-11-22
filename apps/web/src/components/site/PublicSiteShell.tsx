import PageTransition from "@/components/layout/PageTransition";
import PublicSiteBackLink from "@/components/site/PublicSiteBackLink";
import PublicSiteHeader from "@/components/site/PublicSiteHeader";
import PublicSiteFooter from "@/components/site/PublicSiteFooter";
import { BRANDING } from "@/lib/branding";
import { fetchActiveUrgentAnnouncement } from "@/lib/serverFetch";
import type { AnnouncementOut, PublicSitePageOut, PublicSiteSettingsOut } from "@/lib/types";

export default async function PublicSiteShell({
  children,
  navPages = [],
  settings,
  urgentAnnouncement,
}: {
  children: React.ReactNode;
  navPages?: PublicSitePageOut[];
  settings?: PublicSiteSettingsOut | null;
  urgentAnnouncement?: AnnouncementOut | null;
}) {
  // Resolve the shared announcement on the server so the header's first paint
  // already has its final height. Fetching is independently cached in
  // serverFetch, so public pages do not repeat the backend query per request.
  const resolvedUrgentAnnouncement =
    urgentAnnouncement === undefined
      ? await fetchActiveUrgentAnnouncement()
      : urgentAnnouncement;
  const publicEmblemUrl = settings?.site_logo_url?.trim() || BRANDING.publicEmblemUrl;
  // PublicSiteHeader is a client component. Pass only its display fields so the
  // RSC payload never includes full page bodies, homepage configuration, or
  // announcement content that the header cannot render.
  const headerSettings = settings
    ? {
        site_logo_url: settings.site_logo_url,
        site_logo_alt: settings.site_logo_alt,
        theme_config: settings.theme_config,
      }
    : null;
  const headerNavPages = navPages.map((page) => ({
    id: page.id,
    slug: page.slug,
    title: page.title,
    nav_label: page.nav_label,
    page_kind: page.page_kind,
  }));
  const resolvedHeaderAnnouncement = urgentAnnouncement ?? resolvedUrgentAnnouncement;
  const headerUrgentAnnouncement = resolvedHeaderAnnouncement
    ? {
        id: resolvedHeaderAnnouncement.id,
        updated_at: resolvedHeaderAnnouncement.updated_at,
        link_url: resolvedHeaderAnnouncement.link_url,
        title: resolvedHeaderAnnouncement.title,
        link_label: resolvedHeaderAnnouncement.link_label,
      }
    : null;

  return (
    <div className="public-site min-h-screen text-[var(--public-text)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[var(--public-surface)] focus:px-3 focus:py-2"
      >
        跳到主要內容
      </a>
      <PublicSiteHeader
        navPages={headerNavPages}
        settings={headerSettings}
        urgentAnnouncement={headerUrgentAnnouncement}
      />
      <main id="main-content">
        <PublicSiteBackLink />
        <PageTransition>{children}</PageTransition>
      </main>
      <PublicSiteFooter emblemUrl={publicEmblemUrl} />
    </div>
  );
}
