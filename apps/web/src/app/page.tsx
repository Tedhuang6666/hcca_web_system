import PublicSiteShell from "@/components/site/PublicSiteShell";
import Link from "next/link";
import { fetchAnnouncements, fetchPublicBundle } from "@/lib/serverFetch";
import HomeContent from "./HomeContent";

export default async function PublicHomePage() {
  const [bundle, announcements] = await Promise.all([
    fetchPublicBundle(),
    fetchAnnouncements(4),
  ]);

  if (!bundle?.settings) {
    return (
      <PublicSiteShell>
        <section className="public-hero">
          <div className="public-hero-inner">
            <div className="public-hero-copy">
              <p className="public-section-kicker">HCCA</p>
              <h1>新竹高中班聯會</h1>
              <p className="public-hero-subtitle">
                公開資料暫時無法取得；您仍可瀏覽最新公告與班聯會公開服務。
              </p>
              <div className="public-hero-actions">
                <Link href="/news" className="public-cta-primary">
                  最新公告
                </Link>
                <Link href="/public" className="public-cta-secondary">
                  公開資料庫
                </Link>
              </div>
            </div>
          </div>
        </section>
      </PublicSiteShell>
    );
  }

  return (
    <PublicSiteShell navPages={bundle.nav_pages} settings={bundle.settings}>
      <HomeContent bundle={bundle} announcements={announcements} />
    </PublicSiteShell>
  );
}
