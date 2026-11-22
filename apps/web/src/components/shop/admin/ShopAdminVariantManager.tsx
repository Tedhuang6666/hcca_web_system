"use client";

import { useState } from "react";
import { toast } from "sonner";
import { shopApi, apiErrorMessage } from "@/lib/api";
import type { ProductOut, ProductVariantGroupOut, ProductVariantOptionOut } from "@/lib/types";
import type { SmartSourceGroup } from "@/lib/shop-admin-options";
import { confirmAction } from "@/components/ui/ConfirmDialog";
import { MiniBtn } from "@/components/shop/admin/ShopAdminFormFields";
import { productGallery } from "@/lib/shop-product-media";
import { OptionModal, SmartOptionsModal, VariantGroupModal, VariantOptionList } from "@/components/shop/admin/ShopAdminVariantModals";

export function VariantManager({
  product,
  allProducts,
  onChanged,
}: {
  product: ProductOut;
  allProducts: ProductOut[];
  onChanged: () => void;
}) {
  const [optionModal, setOptionModal] = useState<{
    groupId: string;
    option: ProductVariantOptionOut | null;
    sortOrder: number;
  } | null>(null);
  const [groupModal, setGroupModal] = useState<ProductVariantGroupOut | null | "new">(null);
  const [smartTarget, setSmartTarget] = useState<ProductVariantGroupOut | null>(null);
  const [savingOptionOrder, setSavingOptionOrder] = useState(false);
  const sourceProducts = [
    product,
    ...allProducts.filter((sourceProduct) => sourceProduct.id !== product.id),
  ];
  const sourceGroups: SmartSourceGroup[] = sourceProducts.flatMap((sourceProduct) =>
    sourceProduct.variant_groups.map((group) => ({
      ...group,
      source_label: sourceProduct.id === product.id ? product.name : sourceProduct.name,
    }))
  );

  const removeGroup = async (g: ProductVariantGroupOut) => {
    if (!(await confirmAction({ title: `確定刪除規格類別「${g.name}」？`, danger: true }))) return;
    try {
      await shopApi.deleteVariantGroup(g.id);
      onChanged();
    } catch (e) {
      toast.error(apiErrorMessage(e, "刪除失敗"));
    }
  };

  const removeOption = async (o: ProductVariantOptionOut) => {
    try {
      await shopApi.deleteVariantOption(o.id);
      onChanged();
    } catch (e) {
      toast.error(apiErrorMessage(e, "刪除失敗"));
    }
  };

  const saveOptionOrder = async (options: ProductVariantOptionOut[]) => {
    setSavingOptionOrder(true);
    try {
      const results = await Promise.allSettled(
        options.map((option, sortOrder) =>
          shopApi.updateVariantOption(option.id, { sort_order: sortOrder })
        )
      );
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") {
        toast.error(apiErrorMessage(failed.reason, "部分選項順序未儲存，請再試一次"));
        onChanged();
        return false;
      }
      toast.success("選項順序已更新");
      onChanged();
      return true;
    } finally {
      setSavingOptionOrder(false);
    }
  };

  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          規格類別（{product.variant_groups.length}）
        </p>
        <MiniBtn
          tone="primary"
          disabled={savingOptionOrder}
          onClick={() => setGroupModal("new")}
        >
          + 新增規格類別
        </MiniBtn>
      </div>
      {product.variant_groups.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          尚未設定規格
        </p>
      ) : (
        product.variant_groups.map((g) => (
          <div key={g.id} className="rounded-lg p-3 space-y-2"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{g.name}</p>
              <div className="flex flex-wrap gap-1.5">
                <MiniBtn tone="primary" disabled={savingOptionOrder} onClick={() => setSmartTarget(g)}>
                  批次新增選項
                </MiniBtn>
                <MiniBtn disabled={savingOptionOrder} onClick={() => setGroupModal(g)}>
                  編輯
                </MiniBtn>
                <MiniBtn tone="danger" disabled={savingOptionOrder} onClick={() => removeGroup(g)}>
                  刪除
                </MiniBtn>
              </div>
            </div>
            <VariantOptionList
              options={g.options}
              disabled={savingOptionOrder}
              onReorder={saveOptionOrder}
              onEdit={(option) => setOptionModal({
                groupId: g.id,
                option,
                sortOrder: option.sort_order,
              })}
              onDelete={removeOption}
              onAdd={() => setOptionModal({
                groupId: g.id,
                option: null,
                sortOrder: Math.max(-1, ...g.options.map((option) => option.sort_order)) + 1,
              })}
            />
            {savingOptionOrder && (
              <p role="status" className="text-xs" style={{ color: "var(--text-secondary)" }}>
                正在儲存規格選項順序…
              </p>
            )}
          </div>
        ))
      )}
      {optionModal && (
        <OptionModal
          groupId={optionModal.groupId}
          initial={optionModal.option}
          sortOrder={optionModal.sortOrder}
          photos={productGallery(product)}
          onClose={() => setOptionModal(null)}
          onSaved={() => { setOptionModal(null); onChanged(); }}
        />
      )}
      {groupModal && (
        <VariantGroupModal
          productId={product.id}
          initial={groupModal === "new" ? null : groupModal}
          sourceGroups={sourceGroups}
          onClose={() => setGroupModal(null)}
          onSaved={() => { setGroupModal(null); onChanged(); }}
        />
      )}
      {smartTarget && (
        <SmartOptionsModal
          target={smartTarget}
          sourceGroups={sourceGroups}
          onClose={() => setSmartTarget(null)}
          onSaved={() => { setSmartTarget(null); onChanged(); }}
        />
      )}
    </div>
  );
}
