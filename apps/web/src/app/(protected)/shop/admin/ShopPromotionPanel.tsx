"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { apiErrorMessage, shopApi } from "@/lib/api";
import ShopTargetPicker, { targetIdentifiers } from "@/components/shop/ShopTargetPicker";
import type {
  ProductOut,
  ProductCategoryOut,
  ProductSeriesOut,
  ShopDiscountType,
  ShopPromotionOut,
} from "@/lib/types";

type PromotionForm = {
  target_category_ids: string[];
  name: string;
  target_identifiers: string;
  target_product_ids: string[];
  product_prices: Record<string, string>;
  code: string;
  discount_type: ShopDiscountType | "gift" | "activity_free";
  discount_value: string;
  gift_quantity: string;
  min_order_price: string;
  min_quantity: string;
  max_uses: string;
  description: string;
  is_public: boolean;
};

const emptyForm: PromotionForm = {
  target_category_ids: [],
  name: "",
  target_identifiers: "",
  target_product_ids: [],
  product_prices: {},
  code: "",
  discount_type: "percentage",
  discount_value: "10",
  gift_quantity: "1",
  min_order_price: "0",
  min_quantity: "1",
  max_uses: "",
  description: "",
  is_public: true,
};

const PRODUCT_STATUS_LABEL: Record<ProductOut["status"], string> = {
  draft: "尚未上架",
  testing: "測試中",
  active: "上架中",
  sold_out: "售罄",
  cancelled: "已下架",
};

async function listAllProducts() {
  const products: ProductOut[] = [];
  let offset = 0;
  while (true) {
    const page = await shopApi.listProducts({ limit: "100", offset: String(offset) });
    products.push(...page);
    if (page.length < 100) return products;
    offset += page.length;
  }
}

function isActivityFreePromotion(promotion: ShopPromotionOut) {
  return promotion.discount_type === "percentage" && promotion.discount_value === 100
    && (promotion.target_products?.length ?? 0) === 0
    && (promotion.target_category_ids?.length ?? 0) > 0
    && (promotion.target_users?.length ?? 0) > 0
    && promotion.code === null && promotion.max_uses === null
    && promotion.min_order_price === 0 && promotion.min_quantity === 1;
}

