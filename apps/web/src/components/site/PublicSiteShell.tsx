import Link from "next/link";

import PublicEmblem from "@/components/site/PublicEmblem";
import PublicSiteBackLink from "@/components/site/PublicSiteBackLink";
import PublicSiteHeader from "@/components/site/PublicSiteHeader";
import PublicScrollReveal from "@/components/site/PublicScrollReveal";
import { BRANDING } from "@/lib/branding";
import type { AnnouncementOut, PublicSitePageOut, PublicSiteSettingsOut } from "@/lib/types";

export default function PublicSiteShell({
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
  const publicEmblemUrl = settings?.site_logo_url?.trim() || BRANDING.publicEmblemUrl;

  return (
    <div className="public-site min-h-screen text-[var(--public-text)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[var(--public-surface)] focus:px-3 focus:py-2"
      >
        跳到主要內容
      </a>
      <PublicSiteHeader
        navPages={navPages}
        settings={settings}
        urgentAnnouncement={urgentAnnouncement}
      />
      <PublicScrollReveal />
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
            <p>把重要的自治資訊，留在校園裡每個人都能抵達的地方。</p>
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
          <span>學生自治，從公開開始。</span>
        </div>
      </footer>
    </div>
  );
}
