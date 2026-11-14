import Link from "next/link";

import PublicEmblem from "@/components/site/PublicEmblem";
import { BRANDING } from "@/lib/branding";

export default function PublicSiteFooter({
  emblemUrl = BRANDING.publicEmblemUrl,
}: {
  emblemUrl?: string;
}) {
  return (
    <footer className="public-footer">
      <div className="public-footer-inner">
        <Link href="/" className="public-footer-brand-link">
          <span className="public-footer-mark" aria-hidden="true">
            <PublicEmblem src={emblemUrl} alt="" variant="small" sizes="36px" />
          </span>
          <span>
            <strong>{BRANDING.orgShortName}</strong>
            <span>{BRANDING.domain}</span>
          </span>
        </Link>
        <nav className="public-footer-links" aria-label="頁尾導覽">
          <Link href="/about">關於班聯會</Link>
          <Link href="/officers">幹部名單</Link>
          <Link href="/public">公開資料</Link>
          <Link href="/contact">聯絡我們</Link>
        </nav>
        <nav className="public-footer-links" aria-label="法律與無障礙資訊">
          <Link href="/legal/accessibility">無障礙聲明</Link>
          <Link href="/legal/privacy">隱私政策</Link>
          <Link href="/system-info">關於本系統</Link>
        </nav>
      </div>
      <div className="public-footer-bottom">
        <span>{BRANDING.orgName} · 數位整合系統</span>
      </div>
    </footer>
  );
}
