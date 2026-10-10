import type { Metadata } from "next";
import Link from "next/link";
import PublicEmblem from "@/components/site/PublicEmblem";
import PublicSiteHeader from "@/components/site/PublicSiteHeader";
import { BRANDING } from "@/lib/branding";

import "../../../public-design-system.css";
import "../../public-footer.css";
import "../../../(protected)/shop/shop-public.css";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function PublicShopOrderLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-site min-h-screen text-[var(--public-text)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[var(--public-surface)] focus:px-3 focus:py-2"
      >
        跳到主要內容
      </a>
      <PublicSiteHeader />
      <main id="main-content">{children}</main>
      <footer className="public-footer">
        <div className="public-footer-inner">
          <div className="public-footer-brand">
            <Link href="/" className="public-footer-brand-link">
              <span className="public-footer-mark" aria-hidden="true">
                <PublicEmblem
                  src={BRANDING.publicEmblemUrl}
                  alt=""
                  variant="small"
                  className="h-full w-full object-contain"
                  sizes="36px"
                />
              </span>
              <span>
                <strong>{BRANDING.orgName}</strong>
                <span>數位整合系統</span>
              </span>
            </Link>
          </div>
          <nav className="public-footer-links" aria-label="頁尾導覽">
            <span className="public-footer-label">快速連結</span>
            <Link href="/shop">商品訂購</Link>
            <Link href="/shop/orders">我的預購</Link>
            <Link href="/public">公開資料庫</Link>
          </nav>
          <nav className="public-footer-links" aria-label="法律與無障礙資訊">
            <span className="public-footer-label">網站資訊</span>
            <Link href="/legal/accessibility">無障礙聲明</Link>
            <Link href="/legal/privacy">隱私政策</Link>
          </nav>
        </div>
        <div className="public-footer-bottom">
          <span>{BRANDING.orgShortName} · {BRANDING.platformName}</span>
        </div>
      </footer>
    </div>
  );
}
