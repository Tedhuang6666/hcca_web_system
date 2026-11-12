"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { apiErrorMessage, shopApi } from "@/lib/api";
import type { ProductCategoryOut, ProductOut, ProductPurchaseRules, ShopTargetOut } from "@/lib/types";

type ProductRules = { product: ProductOut; rules: ProductPurchaseRules };
type GroupProduct = { product: ProductOut; identifiers: string[] };

async function loadCatalog() {
  const [categories, series] = await Promise.all([shopApi.listCategories(), shopApi.listSeries()]);
  const products: ProductOut[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await shopApi.listProducts({ limit: "100", offset: String(offset) });
    products.push(...page);
    if (page.length < 100) break;
  }
  const categoryBySeries = new Map(series.map((item) => [item.id, item.category_id]));
  return {
    categories,
    products: products.map((product) => ({ ...product,
      category_id: product.category_id ?? categoryBySeries.get(product.series_id ?? "") ?? null,
    })),
  };
}

function groupByNote(rows: ProductRules[]) {
  const groups = new Map<string, GroupProduct[]>();
  for (const { product, rules } of rows) {
    const blocked = new Set(rules.blocked_identifiers ?? []);
    const byNote = new Map<string, string[]>();
    for (const identifier of new Set(rules.allowed_identifiers ?? [])) {
      if (blocked.has(identifier)) continue;
      const note = rules.identifier_notes?.[identifier]?.trim() ?? "";
      const identifiers = byNote.get(note) ?? [];
      identifiers.push(identifier);
      byNote.set(note, identifiers);
    }
    for (const [note, identifiers] of byNote) {
      const entries = groups.get(note) ?? [];
      entries.push({ product, identifiers });
      groups.set(note, entries);
    }
  }
  return [...groups].sort(([left], [right]) => !left ? 1 : !right ? -1 : left.localeCompare(right, "zh-TW"));
}

