"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { toast } from "sonner";
import { apiErrorMessage, shopApi } from "@/lib/api";
import { orderScopeKey, orderScopeParams } from "@/lib/shop-order-scope";
import type { OrderOut, ShopDelegationContextOut, ShopPromotionPublicOut } from "@/lib/types";

type RegistrationOptions = {
  delegationToken: string | null;
  delegationContext: ShopDelegationContextOut | null;
  classMemberUserId: string | null;
  classMemberReady: boolean;
  isLoggedIn: boolean;
  authLoading: boolean;
  canOrderForSelf: boolean;
  registrations: OrderOut[];
  setRegistrations: Dispatch<SetStateAction<OrderOut[]>>;
  scopeKey: string;
  productId: string | null;
  testingProduct: boolean;
  availablePromotions: ShopPromotionPublicOut[];
  couponCode: string;
  selectedPromotionScope: string;
  refreshGeneration: MutableRefObject<number>;
  mutationBusy: MutableRefObject<boolean>;
  onClassMemberReady: () => void;
  onQualifiedPromotions: (ids: string[]) => void;
};

class SupersededRegistration extends Error {}

function registrationView(options: RegistrationOptions) {
  const orders = options.registrations.filter((order) =>
    !order.test_product_id && orderScopeKey(order) === options.scopeKey);
  const scopeRegistration = options.classMemberUserId
    ? aggregateRegistrationOrders(orders) : orders[0] ?? null;
  const productRegistration = options.testingProduct
    ? options.registrations.find((order) => order.test_product_id === options.productId) ?? null
    : scopeRegistration;
  const registration = productRegistration ? {
    ...productRegistration,
    items: options.classMemberUserId ? productRegistration.items : productRegistration.items.filter((item) =>
      (item.delegation_link_id ?? null) === (options.delegationToken ? options.delegationContext?.link.id : null)),
  } : null;
  const lockedVariantQuantities = new Map<string, number>();
  if (options.classMemberUserId) {
    for (const order of orders) {
      if (!order.is_paid && !order.is_class_collected) continue;
      for (const item of order.items) {
        if (item.product_id !== options.productId) continue;
        const key = item.selected_options.map((option) => option.option_id).sort().join(",");
        lockedVariantQuantities.set(key, (lockedVariantQuantities.get(key) ?? 0) + item.quantity);
      }
    }
  }
  const registrationLocked = Boolean(
    (options.delegationToken && !options.delegationContext?.can_edit)
    || (!options.classMemberUserId && productRegistration
      && (productRegistration.is_paid || productRegistration.is_class_collected)),
  );
  return { scopeRegistration, registration, lockedVariantQuantities, registrationLocked };
}

