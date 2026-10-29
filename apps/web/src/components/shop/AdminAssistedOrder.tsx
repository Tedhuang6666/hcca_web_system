"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { shopApi, apiErrorMessage } from "@/lib/api";
import { flattenCatalog, money } from "@/lib/shop-class-orders";
import { mergeDraftItems } from "@/lib/shop-order-items";
import NumberInput from "@/components/ui/NumberInput";
import type { CatalogCategoryOut, ClassMemberOut, ProductOut, SchoolClassListItem } from "@/lib/types";

type DraftItem = {
  product_id: string;
  product_name: string;
  quantity: number;
  option_ids: string[];
  option_label: string;
  unit_price: number;
};

export default function AdminAssistedOrder({ catalog, classes, optionsError, optionsLoading = false, onRetry, onCreated }: {
  catalog: CatalogCategoryOut[];
  classes: SchoolClassListItem[];
  optionsError: boolean;
  optionsLoading?: boolean;
  onRetry: () => void;
  onCreated: () => void;
}) {
  const [classId, setClassId] = useState("");
  const [members, setMembers] = useState<ClassMemberOut[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");
  const [retry, setRetry] = useState(0);
  const [studentId, setStudentId] = useState("");
  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState("");
  const [product, setProduct] = useState<ProductOut | null>(null);
  const [productLoading, setProductLoading] = useState(false);
  const [productError, setProductError] = useState("");
  const [options, setOptions] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(1);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [notes, setNotes] = useState("");
  const [collectionMode, setCollectionMode] = useState<"class" | "separate">("class");
  const [paymentMethod, setPaymentMethod] = useState<"cash_on_pickup" | "bank_transfer">("cash_on_pickup");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  useEffect(() => {
    if (!classId) return;
    let cancelled = false;
    setMembersLoading(true);
    setMembersError("");
    shopApi.listOrderRecipients(classId).then((data) => {
      if (!cancelled) setMembers(data);
    }).catch((e) => {
      if (!cancelled) setMembersError(apiErrorMessage(e, "名冊載入失敗，請重試。"));
    }).finally(() => { if (!cancelled) setMembersLoading(false); });
    return () => { cancelled = true; };
  }, [classId, retry]);

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    setProductLoading(true);
    setProductError("");
    shopApi.getProduct(productId).then((data) => {
      if (!cancelled) setProduct(data);
    }).catch((e) => {
      if (!cancelled) setProductError(apiErrorMessage(e, "商品載入失敗，請重試。"));
    }).finally(() => { if (!cancelled) setProductLoading(false); });
    return () => { cancelled = true; };
  }, [productId, retry]);

  const choices = useMemo(() => flattenCatalog(catalog).filter((p) => p.status === "active"), [catalog]);
  const student = members.find((member) => member.id === studentId);
  const visibleMembers = members.filter((member) => (member.user_id || member.roster_entry_id)
    && (member.id === studentId || [member.display_name, member.student_id, member.seat_number]
      .some((value) => String(value ?? "").includes(search.trim()))));
  const selectedOptions = product?.variant_groups.flatMap((group) =>
    group.options.filter((option) => option.id === options[group.id])) ?? [];
  const unitPrice = (product?.price ?? 0) + selectedOptions.reduce((sum, option) => sum + option.price_delta, 0);
  const canAdd = student && product && !productLoading && !productError
    && product.status === "active" && Number.isInteger(quantity) && quantity >= 1 && quantity <= 100
    && product.variant_groups.every((group) => options[group.id]);

  const submit = async () => {
    if (!student || !items.length || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    setResult("");
    try {
      const orders = await shopApi.createAdminAssistedOrder({
        ...(student.user_id ? { user_id: student.user_id } : { roster_entry_id: student.roster_entry_id }),
        items: items.map(({ product_id, quantity, option_ids }) => ({ product_id, quantity, option_ids })),
        notes: notes.trim() || null,
        collection_mode: collectionMode,
        payment_method: paymentMethod,
      });
      setResult(`已為 ${classes.find((c) => c.id === classId)?.label ?? ""} ${student.display_name} 完成代訂，合計 ${money(orders.reduce((sum, order) => sum + order.total_price, 0))}。${orders.some((order) => order.supplement_class_id) ? "追加款項已列入補收款，確認收款後歸回原班級。" : "已併入班級收款。"}`);
      setItems([]);
      setNotes("");
      onCreated();
    } catch (e) {
      setError(apiErrorMessage(e, "代訂失敗，清單已保留，請重試。"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <details className="rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "var(--card-bg)" }}>
      <summary className="min-h-11 cursor-pointer content-center font-semibold">幫同學代訂</summary>
      <p className="my-3 text-sm" style={{ color: "var(--text-secondary)" }}>可替全校同學代訂，包含尚未登入的名冊學生。班聯可在結單後協助代訂，仍須符合庫存及商品規格；結單後的追加一律獨立補收款。</p>
      {optionsLoading ? <p role="status">載入班級與商品中…</p>
        : optionsError ? <div role="alert">班級與商品載入失敗。<button type="button" className="btn btn-ghost" onClick={onRetry}>重新載入班級與商品</button></div>
        : !classes.length ? <p role="status">目前沒有可代訂的班級，請先建立班級名冊。</p> : null}
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <fieldset disabled={saving || optionsError || optionsLoading} className="min-w-0 space-y-4">
          <legend className="sr-only">代訂資料</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">代訂班級
              <select className="input min-h-11 text-base" value={classId} disabled={items.length > 0} onChange={(event) => {
                setClassId(event.target.value); setStudentId(""); setMembers([]); setMembersLoading(false); setMembersError(""); setSearch(""); setResult("");
              }}>
                <option value="">請選擇班級</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm">搜尋同學姓名、學號或座號
              <input className="input min-h-11 text-base" value={search} disabled={!classId || items.length > 0} onChange={(event) => setSearch(event.target.value)} />
            </label>
          </div>
          {membersLoading && <p role="status">載入學生名冊中…</p>}
          {membersError && <div role="alert">{membersError}<button type="button" className="btn btn-ghost" onClick={() => setRetry((value) => value + 1)}>重試名冊</button></div>}
          {classId && !membersLoading && !membersError && !visibleMembers.length && <p role="status">沒有符合的同學，請調整搜尋或確認班級名冊。</p>}
          <label className="grid gap-1 text-sm">代訂同學
            <select className="input min-h-11 text-base" value={studentId} disabled={!classId || membersLoading || Boolean(membersError) || items.length > 0} onChange={(event) => { setStudentId(event.target.value); setResult(""); }}>
              <option value="">請選擇同學</option>
              {visibleMembers.map((member) => <option key={member.id} value={member.id}>{member.seat_number ? `${member.seat_number} 號 · ` : ""}{member.display_name}{member.student_id ? `（${member.student_id}）` : ""}</option>)}
            </select>
          </label>
          {items.length > 0 && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>清單已固定給這位同學；要更換對象，請先移除清單品項。</p>}
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <label className="grid gap-1 text-sm">代訂商品
              <select className="input min-h-11 text-base" value={productId} disabled={!student} onChange={(event) => {
                setProductId(event.target.value); setProduct(null); setOptions({}); setProductError(""); setQuantity(1);
              }}>
                <option value="">請選擇商品</option>
                {choices.map((p) => <option key={p.id} value={p.id}>{catalog.find((c) => c.id === p.categoryId)?.activity_name ?? "一般商品"} · {p.category} · {p.name}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm">數量
              <NumberInput className="input min-h-11 text-base" value={quantity} min={1} max={100} required onChange={(event) => setQuantity(Number(event.target.value))} />
            </label>
          </div>
          {!choices.length && <p role="status">目前沒有開放代訂的商品。</p>}
          {productLoading && <p role="status">載入商品規格中…</p>}
          {productError && <div role="alert">{productError}<button type="button" className="btn btn-ghost" onClick={() => setRetry((value) => value + 1)}>重試商品</button></div>}
          {product?.variant_groups.map((group) => <label key={group.id} className="grid gap-1 text-sm">{group.name}（必選）
            <select className="input min-h-11 text-base" value={options[group.id] ?? ""} onChange={(event) => setOptions((previous) => ({ ...previous, [group.id]: event.target.value }))}>
              <option value="">請選擇{group.name}</option>
              {group.options.filter((option) => option.is_active).map((option) => <option key={option.id} value={option.id}>{option.value}{option.price_delta ? `（+${money(option.price_delta)}）` : ""}</option>)}
            </select>
          </label>)}
          <button type="button" className="btn btn-ghost min-h-11" disabled={!canAdd} onClick={() => {
            if (!product || !canAdd) return;
            setItems((previous) => mergeDraftItems([...previous, { product_id: product.id, product_name: product.name, quantity,
              option_ids: selectedOptions.map((option) => option.id), option_label: selectedOptions.map((option) => option.value).join("／"), unit_price: unitPrice }]));
            setResult(""); setError("");
          }}>加入代訂清單</button>
          {items.length > 0 && <section aria-label="待送出的代訂清單" className="space-y-3">
            <h2 className="font-semibold">{student?.display_name}的代訂清單</h2>
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {items.map((item, index) => <li key={index} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0 break-words">{item.product_name}{item.option_label && `（${item.option_label}）`} × {item.quantity} · {money(item.quantity * item.unit_price)}</span>
                <button type="button" className="btn btn-ghost min-h-11" aria-label={`移除${item.product_name}${item.option_label}`} onClick={() => setItems((previous) => previous.filter((_, i) => i !== index))}>移除</button>
              </li>)}
            </ul>
            <p>商品小計 {money(items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0))}，優惠與最終金額依送出結果計算。</p>
          </section>}
          <label className="grid gap-1 text-sm">收款安排
            <select className="input min-h-11 text-base" value={collectionMode} onChange={(event) => {
              setCollectionMode(event.target.value as "class" | "separate");
            }}>
              <option value="class">併入班級收款</option>
              <option value="separate">獨立補收款</option>
            </select>
          </label>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {collectionMode === "class" ? "尚未繳款時併入班級；班級已繳款、同學已交班代或班聯已結單時，自動另列補收款。" : "本筆由代訂人另行繳款，暫不列入班級金額；班聯確認收款後可下載收據，並自動歸回原班級。"}
          </p>
          {collectionMode === "separate" && <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">額外收款方式
              <select className="input min-h-11 text-base" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as "cash_on_pickup" | "bank_transfer")}>
                <option value="cash_on_pickup">現金</option>
                <option value="bank_transfer">銀行轉帳</option>
              </select>
            </label>
          </div>}
          <label className="grid gap-1 text-sm">代訂備註（選填）
            <textarea className="input text-base" rows={2} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary min-h-11" disabled={!student || !items.length || saving}>{saving ? "代訂送出中…" : "送出代訂"}</button>
        </fieldset>
        {error && <p role="alert" className="mt-3">{error}</p>}
        <p role="status" className="mt-3">{result}</p>
      </form>
    </details>
  );
}
