import Link from "next/link";
import { Mail, UserRound } from "lucide-react";

export const metadata = {
  title: "關於本系統 · HCCA",
  description: "班聯會法律與公文系統開發者與聯絡資訊",
};

const facts = [
  {
    label: "開發者",
    value: "新竹高中第 40 屆班聯會主席 黃丞廷",
    icon: UserRound,
  },
  {
    label: "聯絡電子郵件",
    value: "support.hcca@hct.works",
    href: "mailto:support.hcca@hct.works",
    icon: Mail,
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-10 lg:py-14">
      <header className="space-y-3">
        <p className="text-sm font-medium" style={{ color: "var(--primary)" }}>
          About
        </p>
        <h1 className="text-2xl font-semibold md:text-3xl">關於本系統</h1>
        <p className="max-w-3xl text-sm leading-7" style={{ color: "var(--text-secondary)" }}>
          本法律與公文系統致力於電子化班聯會的法律文件以及公文流通，提供一個統一、
          公開的查詢平台供班聯會全體會員以及各界檢視，讓班聯會的行政以及班代大會的
          議事更加透明化。
        </p>
      </header>

      <section
        className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
        aria-label="系統資訊">
        {facts.map((item) => {
          const Icon = item.icon;
          const content = (
            <>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                style={{
                  background: "var(--primary-dim)",
                  color: "var(--primary)",
                  border: "1px solid var(--warning-border)",
                }}>
                <Icon size={16} aria-hidden={true} />
              </span>
              <span className="min-w-0">
                <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                  {item.label}
                </span>
                <span className="mt-0.5 flex items-center gap-1 text-sm font-medium"
                  style={{ color: "var(--text-primary)" }}>
                  {item.value}
                </span>
              </span>
            </>
          );

          if (item.href) {
            return (
              <Link
                key={item.label}
                href={item.href}
                className="flex min-w-0 items-center gap-3 rounded-lg p-3 transition-colors"
                style={{ textDecoration: "none" }}>
                {content}
              </Link>
            );
          }

          return (
            <div key={item.label} className="flex min-w-0 items-center gap-3 rounded-lg p-3">
              {content}
            </div>
          );
        })}
      </section>

      <section className="prose">
        <h2>開發狀態與回饋</h2>
        <p>
          此系統由第 40 屆班聯會主席 黃丞廷開發，目前仍在開發階段，尚有許多不足之處，
          望各界不吝提供意見與建議，以利系統改進。
        </p>
        <p>
          使用本系統檢視、編輯、發布本校班聯會公文與法律者，須同意
          <Link href="/legal/terms">使用者條款</Link>。隱私、Cookie、無障礙與安全揭露等
          文件可於<Link href="/legal/privacy">法律專區</Link>查閱。
        </p>
      </section>
    </div>
  );
}