export default function ShopPromotionPanel() {
  const [promotions, setPromotions] = useState<ShopPromotionOut[]>([]);
  const [products, setProducts] = useState<ProductOut[]>([]);
  const [categories, setCategories] = useState<ProductCategoryOut[]>([]);
  const [series, setSeries] = useState<ProductSeriesOut[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingPromotionId, setEditingPromotionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingPromotionId, setDeletingPromotionId] = useState<string | null>(null);
  const formSectionRef = useRef<HTMLElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [promotionRows, productRows, categoryRows, seriesRows] = await Promise.all([
        shopApi.listPromotions(),
        listAllProducts(),
        shopApi.listCategories(),
        shopApi.listSeries(),
      ]);
      setPromotions(promotionRows);
      setProducts(productRows);
      setCategories(categoryRows);
      setSeries(seriesRows);
    } catch (error) {
      setLoadError(apiErrorMessage(error, "無法載入優惠，請重新載入後再操作。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    const targets = targetIdentifiers(form.target_identifiers);
    if (targets.length > 500 || targets.some((identifier) => !/^(?:[0-9]{1,20}|[^\s@]+@[^\s@]+)$/u.test(identifier) || identifier.length > 255)) {
      toast.error("請確認可使用帳號名單：最多 500 人，姓名請先搜尋並選取，批次輸入僅接受學號或 Email。");
      return;
    }
    if (!form.name.trim()) {
      toast.error("請輸入優惠名稱");
      return;
    }
    if (form.discount_type === "activity_free") {
      if (form.target_category_ids.length === 0) {
        toast.error("活動免費券請至少選擇一個適用活動");
        return;
      }
      if (targets.length === 0) {
        toast.error("活動免費券請指定可使用帳號");
        return;
      }
    }
    const productPriceOverrides: { product_id: string; unit_price: number }[] = [];
    if (form.discount_type === "gift" && form.target_product_ids.length === 0) {
      toast.error("請選擇要贈送的票券或商品");
      return;
    }
    if (form.discount_type === "gift"
      && (!Number.isInteger(Number(form.gift_quantity)) || Number(form.gift_quantity) < 1
        || Number(form.gift_quantity) > 100)) {
      toast.error("每項贈送數量請填入 1 到 100 的整數");
      return;
    }
    if (form.discount_type === "bundle_price") {
      const originalPrice = products.filter((row) => form.target_product_ids.includes(row.id))
        .reduce((sum, row) => sum + row.price, 0);
      const bundlePrice = Number(form.discount_value);
      if (form.target_product_ids.length < 2) {
        toast.error("套組至少要選擇兩項不同商品，每項各一件");
        return;
      }
      if (!Number.isSafeInteger(bundlePrice) || bundlePrice <= 0 || bundlePrice >= originalPrice) {
        toast.error("套組價必須大於 0，且低於各商品原價合計");
        return;
      }
    }
    if (form.discount_type === "price_override") {
      if (form.target_product_ids.length === 0) {
        toast.error("請至少選擇一項適用商品");
        return;
      }
      for (const productId of form.target_product_ids) {
        const rawPrice = form.product_prices[productId]?.trim() ?? "";
        const unitPrice = Number(rawPrice);
        const product = products.find((row) => row.id === productId);
        if (!rawPrice || !Number.isSafeInteger(unitPrice) || unitPrice < 0) {
          toast.error(`請為「${product?.name ?? "每項適用商品"}」輸入有效的優惠後單價`);
          return;
        }
        if (product && unitPrice >= product.price) {
          toast.error(`「${product.name}」的優惠後單價須低於目前單價 NT$${product.price.toLocaleString()}`);
          return;
        }
        productPriceOverrides.push({ product_id: productId, unit_price: unitPrice });
      }
    }
    setSaving(true);
    try {
      const payload = {
        activity_id: null,
        target_category_ids: form.target_category_ids,
        name: form.name.trim(),
        target_identifiers: targets,
        target_product_ids: form.discount_type === "activity_free" ? [] : form.target_product_ids,
        product_price_overrides: productPriceOverrides,
        code: form.discount_type === "activity_free" ? null : form.code.trim().toUpperCase() || null,
        discount_type: form.discount_type === "gift" || form.discount_type === "activity_free"
          ? "percentage" as const : form.discount_type,
        discount_value: form.discount_type === "gift" || form.discount_type === "activity_free" ? 100
          : form.discount_type === "price_override" ? 0 : Number(form.discount_value),
        min_order_price: form.discount_type === "activity_free" ? 0 : Number(form.min_order_price) || 0,
        min_quantity: form.discount_type === "activity_free" ? 1 : Number(form.min_quantity) || 1,
        gift_quantity: form.discount_type === "gift" ? Number(form.gift_quantity) : 1,
        max_uses: form.discount_type === "activity_free" ? null : form.max_uses ? Number(form.max_uses) : null,
        description: form.description.trim() || null,
        is_public: form.discount_type === "activity_free" ? false : form.is_public,
      };
      if (editingPromotionId) {
        await shopApi.updatePromotion(editingPromotionId, payload);
        toast.success("優惠已更新");
      } else {
        await shopApi.createPromotion(payload);
        toast.success("優惠已建立");
      }
      setEditingPromotionId(null);
      setForm(emptyForm);
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, editingPromotionId ? "更新優惠失敗" : "建立優惠失敗"));
    } finally {
      setSaving(false);
    }
  };

  const editPromotion = (promotion: ShopPromotionOut) => {
    setEditingPromotionId(promotion.id);
    setForm({
      target_category_ids: promotion.target_category_ids ?? categories
        .filter((category) => category.activity_id === (promotion.activity_id ?? null))
        .map((category) => category.id),
      name: promotion.name,
      target_identifiers: (promotion.target_users ?? [])
        .map((user) => user.student_id || user.email)
        .filter((identifier): identifier is string => Boolean(identifier))
        .join("\n"),
      target_product_ids: (promotion.target_products ?? []).map((product) => product.id),
      product_prices: Object.fromEntries(
        (promotion.product_price_overrides ?? []).map((price) => [
          price.product_id,
          String(price.unit_price),
        ]),
      ),
      code: promotion.code ?? "",
      discount_type: promotion.discount_type === "percentage" && promotion.discount_value === 100
        && (promotion.target_products?.length ?? 0) > 0 ? "gift"
        : isActivityFreePromotion(promotion) ? "activity_free" : promotion.discount_type,
      discount_value: String(promotion.discount_value),
      gift_quantity: String(promotion.gift_quantity ?? 1),
      min_order_price: String(promotion.min_order_price),
      min_quantity: String(promotion.min_quantity),
      max_uses: promotion.max_uses === null ? "" : String(promotion.max_uses),
      description: promotion.description ?? "",
      is_public: promotion.is_public,
    });
    formSectionRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
    nameInputRef.current?.focus({ preventScroll: true });
  };

  const cancelEditing = () => {
    setEditingPromotionId(null);
    setForm(emptyForm);
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

  const deletePromotion = async (promotion: ShopPromotionOut) => {
    if (!window.confirm(`確定刪除「${promotion.name}」？此操作無法復原。`)) return;
    setDeletingPromotionId(promotion.id);
    try {
      await shopApi.deletePromotion(promotion.id);
      toast.success("優惠已刪除");
      if (editingPromotionId === promotion.id) cancelEditing();
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, "刪除優惠失敗"));
    } finally {
      setDeletingPromotionId(null);
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

  const seriesCategories = new Map(series.map((item) => [item.id, item.category_id]));
  const productCategory = (product: ProductOut) => product.category_id
    ?? (product.series_id ? seriesCategories.get(product.series_id) : undefined);
  const scopedProducts = products.filter((product) => form.target_category_ids.length === 0
    || form.target_category_ids.includes(productCategory(product) ?? ""));
  const toggleCategory = (categoryId: string) => {
    setForm((current) => {
      const ids = current.target_category_ids.includes(categoryId)
        ? current.target_category_ids.filter((id) => id !== categoryId)
        : [...current.target_category_ids, categoryId];
      const productIds = current.target_product_ids.filter((id) => ids.length === 0
        || products.some((product) => product.id === id && ids.includes(productCategory(product) ?? "")));
      return { ...current, target_category_ids: ids, target_product_ids: productIds,
        product_prices: Object.fromEntries(Object.entries(current.product_prices)
          .filter(([id]) => productIds.includes(id))) };
    });
  };
  const topicLabel = (promotion: ShopPromotionOut) => {
    const ids = promotion.target_category_ids ?? categories
      .filter((category) => category.activity_id === (promotion.activity_id ?? null))
      .map((category) => category.id);
    if (promotion.target_category_ids?.length === 0) return "不限活動";
    return ids.map((id) => categories.find((category) => category.id === id)?.name ?? "未載入的活動")
      .join("、") || "原有商品範圍";
  };

  return (
    <div className="space-y-5">
      <section ref={formSectionRef} className="card space-y-4 p-5">
        <div>
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            {editingPromotionId ? "編輯優惠" : "建立優惠"}
          </h2>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            可選擇多個活動，或不限活動。留空優惠碼即符合條件自動套用；有優惠碼時由使用者領取並套用。
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <fieldset className="sm:col-span-2" aria-describedby="promotion-topic-help">
            <legend className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              {form.discount_type === "activity_free" ? "適用活動（必填，可複選）" : "適用活動（選填，可複選）"}
            </legend>
            <p id="promotion-topic-help" className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              滿額與最低件數依各活動分開計算，不跨活動累加。指定商品優惠價可跨活動逐項設定。
            </p>
            {form.discount_type !== "activity_free" && <label className="flex min-h-11 items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={form.target_category_ids.length === 0} disabled={saving}
                onChange={() => update("target_category_ids", [])} />
              不限活動
            </label>}
            <div className="grid gap-x-4 sm:grid-cols-2">
              {categories.map((category) => (
                <label key={category.id} className="flex min-h-11 items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                  <input type="checkbox" checked={form.target_category_ids.includes(category.id)} disabled={saving}
                    onChange={() => toggleCategory(category.id)} />
                  {category.name}
                </label>
              ))}
            </div>
            {!loading && !loadError && categories.length === 0 && (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>{form.discount_type === "activity_free" ? "請先建立活動，再設定活動免費券。" : "尚未建立活動，目前可設定不限活動的優惠。"}</p>
            )}
          </fieldset>
          <label className="block text-xs font-medium sm:col-span-2" style={{ color: "var(--text-secondary)" }}>
            優惠名稱
            <input ref={nameInputRef} className="input mt-1 w-full" value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="例如：校友回饋 9 折" />
          </label>
          <div className="sm:col-span-2">
            <ShopTargetPicker label={form.discount_type === "activity_free" ? "可使用帳號（必填）" : "可使用帳號（選填）"} value={targetIdentifiers(form.target_identifiers)}
              activityId={null} disabled={saving} max={500}
              onChange={(identifiers) => update("target_identifiers", identifiers.join("\n"))}
              help={form.discount_type === "activity_free"
                ? "僅名單內帳號可用。可搜尋姓名或批次輸入學號、Email；學號可先指定，註冊後即可使用。"
                : "留空代表所有帳號可用。學號可先指定，對應帳號註冊後即可使用；Email 必須是已註冊帳號。加入名單後僅名單內帳號可用，適用自動優惠與優惠碼。"} />
          </div>
          {form.discount_type !== "activity_free" && <>
          <label className="block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            優惠碼（選填）
            <input className="input mt-1 w-full uppercase" value={form.code} onChange={(e) => update("code", e.target.value.toUpperCase())} placeholder="WELCOME10" autoCapitalize="characters" />
          </label>
          <label className="flex min-h-11 items-start gap-2 text-xs font-medium sm:col-span-2" style={{ color: "var(--text-secondary)" }}>
            <input
              className="mt-0.5"
              type="checkbox"
              checked={form.is_public}
              onChange={(event) => update("is_public", event.target.checked)}
            />
            <span>
              公開顯示優惠
              <span className="mt-1 block text-[11px] font-normal" style={{ color: "var(--text-muted)" }}>
                關閉後不會列在商品頁優惠清單；知道優惠碼的使用者仍可輸入使用。
              </span>
            </span>
          </label>
          </>}
          <label className="block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            優惠內容
            <select className="input mt-1 w-full" value={form.discount_type} onChange={(e) => update("discount_type", e.target.value as PromotionForm["discount_type"])}>
              <option value="percentage">按百分比折抵</option>
              <option value="fixed">固定金額折抵</option>
              <option value="price_override">指定商品優惠價</option>
              <option value="bundle_price">商品套組組合價</option>
              <option value="gift">贈票／免費商品</option>
              <option value="activity_free">活動免費券（全品項、不限次數）</option>
            </select>
          </label>
          {form.discount_type === "activity_free" ? (
            <p className="self-center text-xs" style={{ color: "var(--text-secondary)" }}>
              指定帳號在所選活動每次購買都自動全免，包含所有數量與規格加價，也適用日後新增的商品。不需輸入優惠碼，不限使用次數。
            </p>
          ) : form.discount_type === "gift" ? (
            <label className="block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              每項贈送數量
              <input className="input mt-1 w-full" type="number" min="1" max="100" step="1"
                value={form.gift_quantity} onChange={(e) => update("gift_quantity", e.target.value)} />
              <span className="mt-1 block font-normal">每個指定商品各贈送此件數；可加購多件，超出件數與規格加價照常計費。</span>
            </label>
          ) : form.discount_type !== "price_override" ? (
            <label className="block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              {form.discount_type === "percentage" ? "折抵百分比（%）" : form.discount_type === "bundle_price" ? "每套組合價（NT$）" : "折抵金額"}
              <input className="input mt-1 w-full" type="number" min="1" max={form.discount_type === "percentage" ? 100 : undefined} value={form.discount_value} onChange={(e) => update("discount_value", e.target.value)} />
              {form.discount_type === "percentage" && <span className="mt-1 block font-normal">例如填 10，表示減價 10%，也就是打 9 折。</span>}
              {form.discount_type === "bundle_price" && <span className="mt-1 block font-normal">所選商品各一件為一套；完整套數重複優惠，未成套商品與規格加價另計。</span>}
            </label>
          ) : (
            <p className="self-center text-xs" style={{ color: "var(--text-muted)" }}>
              為下方選擇的商品逐項設定優惠後單價；規格加價會照常計入。
            </p>
          )}
          {form.discount_type !== "activity_free" && <>
          <label className="block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            每個活動最低消費（選填）
            <input className="input mt-1 w-full" type="number" min="0" value={form.min_order_price} onChange={(e) => update("min_order_price", e.target.value)} />
          </label>
          <label className="block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            最低件數
            <input className="input mt-1 w-full" type="number" min="1" max="100" value={form.min_quantity} onChange={(e) => update("min_quantity", e.target.value)} />
            <span className="mt-1 block text-[11px]" style={{ color: "var(--text-muted)" }}>
              各活動分開計算，只計下方指定商品；未指定商品時以該活動的登記件數計算。
            </span>
          </label>
          <fieldset className="sm:col-span-2">
            <legend className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>適用商品（可複選）</legend>
            <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
              {form.discount_type === "gift"
                ? "請選擇要贈送的票券或商品。多選時需同時登記所有指定商品，各項依上方件數贈送；受贈者自行選規格，贈品與加購品項會分開列出。"
                : form.discount_type === "price_override"
                ? "使用者任選一項已設定商品即可使用；只有實際登記的指定商品會改用優惠單價。"
                : form.discount_type === "bundle_price"
                  ? "選擇至少兩項商品，例如衣服 + 褲子。每項各一件為一套，學生可分別選擇尺寸、顏色。"
                : "折扣只計指定品項，最低消費門檻看整筆登記金額。多選時每項都需登記，最低件數為指定商品合計；只選一項可設定單品買滿件數優惠。"}
            </p>
            <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
              草稿與已下架商品也會列出，方便預先設定；商品上架且符合優惠條件後，使用者才可使用。
            </p>
            <div className="mt-2 grid max-h-48 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2" style={{ borderColor: "var(--border)" }}>
              {scopedProducts.length === 0 ? (
                <p className="p-2 text-xs" style={{ color: "var(--text-muted)" }}>所選活動目前沒有可選商品；未指定商品時，優惠適用於所選活動日後新增的商品。</p>
              ) : scopedProducts.map((product) => (
                <label key={product.id} className="flex min-h-10 items-center gap-2 rounded-md px-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                  <input type="checkbox" checked={form.target_product_ids.includes(product.id)} onChange={() => toggleProduct(product.id)} />
                  <span>{product.name}{productCategory(product) && (
                    <span className="ml-2" style={{ color: "var(--text-muted)" }}>
                      {categories.find((category) => category.id === productCategory(product))?.name}
                    </span>
                  )}</span>
                  <span
                    className="ml-auto whitespace-nowrap rounded px-1.5 py-0.5 text-[10px]"
                    style={{
                      background: product.status === "active" ? "var(--success-dim)" : "var(--bg-elevated)",
                      color: product.status === "active" ? "var(--success)" : "var(--text-muted)",
                    }}
                  >
                    {PRODUCT_STATUS_LABEL[product.status]}
                  </span>
                </label>
              ))}
            </div>
            {form.discount_type === "price_override" && form.target_product_ids.length > 0 && (
              <div className="mt-3 space-y-2">
                {scopedProducts
                  .filter((product) => form.target_product_ids.includes(product.id))
                  .map((product) => (
                    <div
                      key={product.id}
                      className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <div>
                        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{product.name}</p>
                        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                          目前單價 NT${product.price.toLocaleString()}
                        </p>
                      </div>
                      <label className="flex min-h-11 items-center gap-2 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                        優惠後單價
                        <span>NT$</span>
                        <input
                          className="input w-32"
                          type="number"
                          min="0"
                          max={Math.max(0, product.price - 1)}
                          step="1"
                          inputMode="numeric"
                          aria-label={`${product.name} 優惠後單價`}
                          value={form.product_prices[product.id] ?? ""}
                          placeholder={String(product.price)}
                          onChange={(event) => update("product_prices", {
                            ...form.product_prices,
                            [product.id]: event.target.value,
                          })}
                        />
                      </label>
                    </div>
                  ))}
              </div>
            )}
          </fieldset>
          <label className="block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            使用次數上限（選填）
            <input className="input mt-1 w-full" type="number" min="1" value={form.max_uses} onChange={(e) => update("max_uses", e.target.value)} placeholder="不限次數" />
          </label>
          </>}
          <label className="block text-xs font-medium sm:col-span-2" style={{ color: "var(--text-secondary)" }}>
            備註（選填）
            <input className="input mt-1 w-full" value={form.description} onChange={(e) => update("description", e.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn min-h-11" onClick={save} disabled={saving || deletingPromotionId !== null} style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
            {saving ? "儲存中…" : editingPromotionId ? "儲存變更" : "建立優惠"}
          </button>
          {editingPromotionId && (
            <button className="btn btn-ghost min-h-11" onClick={cancelEditing} disabled={saving || deletingPromotionId !== null}>
              取消編輯
            </button>
          )}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>優惠清單</h2>
        </div>
        {loading ? (
          <p className="p-5 text-sm" style={{ color: "var(--text-muted)" }}>載入中…</p>
        ) : loadError ? (
          <div role="alert" className="p-5 text-sm" style={{ color: "var(--danger)" }}>
            <p>{loadError}</p><button type="button" className="btn btn-ghost min-h-11" onClick={() => void load()}>重新載入優惠</button>
          </div>
        ) : promotions.length === 0 ? (
          <p className="p-5 text-sm" style={{ color: "var(--text-muted)" }}>尚未建立優惠。</p>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {promotions.map((promotion) => {
              const targetUsers = promotion.target_users ?? [];
              const targetLabel = targetUsers.length > 0
                ? targetUsers.map((user) => {
                  if (user.student_id) {
                    return user.email
                      ? `${user.email}（學號 ${user.student_id}）`
                      : `學號 ${user.student_id}`;
                  }
                  return user.email ?? "指定帳號";
                }).join("、")
                : promotion.target_email || "所有可使用帳號";
              const benefitLabel = isActivityFreePromotion(promotion)
                ? "活動免費券 · 全品項與規格加價全免 · 不限次數"
                : promotion.discount_type === "price_override"
                ? (promotion.product_price_overrides ?? [])
                  .map((price) => `${price.product_name} NT$${price.unit_price.toLocaleString()}`)
                  .join("、")
                : promotion.discount_type === "bundle_price"
                  ? `每套 NT$${promotion.discount_value.toLocaleString()}`
                : promotion.discount_type === "percentage"
                  ? promotion.discount_value === 100 && (promotion.target_products?.length ?? 0) > 0
                    ? `每項贈送 ${promotion.gift_quantity ?? 1} 件（可加購，規格加價自付）` : `減價 ${promotion.discount_value}%`
                  : `折抵 NT$${promotion.discount_value.toLocaleString()}`;
              return (
                <div key={promotion.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium" style={{ color: "var(--text-primary)" }}>{promotion.name}</p>
                      <span className="rounded-md px-2 py-1 text-[11px]" style={{ background: promotion.is_active ? "var(--success-dim)" : "var(--bg-elevated)", color: promotion.is_active ? "var(--success)" : "var(--text-muted)" }}>
                        {promotion.is_active ? "啟用中" : "已停用"}
                      </span>
                      <span className="rounded-md px-2 py-1 text-[11px]" style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                        {promotion.is_public ? "公開" : "隱藏"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                      {promotion.code ? `優惠碼 ${promotion.code}` : "符合條件自動套用"} · 適用：{topicLabel(promotion)} · {targetLabel} · {benefitLabel}
                    </p>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                      {promotion.min_order_price > 0 ? `滿 NT$${promotion.min_order_price.toLocaleString()} · ` : ""}
                      {promotion.min_quantity > 1 ? `滿 ${promotion.min_quantity} 件 · ` : ""}
                      {promotion.target_products?.length
                        ? promotion.target_products.map((product) => product.name).join(" + ")
                        : "全品項"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                    {promotion.is_active && (
                      <button className="btn btn-ghost min-h-11 text-xs" onClick={() => deactivate(promotion)} disabled={saving || deletingPromotionId !== null}>
                        停用
                      </button>
                    )}
                    <button className="btn btn-ghost min-h-11 text-xs" onClick={() => editPromotion(promotion)} disabled={saving || deletingPromotionId !== null}>
                      編輯
                    </button>
                    {promotion.used_count === 0 ? (
                      <button
                        className="btn btn-ghost min-h-11 text-xs"
                        onClick={() => deletePromotion(promotion)}
                        disabled={saving || deletingPromotionId !== null}
                        style={{ color: "var(--danger)" }}
                      >
                        {deletingPromotionId === promotion.id ? "刪除中…" : "刪除"}
                      </button>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        已使用 {promotion.used_count} 次，請停用以保留訂單紀錄
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
