import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchAnnouncements, fetchPublicBundle } from "@/lib/serverFetch";
import HomeContent from "./HomeContent";

export const dynamic = "force-dynamic";

export default async function PublicHomePage() {
  const [bundle, announcements] = await Promise.all([
    fetchPublicBundle(),
    fetchAnnouncements(4),
  ]);

  if (!bundle?.settings) {
    return (
      <main className="public-site public-home-pending min-h-screen text-[var(--public-text)]">
        <section className="public-home-pending-card" aria-busy="true" aria-live="polite">
          <span className="public-home-pending-mark" aria-hidden />
          <p className="public-section-kicker">Public Site</p>
          <h1>公開首頁載入中</h1>
          <p>正在確認網站設定，確認完成後才會顯示對外首頁。</p>
        </section>
      </main>
    );
  }

  return (
    <PublicSiteShell navPages={bundle.nav_pages} settings={bundle.settings}>
      <HomeContent bundle={bundle} announcements={announcements} />
    </PublicSiteShell>
  );
}
