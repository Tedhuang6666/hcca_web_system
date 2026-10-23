"use client";

import { ArrowUpRight, Eye, Globe2, RefreshCw } from "lucide-react";

export default function PublicSiteWorkspaceHeader({ loading, onRefresh }: {
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
      <header className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-sm">
        <div className="grid gap-8 px-6 py-7 lg:grid-cols-[1fr_auto] lg:items-center lg:px-8">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.16em] text-[var(--primary-text)]">
              <Globe2 size={15} aria-hidden />
              PUBLIC SITE CONTROL
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">
              公開網站工作台
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
              管理首頁內容、公開頁面、常用連結與幹部資料。發布前可先開啟官網確認實際呈現。
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="btn btn-ghost min-h-11 flex-1 justify-center px-4 text-sm sm:flex-none"
            >
              <RefreshCw size={16} aria-hidden /> 同步資料
            </button>
            <a
              href="/"
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary min-h-11 flex-1 justify-center px-4 text-sm font-semibold sm:flex-none"
            >
              <Eye size={16} aria-hidden /> 預覽官網
              <ArrowUpRight size={15} aria-hidden />
            </a>
          </div>
        </div>
      </header>
  );
}