/** Owns the complete write protocol; callers never pair identity routes and response callbacks. */
export function useShopRegistration(options: RegistrationOptions) {
  const current = useRef(options);
  current.current = options;
  const identity = useMemo(() => ({
    delegationToken: options.delegationToken, classMemberUserId: options.classMemberUserId,
  }), [options.delegationToken, options.classMemberUserId]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const activeMutation = useRef(0);
  const mounted = useRef(true);
  const [feedback, setFeedback] = useState<{ identity: typeof identity; message: string } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; current.current.refreshGeneration.current += 1; };
  }, []);

  const getProduct = useCallback(async (id: string) => {
    const token = identity.delegationToken;
    const product = await (token ? shopApi.getDelegationProduct(token, id) : shopApi.getProduct(id));
    if (!mounted.current || currentIdentity.current !== identity) throw new SupersededRegistration();
    return product;
  }, [identity]);

  async function transact<T>(snapshot: RegistrationOptions, task: (
    assertCurrent: () => void,
    commit: (update: (orders: OrderOut[]) => OrderOut[]) => void,
    note: (message: string) => void,
  ) => Promise<T>): Promise<T | null> {
    const actor = currentIdentity.current;
    const generation = ++snapshot.refreshGeneration.current;
    const mutation = ++activeMutation.current;
    snapshot.mutationBusy.current = true;
    const isCurrent = () => mounted.current && currentIdentity.current === actor
      && snapshot.refreshGeneration.current === generation;
    const assertCurrent = () => { if (!isCurrent()) throw new SupersededRegistration(); };
    const commit = (update: (orders: OrderOut[]) => OrderOut[]) => {
      assertCurrent();
      // A bundle can start its coupon step before React has rendered the saved
      // order. Keep the accepted snapshot current for that next operation too.
      const registrations = update(current.current.registrations);
      current.current = { ...current.current, registrations };
      snapshot.setRegistrations(registrations);
    };
    const note = (message: string) => { assertCurrent(); setFeedback({ identity: actor, message }); };
    try {
      return await task(assertCurrent, commit, note);
    } catch (error) {
      if (!isCurrent() || error instanceof SupersededRegistration) return null;
      throw error;
    } finally {
      if (activeMutation.current === mutation) snapshot.mutationBusy.current = false;
    }
  }

  async function inspectPromotion(
    snapshot: RegistrationOptions, code: string | null, scopeKey: string,
    assertCurrent: () => void, commit: (update: (orders: OrderOut[]) => OrderOut[]) => void,
    note: (message: string) => void, ineligibleMessage: string,
  ) {
    const scope = orderScopeParams(scopeKey);
    const preview = await (snapshot.delegationToken
      ? shopApi.previewDelegationPromotion(snapshot.delegationToken, code)
      : shopApi.previewCurrentPromotion(code, scope.activity_id ?? null, scope.category_id));
    assertCurrent();
    if (!preview.eligible) { note(preview.reason ?? ineligibleMessage); return; }
    const updated = await (snapshot.delegationToken
      ? shopApi.applyDelegationPromotion(snapshot.delegationToken, code)
      : shopApi.applyCurrentPromotion(code, scope.activity_id ?? null, scope.category_id));
    assertCurrent();
    commit((orders) => [
      ...orders.filter((order) => order.test_product_id || orderScopeKey(order) !== scopeKey), updated,
    ]);
    note(preview.reason ?? "優惠已套用。");
  }

  async function saveVariant(productId: string, optionIds: string[], quantity: number) {
    const snapshot = current.current;
    if (!mounted.current || snapshot.productId !== productId) return null;
    const view = registrationView(snapshot);
    const authorized = snapshot.classMemberUserId ? snapshot.classMemberReady
      : snapshot.delegationToken ? snapshot.delegationContext?.can_edit
        : snapshot.canOrderForSelf || snapshot.testingProduct;
    if (!snapshot.isLoggedIn || snapshot.authLoading || !authorized || view.registrationLocked) {
      throw new Error("目前無法修改這份商品登記，請重新確認登入與授權。");
    }
    const key = [...optionIds].sort().join(",");
    if (quantity < (view.lockedVariantQuantities.get(key) ?? 0)) {
      throw new Error("已收款或鎖定的登記數量必須保留。");
    }
    const variants = new Map<string, { option_ids: string[]; quantity: number }>();
    for (const item of view.registration?.items ?? []) {
      if (item.product_id !== productId) continue;
      const ids = item.selected_options.map((option) => option.option_id).sort();
      const variant = ids.join(",");
      variants.set(variant, { option_ids: ids, quantity: (variants.get(variant)?.quantity ?? 0) + item.quantity });
    }
    const wasRegistered = (variants.get(key)?.quantity ?? 0) > 0;
    variants.delete(key);
    if (quantity > 0) variants.set(key, { option_ids: [...optionIds].sort(), quantity });

    return transact(snapshot, async (assertCurrent, commit, note) => {
      const body = { variants: [...variants.values()] };
      if (snapshot.classMemberUserId) {
        const orders = await shopApi.setClassMemberProduct(snapshot.classMemberUserId, productId, body);
        assertCurrent();
        commit(() => orders);
        snapshot.onClassMemberReady();
      } else {
        const updated = await (snapshot.delegationToken
          ? shopApi.setDelegationProduct(snapshot.delegationToken, productId, body)
          : shopApi.setCurrentRegistrationProduct(productId, body));
        assertCurrent();
        const order = updated?.status === "cancelled" ? null : updated;
        if (snapshot.testingProduct) {
          commit((orders) => [...orders.filter((existing) => existing.test_product_id !== productId), ...(order ? [order] : [])]);
        } else {
          const scope = orderScopeParams(snapshot.scopeKey);
          const previous = snapshot.registrations.find((existing) =>
            !existing.test_product_id && orderScopeKey(existing) === snapshot.scopeKey) ?? null;
          if (order) snapshot.onQualifiedPromotions(snapshot.availablePromotions
            .filter((promotion) => (promotion.activity_id ?? null) === (scope.activity_id ?? null))
            .filter((promotion) => !promotionRequirementsMet(promotion, previous) && promotionRequirementsMet(promotion, order))
            .map((promotion) => promotion.id));
          commit((orders) => [
            ...orders.filter((existing) => existing.test_product_id || orderScopeKey(existing) !== snapshot.scopeKey),
            ...(order ? [order] : []),
          ]);
          const code = snapshot.couponCode.trim();
          if (order && snapshot.scopeKey === snapshot.selectedPromotionScope && code
            && order.promotion_code?.toUpperCase() !== code.toUpperCase()) {
            try {
              await inspectPromotion(snapshot, code, snapshot.scopeKey, assertCurrent, commit, note,
                "商品已更新，優惠仍未達使用條件。");
            } catch (error) {
              assertCurrent();
              note(apiErrorMessage(error, "優惠檢查失敗"));
            }
          }
        }
      }
      return { added: !snapshot.classMemberUserId && quantity > 0 && !wasRegistered };
    });
  }

  async function applyPromotion(code: string | null, scopeKey = current.current.selectedPromotionScope) {
    const snapshot = current.current;
    const note = (message: string) => setFeedback({ identity: currentIdentity.current, message });
    if (snapshot.classMemberUserId) { note("班代調整商品總量時不會變更學生的優惠設定。"); return; }
    if (!snapshot.isLoggedIn || snapshot.authLoading) { note("登入後登記商品即可使用這項優惠。"); return; }
    if (snapshot.delegationToken && !snapshot.delegationContext?.can_edit) {
      note("目前無法修改這份商品登記，請重新確認登入與授權。");
      return;
    }
    const order = snapshot.registrations.find((row) => !row.test_product_id && orderScopeKey(row) === scopeKey);
    if (!order) {
      note(code ? "優惠碼已帶入；登記符合條件的商品後即可檢查並套用。" : "先登記商品；符合條件時系統會自動套用優惠。");
      return;
    }
    if (order.is_paid || order.is_class_collected) { note("目前登記已鎖定，如需更改優惠請聯繫班級幹部。"); return; }
    await transact(snapshot, async (assertCurrent, commit, feedback) => {
      feedback("");
      try {
        await inspectPromotion(snapshot, code, scopeKey, assertCurrent, commit, feedback, "目前尚未符合優惠條件。");
      } catch (error) {
        assertCurrent();
        const message = apiErrorMessage(error, "優惠套用失敗");
        feedback(message);
        toast.error(message);
      }
    });
  }

  return {
    ...registrationView(options), getProduct, saveVariant, applyPromotion,
    promotionFeedback: feedback?.identity === identity ? feedback.message : "",
  };
}

