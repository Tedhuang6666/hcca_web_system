export default function PublicHomeLoading() {
  return (
    <div className="public-site min-h-screen text-[var(--public-text)]">
      <header className="public-header" aria-hidden="true">
        <div className="public-header-inner">
          <div className="h-10 w-48 rounded-md bg-[var(--public-soft)]" />
          <div className="h-10 w-32 rounded-md bg-[var(--public-soft)]" />
        </div>
      </header>
      <main id="main-content" aria-busy="true" aria-label="首頁載入中">
        <section className="public-hero" aria-hidden="true">
          <div className="public-hero-inner">
            <div className="public-hero-copy">
              <div className="h-16 max-w-[24rem] rounded-xl bg-[var(--public-soft)] md:h-24" />
              <div className="mt-5 h-5 max-w-[34rem] rounded-md bg-[var(--public-soft)]" />
              <div className="mt-2 h-5 max-w-[28rem] rounded-md bg-[var(--public-soft)]" />
            </div>
            <div className="public-signboard public-identity-panel">
              <div className="public-signboard-emblem">
                <div className="aspect-square w-full rounded-full bg-[var(--public-soft)]" />
              </div>
            </div>
            <div className="public-hero-actions">
              <div className="h-11 w-32 rounded-md bg-[var(--public-soft)]" />
              <div className="h-11 w-24 rounded-md bg-[var(--public-soft)]" />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
