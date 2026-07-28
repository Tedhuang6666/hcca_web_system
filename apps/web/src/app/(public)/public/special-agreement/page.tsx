import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, FileText, Handshake, MessageSquareText } from "lucide-react";

import MarkdownBlock from "@/components/site/MarkdownBlock";
import PublicFileEmbed, { type PublicFileEmbedItem } from "@/components/site/PublicFileEmbed";

export const metadata: Metadata = {
  title: "特約洽談",
  description: "了解學生自治特約合作的洽談流程、合作資訊與參考文件。",
};

const PROCESS_STEPS = [
  { number: "01", title: "提出合作構想", description: "先說明合作對象、希望提供的內容，以及對學生的幫助。" },
  { number: "02", title: "初步洽談", description: "雙方確認需求、合作範圍、期間與聯絡窗口。" },
  { number: "03", title: "確認合作內容", description: "整理優惠或服務細節，確認公開文字與執行方式。" },
  { number: "04", title: "發布特約資訊", description: "完成確認後，將合作內容放上公開平台，方便學生查詢。" },
];

const INFORMATION_SECTIONS = [
  {
    title: "適合洽談的合作",
    markdown: `可依合作對象與學生需求討論不同形式，例如：

- 學生消費優惠或服務方案
- 校園活動、講座與公共議題合作
- 提供學生自治組織使用的場地、資源或專業支持
- 其他有助於校園公共參與與學生生活的合作內容`,
  },
  {
    title: "洽談前請準備",
    markdown: `為了讓第一次聯絡就能聚焦，建議先整理以下資訊：

- 合作單位與聯絡窗口
- 希望合作的對象、期間與適用範圍
- 優惠或服務的具體內容、使用限制與兌換方式
- 希望班聯會協助的事項，以及可提供的宣傳素材`,
  },
  {
    title: "公開與執行原則",
    markdown: `特約資訊會以學生容易理解、可以實際使用為原則整理。正式發布前，雙方會再次確認：

1. 文字是否與實際方案一致
2. 期限、適用對象與使用條件是否清楚
3. 聯絡方式與後續異動由誰負責更新

> 若方案內容、期限或使用方式有變動，請儘早通知班聯會，以便同步更新公開資訊。`,
  },
];

const FILES: PublicFileEmbedItem[] = [
  {
    title: "特約洽談資訊摘要",
    description: "將合作流程、準備事項與公開原則整理成可直接閱讀的文件。",
    url: "/special-agreement/partner-information.html",
    mimeType: "text/html",
  },
];

export default function SpecialAgreementPage() {
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
            <p className="mt-4 max-w-2xl text-sm leading-7 text-[#d5e0e6] sm:text-base sm:leading-8">
              如果你想和學生自治組織一起提供更好的校園服務，這裡整理了從提出構想到公開合作資訊的完整路徑。
            </p>
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
        <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {PROCESS_STEPS.map((step) => (
            <li key={step.number} className="rounded-xl border border-[var(--public-border)] bg-[var(--public-surface)] p-5">
              <span className="text-xs font-semibold tracking-[0.14em] text-[var(--public-accent)]">{step.number}</span>
              <h3 className="mt-5 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-[var(--public-secondary)]">{step.description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="special-agreement-information" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div className="rounded-2xl border border-[var(--public-border)] bg-[var(--public-surface)] p-6 sm:p-8">
          <p className="public-section-kicker">Information</p>
          <h2 id="special-agreement-information" className="mt-2 text-2xl font-semibold">
            特約資訊
          </h2>
          <div className="mt-6 divide-y divide-[var(--public-border)]">
            {INFORMATION_SECTIONS.map((section) => (
              <section key={section.title} className="py-6 first:pt-0 last:pb-0">
                <h3 className="text-lg font-semibold">{section.title}</h3>
                <div className="mt-3 text-sm leading-7 text-[var(--public-secondary)]">
                  <MarkdownBlock markdown={section.markdown} />
                </div>
              </section>
            ))}
          </div>
        </div>
        <aside className="rounded-2xl border border-[var(--public-border)] bg-[var(--public-soft)] p-5 sm:p-6">
          <MessageSquareText size={22} className="text-[var(--public-accent)]" aria-hidden />
          <h2 className="mt-4 text-lg font-semibold">準備開始洽談？</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--public-secondary)]">
            先整理合作想法與可提供的方案，再從公開聯絡方式找到班聯會窗口。
          </p>
          <Link
            href="/about"
            className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--public-accent)] px-4 text-sm font-semibold text-[var(--primary-fg)] transition-colors hover:bg-[var(--public-accent-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--public-focus)]"
          >
            查看聯絡方式
            <ArrowRight size={16} aria-hidden />
          </Link>
        </aside>
      </section>

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
