"use client";

import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  Database,
  ExternalLink,
  Landmark,
  Megaphone,
  Radio,
  UsersRound,
} from "lucide-react";

import MarkdownBlock from "@/components/site/MarkdownBlock";
import { liveLeader, useLiveElection } from "@/components/site/useLiveElection";
import { useScrollReveal } from "@/hooks/useScrollReveal";
import { BRANDING } from "@/lib/branding";
import { sanitizeCustomCss } from "@/lib/sanitize";
import type { AnnouncementListItem, AnnouncementOut, PublicSiteBundleOut } from "@/lib/types";

export default function HomeContent({
  bundle,
  announcements,
  urgentAnnouncement,
}: {
  bundle: PublicSiteBundleOut | null;
  announcements: AnnouncementListItem[];
  urgentAnnouncement: AnnouncementOut | null;
}) {
  const activeElection = useLiveElection();
  useScrollReveal([activeElection]);

  const settings = bundle?.settings;
  const links = bundle?.links.slice(0, 4) ?? [];
  const officers = bundle?.featured_officers ?? [];
  const liveSummary = activeElection?.summary ?? null;
  const liveLeading = liveLeader(liveSummary);
  const latestAnnouncements = announcements
    .filter((item) => item.id !== urgentAnnouncement?.id)
    .slice(0, 2);
  const recentlyUpdatedPages = [...(bundle?.nav_pages ?? [])]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 2);
  const siteTitle = settings?.site_title?.trim() || "新竹高中班聯會";
  const heroTitle = settings?.hero_title?.trim() || siteTitle;
  const heroSubtitle = settings?.hero_subtitle?.trim()
    || (!settings ? "公開資料暫時無法取得；您仍可瀏覽最新公告與班聯會公開服務。" : "");
  const ctaHref = settings?.cta_href?.trim() || "/links";
  const ctaLabel = settings?.cta_label?.trim() || "查看連結";
  const publicDatabaseDescription = settings?.public_database_description?.trim();
  const aboutTitle = settings?.about_title?.trim();
  const publicEmblemUrl = settings?.site_logo_url?.trim() || BRANDING.publicEmblemUrl;
  const emblemAlt = settings?.site_logo_alt?.trim() || (siteTitle ? `${siteTitle}會徽` : "網站會徽");
  const hasEditorialContent = Boolean(
    aboutTitle || settings?.about_body_md?.trim() || officers.length > 0 || links.length > 0,
  );
  const hasEditorialSideContent = officers.length > 0 || links.length > 0;

  return (
    <>
      {settings?.custom_css && (
        <style dangerouslySetInnerHTML={{ __html: sanitizeCustomCss(settings.custom_css) }} />
      )}
      <section className="public-hero">
        <div className="public-hero-inner">
          <div className="public-hero-copy">
            <h1>{heroTitle}</h1>
            {heroSubtitle && <p className="public-hero-subtitle">{heroSubtitle}</p>}
            <div className="public-hero-actions">
              <Link href={ctaHref} className="public-cta-primary">
                {ctaLabel}
                <ArrowRight size={16} aria-hidden />
              </Link>
              <Link href="/news" className="public-cta-secondary">
                最新公告
              </Link>
            </div>
          </div>
          <div className="public-signboard public-identity-panel" aria-label={`${siteTitle}識別標誌`}>
            <div className="public-signboard-emblem">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={publicEmblemUrl} alt={emblemAlt} />
            </div>
          </div>
        </div>
      </section>

      {(activeElection || latestAnnouncements.length > 0 || recentlyUpdatedPages.length > 0) && (
        <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6" aria-labelledby="public-now-title" data-reveal>
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <h2 id="public-now-title" className="text-2xl font-semibold sm:text-3xl">
                最新動態
              </h2>
            </div>
            <Link href="/news" className="public-text-link">查看全部公告</Link>
          </div>

          <div className={`grid gap-4 ${activeElection ? "lg:grid-cols-[1.15fr_0.85fr]" : ""}`}>
            {activeElection && (
              <Link
                href={`/live/elections/${encodeURIComponent(activeElection.summary?.slug ?? activeElection.id)}`}
                className="group overflow-hidden rounded-2xl bg-[#173654] p-6 text-[#f8f3e5] shadow-lg shadow-slate-950/10 transition-colors hover:bg-[#1d4265] sm:p-8"
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="inline-flex min-h-9 items-center gap-2 rounded-full bg-emerald-400/10 px-3 text-xs font-semibold text-emerald-300">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" aria-hidden />
                    {activeElection.status === "live" ? "即時開票中" : "開票暫停"}
                  </span>
                  <Radio size={22} className="text-[#e8c970]" aria-hidden />
                </div>
                <h3 className="mt-8 font-serif text-2xl font-semibold leading-snug sm:text-3xl" style={{ color: "#f8f3e5" }}>
                  {activeElection.title}
                </h3>
                {liveSummary ? (
                  <>
                    <div className="mt-5 flex flex-wrap gap-2">
                      {typeof liveSummary.progress_percentage === "number" && (
                        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">
                          開票進度 {Math.round(liveSummary.progress_percentage)}%
                        </span>
                      )}
                      {liveLeading && (
                        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">
                          領先 {liveLeading.name} {Math.round(liveLeading.percentage)}%
                        </span>
                      )}
                      <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">
                        已開 {liveSummary.total_votes.toLocaleString("zh-TW")} 票
                      </span>
                    </div>
                    <div className="mt-4 space-y-2.5">
                      {liveSummary.candidates.slice(0, 3).map((candidate) => (
                        <div key={candidate.candidate_id}>
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium">{candidate.number}. {candidate.name}</span>
                            <span className="text-[#cdd8e0]">
                              {candidate.votes.toLocaleString("zh-TW")} 票 · {Math.round(candidate.percentage)}%
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full transition-[width] duration-500"
                              style={{ width: `${Math.min(100, candidate.percentage)}%`, background: candidate.color }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="mt-3 max-w-xl text-sm leading-7 text-[#cdd8e0]">
                    查看候選人得票、整體開票率與各票匭進度，頁面會自動同步現場紀錄。
                  </p>
                )}
                <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#e8c970]">
                  前往即時開票看完整票數
                  <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" aria-hidden />
                </span>
              </Link>
            )}

            <div className="rounded-2xl border border-[var(--public-border)] bg-[var(--public-surface)] p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <BellRing size={18} className="text-[var(--public-accent)]" aria-hidden />
                <h3 className="font-semibold">最新消息</h3>
              </div>
              <div className="mt-4 divide-y divide-[var(--public-border)]">
                {latestAnnouncements.map((item) => (
                  <Link
                    key={item.id}
                    href={`/news/${item.id}`}
                    className="group flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold group-hover:text-[var(--public-accent)]">
                        {item.title}
                      </span>
                      <time className="mt-1 block text-xs text-[var(--public-muted)]">
                        {new Date(item.published_at ?? item.created_at).toLocaleDateString("zh-TW")}
                      </time>
                    </span>
                    <ArrowRight size={15} className="mt-1 shrink-0 text-[var(--public-muted)]" aria-hidden />
                  </Link>
                ))}
                {recentlyUpdatedPages.map((page) => (
                  <Link
                    key={page.id}
                    href={`/pages/${page.slug}`}
                    className="group flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold group-hover:text-[var(--public-accent)]">
                        {page.title}
                      </span>
                      <span className="mt-1 block text-xs text-[var(--public-muted)]">
                        {new Date(page.updated_at).toLocaleDateString("zh-TW")} 更新
                      </span>
                    </span>
                    <ArrowRight size={15} className="mt-1 shrink-0 text-[var(--public-muted)]" aria-hidden />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="public-home-entry-section" aria-labelledby="public-entry-title">
        <div className="public-home-entry-heading">
          <div>
            <p className="public-home-section-label">快速進入</p>
            <h2 id="public-entry-title">從這裡開始了解班聯會</h2>
          </div>
          <p>公開消息、組織資訊與治理資料，集中在幾個清楚的入口。</p>
        </div>
        <nav className="public-quick-grid public-home-quick-grid" aria-label="公開網站主要入口">
          {[
            { href: "/news", title: "最新公告", desc: "班聯會公開消息", icon: Megaphone },
            { href: "/officers", title: "幹部名單", desc: "本屆幹部與職務", icon: UsersRound },
            {
              href: "/public",
              title: "公開資料庫",
              desc: publicDatabaseDescription || "法規、公文與治理資料",
              icon: Database,
            },
            { href: "/about", title: "關於班聯會", desc: "任務、組織與沿革", icon: Landmark },
          ].map((item, index) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="public-feature-card public-home-feature-card"
              >
                <span className="public-home-feature-index">0{index + 1}</span>
                <span className="public-feature-icon"><Icon size={20} aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold">{item.title}</span>
                  <span className="mt-0.5 block text-sm text-[var(--public-secondary)]">
                    {item.desc}
                  </span>
                </span>
                <ArrowRight className="public-feature-arrow" size={17} aria-hidden />
              </Link>
            );
          })}
        </nav>
      </section>

      {hasEditorialContent && (
        <section
          className={`public-editorial public-home-editorial ${
            hasEditorialSideContent ? "public-home-editorial-with-side" : "public-home-editorial-solo"
          }`}
        >
          {(aboutTitle || settings?.about_body_md?.trim()) && (
            <div className="public-panel public-about-panel public-home-about-panel" data-reveal>
              <div className="public-home-about-intro">
                <p className="public-home-section-label">認識我們</p>
                {aboutTitle && <h2>{aboutTitle}</h2>}
                <p className="public-home-about-note">讓學生的聲音成為校園裡可以被看見、被追蹤的公共紀錄。</p>
              </div>
              <div className="public-home-about-copy">
                <MarkdownBlock markdown={settings?.about_body_md ?? ""} />
                <Link href="/about" className="public-home-about-link">
                  了解班聯會的任務與沿革
                  <ArrowRight size={16} aria-hidden />
                </Link>
              </div>
            </div>
          )}
          {(officers.length > 0 || links.length > 0) && <aside className="public-side-stack">
          {officers.length > 0 && (
            <div className="public-panel public-side-panel" data-reveal style={{ "--reveal-delay": "90ms" } as React.CSSProperties}>
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
            <div className="public-panel public-side-panel" data-reveal style={{ "--reveal-delay": "160ms" } as React.CSSProperties}>
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
          </aside>}
        </section>
      )}
    </>
  );
}
