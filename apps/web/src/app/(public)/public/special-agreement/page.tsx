import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, FileText, Handshake, MessageSquareText } from "lucide-react";

import MarkdownBlock from "@/components/site/MarkdownBlock";
import PublicFileEmbed, { type PublicFileEmbedItem } from "@/components/site/PublicFileEmbed";
import { fetchPublicBundle } from "@/lib/serverFetch";
import { readSpecialAgreementContent } from "@/lib/specialAgreement";
import MerchantApplicationForm from "./MerchantApplicationForm";

export const metadata: Metadata = {
  title: "特約洽談",
  description: "了解學生自治特約合作的洽談流程、合作資訊與參考文件。",
};

const FILES: PublicFileEmbedItem[] = [
  {
    title: "特約洽談資訊摘要",
    description: "將合作流程、準備事項與公開原則整理成可直接閱讀的文件。",
    url: "/special-agreement/partner-information.html",
    mimeType: "text/html",
  },
];

export default async function SpecialAgreementPage() {
  const bundle = await fetchPublicBundle();
  const content = readSpecialAgreementContent(bundle?.settings.homepage_blocks?.special_agreement);

  return (
    <div className="space-y-8 pb-8">
      <header className="overflow-hidden rounded-2xl bg-[#173654] px-6 py-9 text-[#f8f3e5] sm:px-9 sm:py-11">
        <div className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.16em] text-[#e8c970]">
              <Handshake size={15} aria-hidden />
              PUBLIC PARTNERSHIP
            </div>
            <h1 className="mt-3 font-serif text-3xl font-semibold leading-tight tracking-[-0.02em] sm:text-4xl">
              特約洽談
            </h1>
            <div className="mt-4 max-w-2xl text-sm leading-7 text-[#d5e0e6] sm:text-base sm:leading-8 [&_.prose_p]:my-0 [&_.prose]:text-inherit">
              <MarkdownBlock markdown={content.intro_md} />
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-[#e9eef1]">
            <CheckCircle2 size={18} className="shrink-0 text-[#e8c970]" aria-hidden />
            <span>免登入即可閱讀</span>
          </div>
        </div>
      </header>

      <section aria-labelledby="special-agreement-process">
        <div className="mb-4">
          <p className="public-section-kicker">How it works</p>
          <h2 id="special-agreement-process" className="mt-2 text-2xl font-semibold">
            特約流程
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--public-secondary)]">
            先從合作需求開始，逐步確認內容與責任，讓公開資訊在發布後仍然清楚、可使用。
          </p>
        </div>
        {content.process.length > 0 ? (
          <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {content.process.map((step, index) => (
            <li key={step.id} className="rounded-xl border border-[var(--public-border)] bg-[var(--public-surface)] p-5">
              <span className="text-xs font-semibold tracking-[0.14em] text-[var(--public-accent)]">{String(index + 1).padStart(2, "0")}</span>
              <h3 className="mt-5 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--public-secondary)]">{step.description}</p>
            </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-xl border border-dashed border-[var(--public-border)] bg-[var(--public-surface)] px-5 py-10 text-center text-sm text-[var(--public-secondary)]">
            特約流程尚在整理中，請稍後再回來查看。
          </p>
        )}
      </section>

      <section aria-labelledby="special-agreement-information" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div className="rounded-2xl border border-[var(--public-border)] bg-[var(--public-surface)] p-6 sm:p-8">
          <p className="public-section-kicker">Information</p>
          <h2 id="special-agreement-information" className="mt-2 text-2xl font-semibold">
            特約資訊
          </h2>
          <div className="mt-6 text-sm leading-7 text-[var(--public-secondary)]">
            <MarkdownBlock markdown={content.info_md} />
          </div>
        </div>
        <aside className="rounded-2xl border border-[var(--public-border)] bg-[var(--public-soft)] p-5 sm:p-6">
          <MessageSquareText size={22} className="text-[var(--public-accent)]" aria-hidden />
          <h2 className="mt-4 text-lg font-semibold">準備開始洽談？</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--public-secondary)]">
            先整理合作想法與可提供的方案，再從公開聯絡方式找到班聯會窗口。
          </p>
          <Link
            href="/contact"
            className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--public-accent)] px-4 text-sm font-semibold text-[var(--primary-fg)] transition-colors hover:bg-[var(--public-accent-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--public-focus)]"
          >
            查看聯絡方式
            <ArrowRight size={16} aria-hidden />
          </Link>
        </aside>
      </section>

      <MerchantApplicationForm />

      <section aria-labelledby="special-agreement-files">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="public-section-kicker">Reference files</p>
            <h2 id="special-agreement-files" className="mt-2 text-2xl font-semibold">
              參考文件
            </h2>
          </div>
          <p className="flex items-center gap-2 text-sm text-[var(--public-secondary)]">
            <FileText size={16} aria-hidden />
            可直接在頁面內預覽
          </p>
        </div>
        <div className="grid gap-4">
          {FILES.map((file) => <PublicFileEmbed key={file.url} file={file} />)}
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-[var(--public-border)] bg-[var(--public-surface)] px-6 py-7 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div>
          <h2 className="text-lg font-semibold">想先了解學生自治的公共角色？</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--public-secondary)]">
            從班聯會的任務與組織介紹開始，找到適合合作的方向。
          </p>
        </div>
        <Link
          href="/about"
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-[var(--public-border)] px-4 text-sm font-semibold text-[var(--public-accent)] transition-colors hover:border-[var(--public-accent)] hover:bg-[var(--public-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--public-focus)]"
        >
          關於班聯會
          <ArrowRight size={16} aria-hidden />
        </Link>
      </section>
    </div>
  );
}
