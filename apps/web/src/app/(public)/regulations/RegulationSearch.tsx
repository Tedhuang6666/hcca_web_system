"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { regulationsApi, regulationHref } from "@/lib/api/regulations";
import { usePermissions } from "@/hooks/usePermissions";
import { administrativeDate, REGULATION_CATEGORIES, regulationPublicState } from "@/lib/administrative";
import type { RegulationCategory, RegulationListItem, RegulationSearchResult } from "@/lib/types";

const RegulationWorkspace = dynamic(() => import("./client"));
type Result = RegulationListItem | RegulationSearchResult;

export default function RegulationSearch({ initialRegs = [] }: { initialRegs?: Result[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const { canAny } = usePermissions();
  const [workspace, setWorkspace] = useState(false);
  const keyword = params.get("keyword") ?? "";
  const category = params.get("category") ?? "all";
  const archived = params.get("status") === "archived";
  const [input, setInput] = useState(keyword);
  const [results, setResults] = useState<Result[]>(initialRegs);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [sort, setSort] = useState("category");
  const canManage = canAny("regulation:create", "regulation:admin", "regulation:schedule",
    "regulation:council_approve", "regulation:president_publish");

  useEffect(() => { setInput(keyword); }, [keyword]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    const query: Record<string, string> = {
      active_only: archived ? "false" : "true",
      workflow_status: archived ? "archived" : "published",
    };
    if (category in REGULATION_CATEGORIES) query.category = category;
    const request = keyword.trim()
      ? regulationsApi.search(keyword.trim(), query)
      : regulationsApi.list(query);
    void request.then((data) => {
      if (!cancelled) setResults(data);
    }).catch(() => {
      if (!cancelled) setError(true);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [keyword, category, archived, retry]);

  const sorted = useMemo(() => [...results].sort((a, b) => {
    if (sort === "title") return a.title.localeCompare(b.title, "zh-TW");
    if (sort === "published") return (b.published_at ?? "").localeCompare(a.published_at ?? "");
    const rank = { constitution: 0, ordinance: 1, procedure: 2 };
    return rank[a.category] - rank[b.category] || a.title.localeCompare(b.title, "zh-TW");
  }), [results, sort]);

  function navigate(next: { keyword?: string; category?: string; archived?: boolean }) {
    const query = new URLSearchParams();
    const nextKeyword = next.keyword ?? keyword;
    const nextCategory = next.category ?? category;
    if (nextKeyword.trim()) query.set("keyword", nextKeyword.trim());
    if (nextCategory in REGULATION_CATEGORIES) query.set("category", nextCategory);
    if (next.archived ?? archived) query.set("status", "archived");
    router.replace(`/regulations${query.size ? `?${query}` : ""}`, { scroll: false });
  }

  if (workspace && canManage) return (
    <>
      <button type="button" className="administrative-button administrative-mode-switch" onClick={() => setWorkspace(false)}>返回公開法規查詢</button>
      <RegulationWorkspace />
    </>
  );

  return (
    <div className="administrative-index">
      <header className="administrative-page-heading">
        <h1>自治法規查詢系統</h1>
        {canManage && <button type="button" className="administrative-button" onClick={() => setWorkspace(true)}>法規管理</button>}
      </header>
      <form className="administrative-search" role="search" onSubmit={(event: FormEvent) => {
        event.preventDefault(); navigate({ keyword: input });
      }}>
        <div className="administrative-keyword">
          <label htmlFor="regulation-keyword">法規名稱或全文關鍵字</label>
          <div className="administrative-search-line">
            <input id="regulation-keyword" type="search" maxLength={100} value={input}
              placeholder="輸入法規名稱或關鍵字" onChange={(event) => setInput(event.target.value)} />
            <button type="submit" className="administrative-button administrative-submit">檢索</button>
          </div>
        </div>
        <fieldset className="administrative-category-filter">
          <legend>法規類別</legend>
          <div>
            {[{ key: "all", label: "全部" }, ...Object.entries(REGULATION_CATEGORIES).map(([key, label]) => ({ key, label }))].map((item) => (
              <button key={item.key} type="button" aria-pressed={category === item.key}
                onClick={() => navigate({ category: item.key })}>{item.label}</button>
            ))}
          </div>
        </fieldset>
        <label className="administrative-status-filter">法規狀態
          <select value={archived ? "archived" : "published"} onChange={(event) => navigate({ archived: event.target.value === "archived" })}>
            <option value="published">已公布法規</option><option value="archived">廢止法規</option>
          </select>
        </label>
      </form>
      <div className="administrative-results-heading">
        <p role="status" aria-live="polite">{loading ? "檢索中…" : error ? "檢索失敗" : <>查得法規 <strong>{sorted.length}</strong> 筆</>}</p>
        <label>排序
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="category">依類別排序</option><option value="title">依法規名稱排序</option><option value="published">依公布日期排序</option>
          </select>
        </label>
      </div>
      {error ? (
        <div className="administrative-feedback" role="alert">無法取得法規資料。<button type="button" onClick={() => setRetry((value) => value + 1)}>重新載入</button></div>
      ) : loading ? <div className="administrative-feedback" role="status">正在查詢法規…</div> : sorted.length === 0 ? (
        <div className="administrative-feedback">查無符合條件的法規。<Link href="/regulations">清除查詢條件</Link></div>
      ) : (
        <table className="administrative-table administrative-regulations">
          <caption className="sr-only">法規查詢結果</caption>
          <thead><tr><th scope="col">法規類別</th><th scope="col">法規名稱</th><th scope="col">公布日期</th><th scope="col">狀態</th></tr></thead>
          <tbody>{sorted.map((regulation) => (
            <tr key={regulation.id}>
              <td className="administrative-regulation-category">{REGULATION_CATEGORIES[regulation.category as RegulationCategory]}</td>
              <td className="administrative-subject">
                <Link className="administrative-row-link" href={regulationHref(regulation)}>{regulation.title}</Link>
                {"matched_articles" in regulation && regulation.matched_articles.length > 0 && (
                  <div className="administrative-search-matches">{regulation.matched_articles.slice(0, 3).map((article) => (
                    <Link key={article.id} href={`${regulationHref(regulation)}#a-${article.id}`}>
                      {article.article_type === "article" && article.legal_number ? `第 ${article.legal_number} 條：` : "相關內容："}
                      {(article.content || article.title || "").slice(0, 100)}
                    </Link>
                  ))}</div>
                )}
              </td>
              <td className="administrative-date"><time dateTime={regulation.published_at ?? undefined}>{administrativeDate(regulation.published_at)}</time></td>
              <td className="administrative-state">{regulationPublicState(regulation)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
