"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { apiErrorMessage, shopApi } from "@/lib/api";
import type { ShopDiscountType, ShopPromotionOut } from "@/lib/types";

const emptyForm = {
  name: "",
  target_email: "",
  code: "",
  discount_type: "percentage" as ShopDiscountType,
  discount_value: "10",
  min_order_price: "0",
  max_uses: "",
  description: "",
};

export default function ShopPromotionPanel() {
  const [promotions, setPromotions] = useState<ShopPromotionOut[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPromotions(await shopApi.listPromotions());
    } catch (error) {
      toast.error(apiErrorMessage(error, "載入優惠失敗"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!form.name.trim()) {
      toast.error("請輸入優惠名稱");
      return;
    }
    if (!form.code.trim() && !form.target_email.trim()) {
      toast.error("請填寫指定帳號或優惠碼");
      return;
    }
    setSaving(true);
    try {
      await shopApi.createPromotion({
        name: form.name.trim(),
        target_email: form.target_email.trim() || null,
        code: form.code.trim().toUpperCase() || null,
        discount_type: form.discount_type,
        discount_value: Number(form.discount_value),
        min_order_price: Number(form.min_order_price) || 0,
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

  const update = <K extends keyof typeof emptyForm>(key: K, value: (typeof emptyForm)[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="space-y-5">
      <section className="card space-y-4 p-5">
        <div>
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>建立優惠</h2>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            指定帳號會在登入後自動套用；填寫優惠碼則可讓使用者在結帳時輸入。兩者可同時設定。
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium sm:col-span-2" style={{ color: "var(--text-secondary)" }}>
            優惠名稱
            <input className="input mt-1 w-full" value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="例如：校友回饋 9 折" />
          </label>
          <label className="block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            指定帳號 Email（選填）
            <input className="input mt-1 w-full" value={form.target_email} onChange={(e) => update("target_email", e.target.value)} placeholder="buyer@example.com" inputMode="email" />
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
            使用次數上限（選填）
            <input className="input mt-1 w-full" type="number" min="1" value={form.max_uses} onChange={(e) => update("max_uses", e.target.value)} placeholder="不限次數" />
          </label>
          <label className="block text-xs font-medium sm:col-span-2" style={{ color: "var(--text-secondary)" }}>
            備註（選填）
            <input className="input mt-1 w-full" value={form.description} onChange={(e) => update("description", e.target.value)} />
          </label>
        </div>
        <button className="btn" onClick={create} disabled={saving} style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
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
            {promotions.map((promotion) => (
              <div key={promotion.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium" style={{ color: "var(--text-primary)" }}>{promotion.name}</p>
                    <span className="rounded-md px-2 py-1 text-[11px]" style={{ background: promotion.is_active ? "var(--success-dim)" : "var(--bg-elevated)", color: promotion.is_active ? "var(--success)" : "var(--text-muted)" }}>
                      {promotion.is_active ? "啟用中" : "已停用"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {promotion.code ? `優惠碼 ${promotion.code}` : "登入後自動套用"} · {promotion.target_email || "所有可使用帳號"} · {promotion.discount_type === "percentage" ? `${promotion.discount_value}% off` : `折抵 NT$${promotion.discount_value.toLocaleString()}`}
                  </p>
                </div>
                {promotion.is_active && <button className="btn btn-ghost shrink-0 self-start text-xs sm:self-auto" onClick={() => deactivate(promotion)}>停用</button>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
