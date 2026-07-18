"use client";

import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  Database,
  ExternalLink,
  FileClock,
  Landmark,
  Megaphone,
  Radio,
  UsersRound,
} from "lucide-react";

import BrandEmblem from "@/components/brand/BrandEmblem";
import MarkdownBlock from "@/components/site/MarkdownBlock";
import { liveLeader, useLiveElection } from "@/components/site/useLiveElection";
import { useScrollReveal } from "@/hooks/useScrollReveal";
import { sanitizeCustomCss } from "@/lib/sanitize";
import type { AnnouncementListItem, PublicSiteBundleOut } from "@/lib/types";

export default function HomeContent({
  bundle,
  announcements,
}: {
  bundle: PublicSiteBundleOut | null;
  announcements: AnnouncementListItem[];
}) {
  const activeElection = useLiveElection();
  useScrollReveal([activeElection]);

  const settings = bundle?.settings;
  const links = bundle?.links.slice(0, 4) ?? [];
  const officers = bundle?.featured_officers ?? [];
  const liveSummary = activeElection?.summary ?? null;
  const liveLeading = liveLeader(liveSummary);
  const latestAnnouncements = announcements.slice(0, 2);
  const recentlyUpdatedPages = [...(bundle?.nav_pages ?? [])]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 2);
  const siteTitle = settings?.site_title?.trim() ?? "";
  const heroTitle = settings?.hero_title?.trim() || siteTitle;
  const heroSubtitle = settings?.hero_subtitle?.trim() ?? "";
  const ctaHref = settings?.cta_href?.trim() || "/links";
  const ctaLabel = settings?.cta_label?.trim() || "查看連結";
  const publicDatabaseDescription = settings?.public_database_description?.trim();
  const aboutTitle = settings?.about_title?.trim();
  const emblemAlt = settings?.site_logo_alt?.trim() || (siteTitle ? `${siteTitle}會徽` : "網站會徽");

  return (
    <>
      {settings?.custom_css && (
        <style dangerouslySetInnerHTML={{ __html: sanitizeCustomCss(settings.custom_css) }} />
      )}
      <section className="public-hero">
        <div className="public-hero-inner">
          <div className="public-hero-copy">
            <p className="public-eyebrow">學生自治公開網站</p>
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
          <div className="public-signboard" aria-label="班聯會招牌">
            <div className="public-signboard-topline" />
            <div className="public-signboard-emblem">
              {settings?.site_logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={settings.site_logo_url} alt={emblemAlt} />
              ) : (
                <BrandEmblem className="h-full w-full" size={256} priority />
              )}
            </div>
            <div className="public-signboard-copy">
              <p>{siteTitle}</p>
              <span>Campus Self-Governance</span>
            </div>
          </div>
        </div>
      </section>

      {(activeElection || latestAnnouncements.length > 0 || recentlyUpdatedPages.length > 0) && (
        <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6" aria-labelledby="public-now-title" data-reveal>
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <p className="public-section-kicker">Now & New</p>
              <h2 id="public-now-title" className="mt-2 text-2xl font-semibold sm:text-3xl">
                現在發生中
              </h2>
            </div>
            <Link href="/news" className="public-text-link">查看全部公告</Link>
          </div>

          <div className={`grid gap-4 ${activeElection ? "lg:grid-cols-[1.15fr_0.85fr]" : ""}`}>
            {activeElection && (
              <Link
                href={`/live/elections/${encodeURIComponent(activeElection.summary?.slug ?? activeElection.id)}`}
                className="group overflow-hidden rounded-2xl bg-[#26193d] p-6 text-[#f7f4fa] shadow-lg shadow-slate-950/10 transition-colors hover:bg-[#35244d] sm:p-8"
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="inline-flex min-h-9 items-center gap-2 rounded-full bg-emerald-400/10 px-3 text-xs font-semibold text-emerald-300">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" aria-hidden />
                    {activeElection.status === "live" ? "即時開票中" : "開票暫停"}
                  </span>
                  <Radio size={22} className="text-[#c79f3f]" aria-hidden />
                </div>
                <h3 className="mt-8 font-serif text-2xl font-semibold leading-snug sm:text-3xl" style={{ color: "#f7f4fa" }}>
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
                            <span className="text-[#d4cfda]">
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
                  <p className="mt-3 max-w-xl text-sm leading-7 text-[#d4cfda]">
                    查看候選人得票、整體開票率與各票匭進度，頁面會自動同步現場紀錄。
                  </p>
                )}
                <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#c79f3f]">
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
                    className="group flex items-start gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <FileClock size={17} className="mt-0.5 shrink-0 text-[var(--public-accent)]" aria-hidden />
                    <span>
                      <span className="block text-sm font-semibold group-hover:text-[var(--public-accent)]">
                        {page.title}
                      </span>
                      <span className="mt-1 block text-xs text-[var(--public-muted)]">
                        公開頁面最近更新
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="public-quick-grid" aria-label="公開網站主要入口">
        {[
          { href: "/news", title: "最新公告", desc: "查看班聯會發布的公開消息。", icon: Megaphone },
          { href: "/officers", title: "幹部名單", desc: "認識目前任期的公開幹部。", icon: UsersRound },
          {
            href: "/public",
            title: "公開資料庫",
            desc: publicDatabaseDescription || "公開法規、公文與治理資料。",
            icon: Database,
          },
          { href: "/about", title: "關於班聯會", desc: "理解本會任務、沿革與公共角色。", icon: Landmark },
        ].map((item, i) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="public-feature-card"
              data-reveal
              style={{ "--reveal-delay": `${i * 80}ms` } as React.CSSProperties}
            >
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
        <div className="public-panel public-about-panel" data-reveal>
          <p className="public-section-kicker">About</p>
          {aboutTitle && <h2>{aboutTitle}</h2>}
          <MarkdownBlock markdown={settings?.about_body_md ?? ""} />
        </div>
        <aside className="public-side-stack">
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
        </aside>
      </section>
    </>
  );
}
