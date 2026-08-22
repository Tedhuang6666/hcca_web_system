import Link from "next/link";

import PublicEmblem from "@/components/site/PublicEmblem";
import PublicSiteBackLink from "@/components/site/PublicSiteBackLink";
import PublicSiteHeader from "@/components/site/PublicSiteHeader";
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
        {children}
      </main>
      <footer className="public-footer">
        <div className="public-footer-inner">
          <div className="public-footer-brand">
            <Link href="/" className="public-footer-brand-link">
              <span className="public-footer-mark" aria-hidden="true">
                <PublicEmblem
                  src={publicEmblemUrl}
                  alt=""
                  variant="small"
                  className="h-full w-full object-contain"
                  sizes="36px"
                />
              </span>
              <span>
                <strong>{BRANDING.orgName}</strong>
                <span>校園自治公開資訊</span>
              </span>
            </Link>
          </div>
          <nav className="public-footer-links" aria-label="頁尾導覽">
            <span className="public-footer-label">快速連結</span>
            <Link href="/news">最新公告</Link>
            <Link href="/about">關於班聯會</Link>
            <Link href="/public">公開資料庫</Link>
          </nav>
          <nav className="public-footer-links" aria-label="法律與無障礙資訊">
            <span className="public-footer-label">網站資訊</span>
            <Link href="/legal/accessibility">無障礙聲明</Link>
            <Link href="/legal/privacy">隱私政策</Link>
          </nav>
        </div>
        <div className="public-footer-bottom">
          <span>HCCA · {BRANDING.schoolName}</span>
        </div>
      </footer>
    </div>
  );
}
