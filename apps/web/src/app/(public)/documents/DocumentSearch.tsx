"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { documentsApi } from "@/lib/api/documents";
import { usePermissions } from "@/hooks/usePermissions";
import { administrativeDate, DOCUMENT_CATEGORIES } from "@/lib/administrative";
import type { DocumentListItem } from "@/lib/types";

const DocumentWorkspace = dynamic(() => import("./client"));
const PAGE_SIZE = 20;
const FIELDS = ["keyword", "serial_prefix", "category", "issued_from", "issued_to"] as const;
type Search = Record<(typeof FIELDS)[number], string>;
const EMPTY: Search = { keyword: "", serial_prefix: "", category: "", issued_from: "", issued_to: "" };

export default function DocumentSearch({ initialDocs = [] }: { initialDocs?: DocumentListItem[] | null }) {
  const params = useSearchParams();
  const router = useRouter();
  const { canAny } = usePermissions();
  const [workspace, setWorkspace] = useState(false);
  const canManage = canAny("document:draft", "document:edit", "document:issue_direct", "document:approve", "document:reject", "document:view_all",
    "document:admin", "document:archive", "document:forward");
  const query = new URLSearchParams();
  for (const key of FIELDS) if (params.get(key)) query.set(key, params.get(key)!);
  const queryString = query.toString();
  const [form, setForm] = useState<Search>(() => Object.fromEntries(FIELDS.map((key) => [key, params.get(key) ?? ""])) as Search);
  const [documents, setDocuments] = useState(initialDocs ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState((initialDocs?.length ?? 0) === PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    const criteria = new URLSearchParams(queryString);
    setForm(Object.fromEntries(FIELDS.map((key) => [key, criteria.get(key) ?? ""])) as Search);
    setLoading(true);
    setDocuments([]);
    setHasMore(false);
    setLoadingMore(false);
    setError(null);
    void documentsApi.list({ ...Object.fromEntries(criteria), visibility: "publicly_open", limit: String(PAGE_SIZE), offset: "0" })
      .then((data) => {
        if (current !== generation.current) return;
        setDocuments(data); setHasMore(data.length === PAGE_SIZE);
      }).catch(() => {
        if (current === generation.current) setError("無法取得公文資料，請重新載入。");
      }).finally(() => {
        if (current === generation.current) setLoading(false);
      });
    return () => { generation.current += 1; };
  }, [queryString, retry]);

  async function loadMore() {
    const current = generation.current;
    setLoadingMore(true); setError(null);
    try {
      const data = await documentsApi.list({ ...Object.fromEntries(new URLSearchParams(queryString)),
        visibility: "publicly_open", limit: String(PAGE_SIZE), offset: String(documents.length) });
      if (current !== generation.current) return;
      setDocuments((previous) => [...previous, ...data]);
      setHasMore(data.length === PAGE_SIZE);
    } catch {
      if (current === generation.current) setError("無法載入後續公文，請重試。");
    } finally {
      if (current === generation.current) setLoadingMore(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = new URLSearchParams();
    for (const key of FIELDS) if (form[key].trim()) next.set(key, form[key].trim());
    if (next.toString() === queryString) setRetry((value) => value + 1);
    else router.replace(`/documents${next.size ? `?${next}` : ""}`, { scroll: false });
  }

  if (canManage && (workspace || params.has("status"))) return (
    <>
      <button type="button" className="administrative-button administrative-mode-switch" onClick={() => {
        setWorkspace(false); router.replace("/documents", { scroll: false });
      }}>返回公開公文查詢</button>
      <DocumentWorkspace />
    </>
  );

  return (
    <div className="administrative-index">
      <header className="administrative-page-heading">
        <h1 className="text-xl font-semibold">公文查詢</h1>
        {canManage && <button type="button" className="btn btn-secondary" onClick={() => setWorkspace(true)}>公文管理</button>}
      </header>
      <form className="administrative-search administrative-document-search" role="search" onSubmit={submit}>
        <label className="administrative-keyword">主旨或關鍵字
          <input type="search" maxLength={100} value={form.keyword} placeholder="輸入主旨或文書內容"
            onChange={(event) => setForm({ ...form, keyword: event.target.value })} />
        </label>
        <label>發文字號
          <input type="search" maxLength={30} value={form.serial_prefix} placeholder="輸入完整字號或前綴"
            onChange={(event) => setForm({ ...form, serial_prefix: event.target.value })} />
        </label>
        <label>文書類別
          <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
            <option value="">全部類別</option>
            {Object.entries(DOCUMENT_CATEGORIES).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
          </select>
        </label>
        <fieldset className="administrative-date-range">
          <legend>發文日期範圍</legend>
          <div>
            <input aria-label="發文日期起" type="date" value={form.issued_from} max={form.issued_to || undefined}
              onChange={(event) => setForm({ ...form, issued_from: event.target.value })} />
            <span>至</span>
            <input aria-label="發文日期迄" type="date" value={form.issued_to} min={form.issued_from || undefined}
              onChange={(event) => setForm({ ...form, issued_to: event.target.value })} />
          </div>
        </fieldset>
        <div className="administrative-form-actions">
          <button type="submit" className="administrative-button administrative-submit">檢索</button>
          <button type="button" className="administrative-button" onClick={() => {
            setForm(EMPTY); router.replace("/documents", { scroll: false });
            if (!queryString) setRetry((value) => value + 1);
          }}>清除條件</button>
        </div>
      </form>
      <div className="administrative-results-heading">
        <p role="status" aria-live="polite">{loading ? "檢索中…" : <>已載入公文 <strong>{documents.length}</strong> 筆</>}</p>
        <span>依建檔日期由新至舊</span>
      </div>
      {error && <div className="administrative-feedback" role="alert">{error}<button type="button" onClick={() => {
        if (error.includes("後續")) void loadMore(); else setRetry((value) => value + 1);
      }}>重試</button></div>}
      {loading ? <div className="administrative-feedback" role="status">正在查詢公文…</div> : !error && documents.length === 0 ? (
        <div className="administrative-feedback">查無符合條件的公開公文。</div>
      ) : !error || documents.length > 0 ? (
        <table className="administrative-table administrative-documents">
          <caption className="sr-only">公開公文查詢結果</caption>
          <thead><tr><th scope="col">發文日期</th><th scope="col">發文字號</th><th scope="col">主旨／摘要</th></tr></thead>
          <tbody>{documents.map((document) => (
            <tr key={document.id}>
              <td className="administrative-date"><time dateTime={document.issued_at ?? undefined}>{administrativeDate(document.issued_at)}</time></td>
              <td className="administrative-serial">{document.is_redacted ? "不公開" : document.serial_number}</td>
              <td className="administrative-subject">{document.is_redacted ? "不公開" : (
                <Link href={`/documents/${encodeURIComponent(document.serial_number)}`} className="administrative-row-link" prefetch={false}>
                  {document.summary || document.subject || document.title}
                </Link>
              )}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : null}
      {!loading && hasMore && <div className="administrative-pagination">
        <button type="button" className="administrative-button" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? "載入中…" : "載入更多公文"}
        </button>
      </div>}
    </div>
  );
}
