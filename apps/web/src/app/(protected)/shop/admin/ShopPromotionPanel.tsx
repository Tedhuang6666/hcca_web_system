"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { apiErrorMessage, shopApi } from "@/lib/api";
import type { ProductOut, ShopDiscountType, ShopPromotionOut } from "@/lib/types";

type PromotionForm = {
  name: string;
  target_identifiers: string;
  target_product_ids: string[];
  code: string;
  discount_type: ShopDiscountType;
  discount_value: string;
  min_order_price: string;
  min_quantity: string;
  max_uses: string;
  description: string;
};

const emptyForm: PromotionForm = {
  name: "",
  target_identifiers: "",
  target_product_ids: [],
  code: "",
  discount_type: "percentage",
  discount_value: "10",
  min_order_price: "0",
  min_quantity: "1",
  max_uses: "",
  description: "",
};

async function listAllActiveProducts() {
  const products: ProductOut[] = [];
  let offset = 0;
  while (true) {
    const page = await shopApi.listProducts({ status: "active", limit: "100", offset: String(offset) });
    products.push(...page);
    if (page.length < 100) return products;
    offset += page.length;
  }
}

export default function ShopPromotionPanel() {
  const [promotions, setPromotions] = useState<ShopPromotionOut[]>([]);
  const [products, setProducts] = useState<ProductOut[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [promotionRows, productRows] = await Promise.all([
        shopApi.listPromotions(),
        listAllActiveProducts(),
      ]);
      setPromotions(promotionRows);
      setProducts(productRows);
    } catch (error) {
      toast.error(apiErrorMessage(error, "載入優惠失敗"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    const targetIdentifiers = form.target_identifiers
      .split(/[\r\n,;]+/)
      .map((identifier) => identifier.trim())
      .filter(Boolean);
    if (!form.name.trim()) {
      toast.error("請輸入優惠名稱");
      return;
    }
    setSaving(true);
    try {
      await shopApi.createPromotion({
        name: form.name.trim(),
        target_identifiers: targetIdentifiers,
        target_product_ids: form.target_product_ids,
        code: form.code.trim().toUpperCase() || null,
        discount_type: form.discount_type,
        discount_value: Number(form.discount_value),
        min_order_price: Number(form.min_order_price) || 0,
        min_quantity: Number(form.min_quantity) || 1,
        max_uses: form.max_uses ? Number(form.max_uses) : null,
        description: form.description.trim() || null,
      });
      toast.success("優惠已建立");
      setForm(emptyForm);
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, "建立優惠失敗"));
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (promotion: ShopPromotionOut) => {
    try {
      await shopApi.updatePromotion(promotion.id, { is_active: false });
      toast.success("優惠已停用");
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, "停用優惠失敗"));
    }
  };

  const update = <K extends keyof PromotionForm>(key: K, value: PromotionForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const toggleProduct = (productId: string) => {
    setForm((current) => ({
      ...current,
      target_product_ids: current.target_product_ids.includes(productId)
        ? current.target_product_ids.filter((id) => id !== productId)
        : [...current.target_product_ids, productId],
    }));
  };

  return (
    <div className="space-y-5">
      <section className="card space-y-4 p-5">
        <div>
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>建立優惠</h2>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            可依帳號、消費金額、指定商品與件數設定優惠。留空優惠碼即符合條件自動套用；有優惠碼時由使用者領取並套用。
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium sm:col-span-2" style={{ color: "var(--text-secondary)" }}>
            優惠名稱
            <input className="input mt-1 w-full" value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="例如：校友回饋 9 折" />
          </label>
          <label className="block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            可使用帳號（選填）
            <textarea className="input mt-1 w-full min-h-24 resize-y" rows={3}
              value={form.target_identifiers}
              onChange={(e) => update("target_identifiers", e.target.value)}
              placeholder={"每行一個 Email 或學號\nstudent@example.edu.tw\n1101234"} />
            <span className="mt-1 block text-[11px]" style={{ color: "var(--text-muted)" }}>
              留空代表所有帳號可用；輸入名單後僅列入的帳號可用，無論自動優惠或優惠碼。
            </span>
          </label>
          <label className="block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            優惠碼（選填）
            <input className="input mt-1 w-full uppercase" value={form.code} onChange={(e) => update("code", e.target.value.toUpperCase())} placeholder="WELCOME10" autoCapitalize="characters" />
          </label>
          <label className="block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            折扣類型
            <select className="input mt-1 w-full" value={form.discount_type} onChange={(e) => update("discount_type", e.target.value as ShopDiscountType)}>
              <option value="percentage">百分比折扣</option>
              <option value="fixed">固定金額折抵</option>
            </select>
          </label>
          <label className="block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            {form.discount_type === "percentage" ? "折扣百分比" : "折抵金額"}
            <input className="input mt-1 w-full" type="number" min="1" max={form.discount_type === "percentage" ? 100 : undefined} value={form.discount_value} onChange={(e) => update("discount_value", e.target.value)} />
          </label>
          <label className="block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            最低消費（選填）
            <input className="input mt-1 w-full" type="number" min="0" value={form.min_order_price} onChange={(e) => update("min_order_price", e.target.value)} />
          </label>
          <label className="block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            最低件數
            <input className="input mt-1 w-full" type="number" min="1" max="100" value={form.min_quantity} onChange={(e) => update("min_quantity", e.target.value)} />
            <span className="mt-1 block text-[11px]" style={{ color: "var(--text-muted)" }}>
              只計下方指定商品；未指定商品時以登記總件數計算。
            </span>
          </label>
          <fieldset className="sm:col-span-2">
            <legend className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>適用商品（可複選）</legend>
            <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
              折扣只計指定品項，最低消費門檻看整筆登記金額。多選時每項都需登記，最低件數為指定商品合計；只選一項可設定單品買滿件數優惠。
            </p>
            <div className="mt-2 grid max-h-48 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2" style={{ borderColor: "var(--border)" }}>
              {products.length === 0 ? (
                <p className="p-2 text-xs" style={{ color: "var(--text-muted)" }}>目前沒有上架商品，仍可建立全品項優惠。</p>
              ) : products.map((product) => (
                <label key={product.id} className="flex min-h-10 items-center gap-2 rounded-md px-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                  <input type="checkbox" checked={form.target_product_ids.includes(product.id)} onChange={() => toggleProduct(product.id)} />
                  <span>{product.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            使用次數上限（選填）
            <input className="input mt-1 w-full" type="number" min="1" value={form.max_uses} onChange={(e) => update("max_uses", e.target.value)} placeholder="不限次數" />
          </label>
          <label className="block text-xs font-medium sm:col-span-2" style={{ color: "var(--text-secondary)" }}>
            備註（選填）
            <input className="input mt-1 w-full" value={form.description} onChange={(e) => update("description", e.target.value)} />
          </label>
        </div>
        <button className="btn min-h-11" onClick={create} disabled={saving} style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
          {saving ? "建立中…" : "建立優惠"}
        </button>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>優惠清單</h2>
        </div>
        {loading ? (
          <p className="p-5 text-sm" style={{ color: "var(--text-muted)" }}>載入中…</p>
        ) : promotions.length === 0 ? (
          <p className="p-5 text-sm" style={{ color: "var(--text-muted)" }}>尚未建立優惠。</p>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {promotions.map((promotion) => {
              const targetUsers = promotion.target_users ?? [];
              const targetLabel = targetUsers.length > 0
                ? targetUsers.map((user) => user.student_id
                  ? `${user.email}（學號 ${user.student_id}）`
                  : user.email).join("、")
                : promotion.target_email || "所有可使用帳號";
              return (
                <div key={promotion.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium" style={{ color: "var(--text-primary)" }}>{promotion.name}</p>
                      <span className="rounded-md px-2 py-1 text-[11px]" style={{ background: promotion.is_active ? "var(--success-dim)" : "var(--bg-elevated)", color: promotion.is_active ? "var(--success)" : "var(--text-muted)" }}>
                        {promotion.is_active ? "啟用中" : "已停用"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                      {promotion.code ? `優惠碼 ${promotion.code}` : "符合條件自動套用"} · {targetLabel} · {promotion.discount_type === "percentage" ? `${promotion.discount_value}% 折扣` : `折抵 NT$${promotion.discount_value.toLocaleString()}`}
                    </p>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                      {promotion.min_order_price > 0 ? `滿 NT$${promotion.min_order_price.toLocaleString()} · ` : ""}
                      {promotion.min_quantity > 1 ? `滿 ${promotion.min_quantity} 件 · ` : ""}
                      {promotion.target_products?.length
                        ? promotion.target_products.map((product) => product.name).join(" + ")
                        : "全品項"}
                    </p>
                  </div>
                  {promotion.is_active && <button className="btn btn-ghost min-h-11 shrink-0 self-start text-xs sm:self-auto" onClick={() => deactivate(promotion)}>停用</button>}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
