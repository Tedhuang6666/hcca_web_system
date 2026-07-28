import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import MarkdownBlock from "@/components/site/MarkdownBlock";

export default function PublicContactSection({
  markdown,
}: {
  markdown: string | null | undefined;
}) {
  return (
    <section id="contact" className="mt-20 scroll-mt-24 border-t pt-12" style={{ borderColor: "var(--border)" }}>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="public-section-kicker">Contact HCCA</p>
          <h2 className="mt-2 text-3xl font-bold">聯絡我們</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--text-secondary)]">
            有問題、建議或需要協助？從這裡找到班聯會的公開聯絡方式。
          </p>
        </div>
        <Link href="/contact" className="public-text-link inline-flex items-center gap-1.5">
          開啟聯絡專頁
          <ArrowUpRight size={15} aria-hidden />
        </Link>
      </div>
      <section className="card p-6" data-reveal>
        {markdown?.trim() ? (
          <MarkdownBlock markdown={markdown} />
        ) : (
          <p className="text-sm leading-7 text-[var(--text-secondary)]">聯絡方式尚未設定，請稍後再回來查看。</p>
        )}
      </section>
    </section>
  );
}
