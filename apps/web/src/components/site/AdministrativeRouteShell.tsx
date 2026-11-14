import Link from "next/link";
import type { ReactNode } from "react";
import PublicEmblem from "./PublicEmblem";
import AdministrativeNavigation from "./AdministrativeNavigation";
import { BRANDING } from "@/lib/branding";
import { fetchPublicShellData } from "@/lib/serverFetch";
import "./administrative.css";

/* Direction: Operate for indexes, Read for documents. Keep HCCA ink/gold and fonts.
   First viewport: institutional masthead, labeled retrieval form, ruled results.
   Reader: independent TOC + continuous laws; actual document fields on A4 paper.
   Finish: desktop/mobile captures, independent review, recorded surface rules. */
export default async function AdministrativeRouteShell({ children }: { children: ReactNode }) {
  const { bundle } = await fetchPublicShellData();
  const settings = bundle?.settings;
  return (
    <div className="public-site administrative-site">
      <a href="#main-content" className="administrative-skip">跳到主要內容</a>
      <header className="administrative-masthead">
        <div className="administrative-masthead-inner">
          <Link href="/" className="administrative-brand">
            <PublicEmblem src={settings?.site_logo_url?.trim() || BRANDING.publicEmblemUrl}
              alt={settings?.site_logo_alt || BRANDING.emblemAlt} variant="small" sizes="40px" />
            <span>{BRANDING.orgShortName}<small>法規與公文資訊系統</small></span>
          </Link>
          <AdministrativeNavigation />
        </div>
      </header>
      <main id="main-content" className="administrative-main">{children}</main>
      <footer className="administrative-footer">
        <span>{BRANDING.orgName}</span>
        <nav aria-label="網站資訊">
          <Link href="/legal/accessibility">無障礙聲明</Link>
          <Link href="/legal/privacy">隱私政策</Link>
        </nav>
      </footer>
    </div>
  );
}