function GroupMembers({ entry, activityId }: { entry: GroupProduct; activityId: string | null }) {
  const [result, setResult] = useState<{ rows: ShopTargetOut[]; error: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [visible, setVisible] = useState(50);
  useEffect(() => {
    let active = true;
    shopApi.lookupTargets({ activity_id: activityId, product_id: entry.product.id,
      keyword: "", identifiers: entry.identifiers }).then((rows) => {
      if (active) setResult({ rows, error: "" });
    }).catch((error) => {
      if (active) setResult({ rows: [], error: apiErrorMessage(error, "名單核對失敗，請重試。") });
    });
    return () => { active = false; };
  }, [entry, activityId, attempt]);
  const people = new Map(result?.rows.map((person) => [person.identifier, person]));
  return <div className="space-y-2 pt-2">
    {!result && <p role="status" className="text-sm">正在核對人員與訂購狀態…</p>}
    {result?.error && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
      {result.error}<button type="button" className="btn btn-ghost min-h-11" onClick={() => {
        setResult(null); setAttempt((value) => value + 1);
      }}>重新核對</button>
    </p>}
    <ul aria-label={`${entry.product.name}人員名單`} className="divide-y" style={{ borderColor: "var(--border)" }}>
      {entry.identifiers.slice(0, visible).map((identifier) => {
        const person = people.get(identifier);
        return <li key={identifier} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
          <div className="min-w-0 break-words">
            <p className="font-medium">{person?.display_name ?? identifier}</p>
            <p style={{ color: "var(--text-secondary)" }}>{[identifier, person?.class_label,
              person?.seat_number ? `${person.seat_number} 號` : null].filter(Boolean).join(" · ")}</p>
            {person?.matched === false && <p style={{ color: "var(--warning)" }}>查無人員資料，請確認學號。</p>}
          </div>
          <span>{person?.has_ordered === true ? "已訂購" : person?.has_ordered === false ? "未訂購" : "狀態待核對"}</span>
        </li>;
      })}
    </ul>
    {visible < entry.identifiers.length && <button type="button" className="btn btn-secondary min-h-11"
      onClick={() => setVisible((value) => value + 50)}>再顯示 50 人（剩餘 {entry.identifiers.length - visible} 人）</button>}
    <p className="text-sm" style={{ color: "var(--text-secondary)" }}>訂購狀態包含代訂；取消、退款與測試訂單不計。</p>
  </div>;
}

export default function ShopNoteGroupsPanel() {
  const id = useId();
  const [catalog, setCatalog] = useState<{ categories: ProductCategoryOut[]; products: ProductOut[] } | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [categoryId, setCategoryId] = useState("");
  const [rules, setRules] = useState<{ key: string; rows: ProductRules[]; error: string } | null>(null);
  const [rulesAttempt, setRulesAttempt] = useState(0);
  const [noteQuery, setNoteQuery] = useState("");
  const [opened, setOpened] = useState<string[]>([]);
  const rulesKey = JSON.stringify([categoryId, attempt, rulesAttempt]);

  useEffect(() => {
    let active = true;
    loadCatalog().then((data) => { if (active) setCatalog(data); }).catch((error) => {
      if (active) setCatalogError(apiErrorMessage(error, "商品目錄讀取失敗，請重新載入。"));
    });
    return () => { active = false; };
  }, [attempt]);

  useEffect(() => {
    if (!catalog || !categoryId) return;
    let active = true;
    const products = catalog.products.filter((product) => product.category_id === categoryId);
    // 限制同時讀取數量；任一商品失敗時不呈現不完整的合計。
    async function loadRules() {
      const rows: ProductRules[] = [];
      for (let index = 0; index < products.length; index += 5) {
        if (!active) return;
        rows.push(...await Promise.all(products.slice(index, index + 5).map(async (product) => ({
          product, rules: await shopApi.getProductPurchaseRules(product.id),
        }))));
      }
      if (active) setRules({ key: rulesKey, rows, error: "" });
    }
    void loadRules().catch((error) => {
      if (active) setRules({ key: rulesKey, rows: [], error: apiErrorMessage(error, "購買名單讀取失敗，尚無法完成分組，請重試。") });
    });
    return () => { active = false; };
  }, [catalog, categoryId, rulesKey]);

  const currentRules = rules?.key === rulesKey ? rules : null;
  const groups = useMemo(() => groupByNote(currentRules?.rows ?? []), [currentRules]);
  const filtered = groups.filter(([note]) => (note || "未填備註").toLocaleLowerCase().includes(noteQuery.trim().toLocaleLowerCase()));
  const category = catalog?.categories.find((item) => item.id === categoryId);
  return <section className="card min-w-0 space-y-5 p-4 sm:p-6" aria-label="依備註分組查看購買名單">
    <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
      依已儲存的允許購買名單彙總各商品人數，禁止名單不計。這是名單分配人數，非實際訂購張數；年級與權限等購買條件仍會在下單時檢查。
    </p>
    {catalogError ? <div role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
      <p>{catalogError}</p><button type="button" className="btn btn-secondary min-h-11" onClick={() => {
        setCatalogError(""); setAttempt((value) => value + 1);
      }}>重新載入商品目錄</button>
    </div> : !catalog ? <p role="status">正在載入商品目錄…</p>
      : catalog.categories.length === 0 ? <p>尚未建立商品主題，請先到商品設定新增主題與商品。</p>
        : <>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium" htmlFor={`${id}-category`}>商品主題
              <select id={`${id}-category`} className="input mt-1 min-h-11 w-full text-base" value={categoryId}
                onChange={(event) => { setCategoryId(event.target.value); setNoteQuery(""); setOpened([]); }}>
                <option value="">選擇商品主題</option>
                {catalog.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium" htmlFor={`${id}-note`}>搜尋備註
              <input id={`${id}-note`} type="search" className="input mt-1 min-h-11 w-full text-base" value={noteQuery}
                placeholder="例如：熱音" onChange={(event) => setNoteQuery(event.target.value)} />
            </label>
          </div>
          {!categoryId ? <p className="text-sm">選擇主題後，查看各備註分組下的一般票、套票等商品名單人數。</p>
            : !currentRules ? <p role="status">正在彙整購買名單…</p>
              : currentRules.error ? <div role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
                <p>{currentRules.error}</p><button type="button" className="btn btn-secondary min-h-11"
                  onClick={() => { setOpened([]); setRulesAttempt((value) => value + 1); }}>重新讀取購買名單</button>
              </div> : <>
                <p role="status" className="text-sm">共 {groups.length} 組備註，顯示 {filtered.length} 組。相同完整備註視為同組，忽略前後空白；未填備註另列一組。</p>
                {groups.length === 0 ? <p>此主題尚無允許購買名單，請先在商品的購買資格加入人員並儲存。</p>
                  : filtered.length === 0 ? <p>沒有符合的備註分組，請調整搜尋文字。</p>
                    : <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                      {filtered.map(([note, entries]) => <section key={note} className="space-y-2 py-4" aria-label={`備註：${note || "未填備註"}`}>
                        <h2 className="whitespace-pre-wrap break-words text-lg font-semibold">{note || "未填備註"}</h2>
                        {entries.map((entry) => {
                          const key = JSON.stringify([note, entry.product.id]);
                          const isOpen = opened.includes(key);
                          return <div key={entry.product.id}>
                            <button type="button" className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-2 text-left hover:bg-[var(--bg-hover)]"
                              aria-expanded={isOpen} aria-controls={`${id}-${encodeURIComponent(key)}`}
                              onClick={() => setOpened((values) => isOpen ? values.filter((item) => item !== key) : [...values, key])}>
                              <span className="min-w-0 break-words font-medium">{entry.product.name}</span>{" "}
                              <span className="shrink-0 text-sm tabular-nums">{entry.identifiers.length} 人 · {isOpen ? "收起名單" : "查看名單"}</span>
                            </button>
                            {isOpen && <div id={`${id}-${encodeURIComponent(key)}`} className="px-2">
                              <GroupMembers entry={entry} activityId={category?.activity_id ?? null} />
                            </div>}
                          </div>;
                        })}
                      </section>)}
                    </div>}
              </>}
        </>}
  </section>;
}
