import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchAnnouncements, fetchPublicBundle } from "@/lib/serverFetch";
import HomeContent from "./HomeContent";

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
          <h1>網站載入中</h1>
          <p>請稍候。</p>
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
