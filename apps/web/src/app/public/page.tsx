"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  FileSearch,
  Megaphone,
  MessageSquareText,
  Radio,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useModuleStatus } from "@/contexts/ModuleStatusContext";
import type { ModuleId } from "@/lib/modules";

const DATABASES = [
  {
    href: "/regulations",
    title: "法規資料庫",
    description: "查詢現行法規、條文沿革與版本差異，取得可穩定引用的公開連結。",
    icon: BookOpenText,
    meta: "條文、沿革、版本比對",
  },
  {
    href: "/documents",
    title: "公文資料庫",
    description: "依字號、標題與主旨查找公開公文，查看附件與文件基本資訊。",
    icon: FileSearch,
    meta: "字號、主旨、公開附件",
  },
];

const SERVICES: Array<{
  href: string;
  title: string;
  description: string;
  icon: typeof Radio;
  moduleId: ModuleId;
}> = [
  {
    href: "/public/elections",
    title: "即時開票",
    description: "查看公開選舉的即時票數、開票率與票匭進度。",
    icon: Radio,
    moduleId: "elections",
  },
  {
    href: "/news",
    title: "最新公告",
    description: "掌握班聯會最新消息與公開說明。",
    icon: Megaphone,
    moduleId: "announcements",
  },
  {
    href: "/petitions/new",
    title: "提出陳情",
    description: "向自治組織反映問題並留下正式紀錄。",
    icon: MessageSquareText,
    moduleId: "petitions",
  },
];

export default function PublicHomePage() {
  const { isModuleClosed } = useModuleStatus();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const visibleServices = SERVICES.filter(
    (item) => !mounted || !isModuleClosed(item.moduleId),
  );

  return (
    <div className="space-y-10 pb-8">
      <section className="overflow-hidden rounded-2xl border border-[var(--public-border)] bg-[var(--public-surface)]">
        <div className="grid gap-8 px-6 py-9 sm:px-9 sm:py-11 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)] lg:items-center">
          <div>
            <p className="public-section-kicker">Open Government</p>
            <h1 className="mt-3 max-w-[13em] text-balance font-serif text-3xl font-semibold leading-[1.35] tracking-[-0.03em] sm:text-4xl xl:text-[2.75rem]">
              公開資訊，不該藏在登入頁後面
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-[var(--public-secondary)] sm:text-base sm:leading-8">
              這裡集中提供法規、公文與自治參與服務。查詢公開資料不需要帳號，
              需要權限的自治作業與內部操作則需要登入。
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--public-border)] bg-[var(--public-soft)] p-3 sm:p-4">
            <p className="px-2 pb-2 text-xs font-semibold tracking-[0.1em] text-[var(--public-muted)]">
              無需登入即可使用
            </p>
            <div className="divide-y divide-[var(--public-border)]">
              {[
                ["01", "公開資料", "查詢法規、公文與附件"],
                ["02", "自治資訊", "閱讀公開公告"],
                ["03", "公共參與", "提出陳情或查詢進度"],
              ].map(([number, title, description]) => (
                <div key={number} className="grid grid-cols-[2rem_1fr] gap-3 px-2 py-3.5">
                  <span className="text-xs font-semibold text-[var(--public-accent)]">{number}</span>
                  <span>
                    <span className="block text-sm font-semibold">{title}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-[var(--public-secondary)]">
                      {description}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-4">
          <p className="public-section-kicker">Public Records</p>
          <h2 className="mt-2 text-2xl font-semibold">公開資料庫</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {DATABASES.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="group rounded-2xl border border-[var(--public-border)] bg-[var(--public-surface)] p-6 transition-colors hover:border-[var(--public-accent)] hover:bg-[var(--public-soft)]"
              >
                <div className="flex items-start justify-between gap-5">
                  <span className="grid h-12 w-12 place-items-center rounded-xl bg-[var(--public-accent-soft)] text-[var(--public-accent)]">
                    <Icon size={24} aria-hidden />
                  </span>
                  <ArrowRight
                    size={20}
                    className="text-[var(--public-muted)] transition-colors group-hover:text-[var(--public-accent)]"
                    aria-hidden
                  />
                </div>
                <h3 className="mt-7 text-xl font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-7 text-[var(--public-secondary)]">
                  {item.description}
                </p>
                <p className="mt-5 text-xs font-semibold tracking-wide text-[var(--public-muted)]">
                  {item.meta}
                </p>
              </Link>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-4">
          <p className="public-section-kicker">Participation</p>
          <h2 className="mt-2 text-2xl font-semibold">公開參與服務</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {visibleServices.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex min-h-32 items-start gap-4 rounded-xl border border-[var(--public-border)] bg-[var(--public-surface)] p-5 transition-colors hover:bg-[var(--public-soft)]"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--public-soft)] text-[var(--public-accent)]">
                  <Icon size={20} aria-hidden />
                </span>
                <span>
                  <span className="block font-semibold">{item.title}</span>
                  <span className="mt-1.5 block text-sm leading-6 text-[var(--public-secondary)]">
                    {item.description}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl bg-[#173654] px-6 py-7 text-[#f8f3e5] sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div>
          <h2 className="text-lg font-semibold">需要處理內部業務？</h2>
          <p className="mt-1 text-sm leading-6 text-[#cdd8e0]">
            文件建立、簽核、內容發布與系統管理會在登入後依權限開放。
          </p>
        </div>
        <Link
          href="/login?next=%2Fdashboard"
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#e8c970] px-4 text-sm font-semibold text-[#173654] transition-colors hover:bg-[#f2dc95]"
        >
          登入管理系統
          <ArrowRight size={16} aria-hidden />
        </Link>
      </section>
    </div>
  );
}
