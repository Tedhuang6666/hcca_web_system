"use client";

import Link from "next/link";
import { ArrowRight, Database, ExternalLink, Landmark, Megaphone, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";

import PublicSiteShell from "@/components/site/PublicSiteShell";
import MarkdownBlock from "@/components/site/MarkdownBlock";
import { siteApi } from "@/lib/api";
import { sanitizeCustomCss } from "@/lib/sanitize";
import type { PublicSiteBundleOut } from "@/lib/types";

export default function PublicHomePage() {
  const [data, setData] = useState<PublicSiteBundleOut | null>(null);

  useEffect(() => {
    siteApi.public().then(setData).catch(() => setData(null));
  }, []);

  const settings = data?.settings;
  const links = data?.links.slice(0, 4) ?? [];
  const officers = data?.featured_officers ?? [];
  const emblemAlt = settings?.site_logo_alt || `${settings?.site_title ?? "班聯會"}會徽`;

  return (
    <PublicSiteShell navPages={data?.nav_pages ?? []} settings={settings}>
      {settings?.custom_css && (
        <style dangerouslySetInnerHTML={{ __html: sanitizeCustomCss(settings.custom_css) }} />
      )}
      <section className="public-hero">
        <div className="public-hero-inner">
          <div className="public-hero-copy">
            <p className="public-eyebrow">學生自治公開網站</p>
            <h1>{settings?.hero_title ?? settings?.site_title ?? "新竹高中班聯會"}</h1>
            <p className="public-hero-subtitle">
              {settings?.hero_subtitle ?? "連結學生、整理公共資訊，讓校園自治被更多人看見。"}
            </p>
            <div className="public-hero-actions">
              <Link href={settings?.cta_href ?? "/links"} className="public-cta-primary">
                {settings?.cta_label ?? "查看平台連結"}
                <ArrowRight size={16} aria-hidden />
              </Link>
              <Link href="/news" className="public-cta-secondary">
                最新公告
              </Link>
            </div>
          </div>
          <div className="public-signboard" aria-label="班聯會招牌">
            <div className="public-signboard-topline" />
            <div className="public-signboard-emblem">
              {settings?.site_logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={settings.site_logo_url} alt={emblemAlt} />
              ) : (
                <span>竹中<br />班聯</span>
              )}
            </div>
            <div className="public-signboard-copy">
              <p>{settings?.site_title ?? "新竹高中班聯會"}</p>
              <span>Campus Self-Governance</span>
            </div>
          </div>
        </div>
      </section>

      <section className="public-quick-grid" aria-label="公開網站主要入口">
        {[
          { href: "/news", title: "最新公告", desc: "查看班聯會發布的公開消息。", icon: Megaphone },
          { href: "/officers", title: "幹部名單", desc: "認識目前任期的公開幹部。", icon: UsersRound },
          {
            href: "/public",
            title: "公開資料庫",
            desc: settings?.public_database_description ?? "查詢公開法規、公文與治理資料。",
            icon: Database,
          },
          { href: "/about", title: "關於班聯會", desc: "理解本會任務、沿革與公共角色。", icon: Landmark },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="public-feature-card">
              <span className="public-feature-icon"><Icon size={21} aria-hidden /></span>
              <span>
                <span className="block text-base font-semibold">{item.title}</span>
                <span className="mt-1 block text-sm leading-6 text-[var(--public-secondary)]">
                  {item.desc}
                </span>
              </span>
            </Link>
          );
        })}
      </section>

      <section className="public-editorial">
        <div className="public-panel public-about-panel">
          <p className="public-section-kicker">About</p>
          <h2>
            {settings?.about_title ?? "關於班聯會"}
          </h2>
          <MarkdownBlock markdown={settings?.about_body_md} />
        </div>
        <aside className="public-side-stack">
          {officers.length > 0 && (
            <div className="public-panel public-side-panel">
              <div className="flex items-center justify-between gap-3">
                <h2>精選幹部</h2>
                <Link href="/officers" className="public-text-link">全部</Link>
              </div>
              <div className="public-mini-list">
                {officers.map((officer) => (
                  <div key={officer.profile_id} className="public-mini-item">
                    <p className="font-medium">{officer.display_name}</p>
                    <p className="text-sm text-[var(--public-muted)]">
                      {officer.title} · {officer.org_name}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {links.length > 0 && (
            <div className="public-panel public-side-panel">
              <div className="flex items-center justify-between gap-3">
                <h2>常用連結</h2>
                <Link href="/links" className="public-text-link">更多</Link>
              </div>
              <div className="public-link-list">
                {links.map((link) => (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="public-link-row">
                    <span>{link.title}</span>
                    <ExternalLink size={14} aria-hidden />
                  </a>
                ))}
              </div>
            </div>
          )}
        </aside>
      </section>
    </PublicSiteShell>
  );
}