function aggregateRegistrationOrders(orders: OrderOut[]): OrderOut | null {
  if (orders.length === 0) return null;
  const first = orders[0];
  return {
    ...first,
    subtotal_price: orders.reduce((total, order) => total + order.subtotal_price, 0),
    discount_amount: orders.reduce((total, order) => total + order.discount_amount, 0),
    total_price: orders.reduce((total, order) => total + order.total_price, 0),
    is_paid: orders.every((order) => order.is_paid),
    is_class_collected: orders.every((order) => order.is_class_collected),
    items: orders.flatMap((order) => order.items),
    applied_promotions: orders.flatMap((order) => order.applied_promotions ?? []),
  };
}

function promotionRequirementsMet(
  promotion: ShopPromotionPublicOut,
  registration: OrderOut | null,
) {
  if (!registration) return false;

  const targets = promotion.target_products ?? [];
  const targetIds = new Set(targets.map((product) => product.id));
  const registeredProducts = new Set(registration.items.map((item) => item.product_id));
  const matchingQuantity = registration.items.reduce((total, item) => (
    targetIds.size === 0 || targetIds.has(item.product_id) ? total + item.quantity : total
  ), 0);
  const productRequirementMet = promotion.discount_type === "price_override"
    ? targets.some((product) => registeredProducts.has(product.id))
    : targets.every((product) => registeredProducts.has(product.id));

  return productRequirementMet
    && matchingQuantity >= promotion.min_quantity
    && registration.subtotal_price >= promotion.min_order_price;
}
