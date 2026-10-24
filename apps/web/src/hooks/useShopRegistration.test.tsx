import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { OrderOut, ShopDelegationContextOut } from "@/lib/types";
import { useShopRegistration } from "./useShopRegistration";

const api = vi.hoisted(() => ({
  getProduct: vi.fn(), getDelegationProduct: vi.fn(), setCurrentRegistrationProduct: vi.fn(),
  setDelegationProduct: vi.fn(), setClassMemberProduct: vi.fn(),
  previewCurrentPromotion: vi.fn(), previewDelegationPromotion: vi.fn(),
  applyCurrentPromotion: vi.fn(), applyDelegationPromotion: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (error: Error) => error.message }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const order: OrderOut = {
  id: "order", user_id: "student", activity_id: "activity", status: "pending", serial_number: "ORDER",
  assistance_scope: "self", payment_method: "school_collection", created_at: "2026-10-10", updated_at: "2026-10-10",
  subtotal_price: 300, discount_amount: 0, total_price: 300, is_paid: false, is_class_collected: false,
  items: [{ id: "own", product_id: "shirt", product_name: "衣服", quantity: 1,
    unit_price: 100, subtotal: 100, selected_options: [], delegation_link_id: null },
  { id: "parent", product_id: "shirt", product_name: "衣服", quantity: 2,
    unit_price: 100, subtotal: 200, selected_options: [], delegation_link_id: "parent-link" }],
};
const context = {
  link: { id: "parent-link" }, can_edit: true,
} as ShopDelegationContextOut;
type Options = Parameters<typeof useShopRegistration>[0];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(overrides: Partial<Options> = {}) {
  const options: Options = {
    delegationToken: null, delegationContext: null, classMemberUserId: null, classMemberReady: true,
    isLoggedIn: true, authLoading: false, canOrderForSelf: true,
    registrations: [order], setRegistrations: vi.fn(), scopeKey: "activity", productId: "shirt", testingProduct: false,
    availablePromotions: [], couponCode: "", selectedPromotionScope: "activity",
    refreshGeneration: { current: 0 }, mutationBusy: { current: false },
    onClassMemberReady: vi.fn(), onQualifiedPromotions: vi.fn(), ...overrides,
  };
  const hook = renderHook((actor: Partial<Options>) => {
    const [orders, setOrders] = useState(options.registrations);
    return { ...useShopRegistration({ ...options, ...actor, registrations: orders, setRegistrations: setOrders }), orders };
  }, { initialProps: {} as Partial<Options> });
  return { ...hook, options };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.setCurrentRegistrationProduct.mockResolvedValue(order);
  api.setDelegationProduct.mockResolvedValue(order);
  api.setClassMemberProduct.mockResolvedValue([order]);
  api.previewCurrentPromotion.mockResolvedValue({ eligible: true });
  api.applyCurrentPromotion.mockResolvedValue(order);
});

it("owns source selection for both the editable view and the submitted variants", async () => {
  const { result, rerender } = setup();
  expect(result.current.registration?.items.map((item) => item.id)).toEqual(["own"]);
  await act(async () => { await result.current.saveVariant("shirt", [], 3); });
  expect(api.setCurrentRegistrationProduct).toHaveBeenCalledWith("shirt", { variants: [{ option_ids: [], quantity: 3 }] });
  rerender({ delegationToken: "parent-token", delegationContext: context });
  expect(result.current.registration?.items.map((item) => item.id)).toEqual(["parent"]);
  await act(async () => { await result.current.saveVariant("shirt", [], 4); });
  expect(api.setDelegationProduct).toHaveBeenCalledWith("parent-token", "shirt", { variants: [{ option_ids: [], quantity: 4 }] });
  expect(result.current.scopeRegistration?.items).toHaveLength(2);
});

it("preserves collected quantities and uses the classmate response without changing their promotions", async () => {
  const paid = { ...order, id: "paid", is_paid: true, items: [order.items[0]] };
  const { result } = setup({ registrations: [paid, order], classMemberUserId: "student", couponCode: "SAVE" });
  await expect(result.current.saveVariant("shirt", [], 0)).rejects.toThrow("已收款或鎖定");
  expect(api.setClassMemberProduct).not.toHaveBeenCalled();
  api.setClassMemberProduct.mockResolvedValue([paid]);
  await act(async () => { await result.current.saveVariant("shirt", [], 1); });
  expect(result.current.orders).toEqual([paid]);
  expect(api.setClassMemberProduct).toHaveBeenCalledWith("student", "shirt", { variants: [{ option_ids: [], quantity: 1 }] });
  expect(api.previewCurrentPromotion).not.toHaveBeenCalled();
  expect(api.setCurrentRegistrationProduct).not.toHaveBeenCalled();
});

it("preserves sibling variants, other activities and test orders when replacing a registration", async () => {
  const selected = (id: string) => [{ group_id: "size", group_name: "尺寸", option_id: id, value: id, price_delta: 0 }];
  const variants: OrderOut = { ...order, items: [
    { ...order.items[0], id: "medium", selected_options: selected("M") },
    { ...order.items[0], id: "large", quantity: 2, selected_options: selected("L") },
    order.items[1],
  ] };
  const other = { ...order, id: "other-activity", activity_id: "other" };
  const testing = { ...order, id: "trial", test_product_id: "trial-product" };
  const { result } = setup({ registrations: [variants, other, testing] });
  await act(async () => { await result.current.saveVariant("shirt", ["M"], 4); });
  expect(api.setCurrentRegistrationProduct).toHaveBeenCalledWith("shirt", {
    variants: [{ option_ids: ["L"], quantity: 2 }, { option_ids: ["M"], quantity: 4 }],
  });
  expect(result.current.orders.map((row) => row.id)).toEqual(["other-activity", "trial", "order"]);
});

it("rejects an old identity's saved response and accepts a later write for the current identity", async () => {
  const old = deferred<OrderOut>();
  api.setDelegationProduct.mockReturnValueOnce(old.promise);
  const { result, rerender, options } = setup({ delegationToken: "old-token", delegationContext: context });
  let save!: ReturnType<typeof result.current.saveVariant>;
  act(() => { save = result.current.saveVariant("shirt", [], 8); });
  rerender({ delegationToken: "new-token", delegationContext: context });
  await act(async () => { old.resolve({ ...order, total_price: 800 }); expect(await save).toBeNull(); });
  expect(result.current.orders[0].total_price).toBe(300);
  expect(options.onQualifiedPromotions).not.toHaveBeenCalled();
  await act(async () => { await result.current.saveVariant("shirt", [], 3); });
  expect(api.setDelegationProduct).toHaveBeenLastCalledWith("new-token", "shirt", expect.anything());
});

it("does not apply a promotion after its preview belongs to a previous identity", async () => {
  const preview = deferred<{ eligible: boolean }>();
  api.previewCurrentPromotion.mockReturnValue(preview.promise);
  const { result, rerender } = setup();
  let apply!: Promise<void>;
  act(() => { apply = result.current.applyPromotion("SAVE"); });
  await waitFor(() => expect(api.previewCurrentPromotion).toHaveBeenCalledOnce());
  rerender({ delegationToken: "parent-token", delegationContext: context });
  await act(async () => { preview.resolve({ eligible: true }); await apply; });
  expect(api.applyCurrentPromotion).not.toHaveBeenCalled();
  expect(api.applyDelegationPromotion).not.toHaveBeenCalled();
  expect(result.current.promotionFeedback).toBe("");
});

it("can apply a bundle coupon immediately after its first save without waiting for a render", async () => {
  const { result } = setup({ registrations: [] });
  await act(async () => {
    await result.current.saveVariant("shirt", [], 1);
    await result.current.applyPromotion("BUNDLE");
  });
  expect(api.previewCurrentPromotion).toHaveBeenCalledWith("BUNDLE", "activity", undefined);
  expect(api.applyCurrentPromotion).toHaveBeenCalledWith("BUNDLE", "activity", undefined);
});

it("invalidates the previous visit even when the actor switches away and back", async () => {
  const old = deferred<OrderOut>();
  api.setDelegationProduct.mockReturnValueOnce(old.promise);
  const { result, rerender } = setup({ delegationToken: "first-token", delegationContext: context });
  let save!: ReturnType<typeof result.current.saveVariant>;
  act(() => { save = result.current.saveVariant("shirt", [], 8); });
  rerender({ delegationToken: "second-token", delegationContext: context });
  rerender({ delegationToken: "first-token", delegationContext: context });
  await act(async () => { old.resolve({ ...order, total_price: 800 }); expect(await save).toBeNull(); });
  expect(result.current.orders[0].total_price).toBe(300);
});

it("does not continue to coupon side effects after the page has unmounted", async () => {
  const old = deferred<OrderOut>();
  api.setCurrentRegistrationProduct.mockReturnValue(old.promise);
  const { result, unmount, options } = setup({ couponCode: "SAVE" });
  let save!: ReturnType<typeof result.current.saveVariant>;
  act(() => { save = result.current.saveVariant("shirt", [], 8); });
  unmount();
  old.resolve(order);
  expect(await save).toBeNull();
  expect(api.previewCurrentPromotion).not.toHaveBeenCalled();
  expect(options.mutationBusy.current).toBe(false);
});

it("keeps refresh blocked through save and coupon inspection, then rejects a superseded preview", async () => {
  const preview = deferred<{ eligible: boolean }>();
  api.previewCurrentPromotion.mockReturnValue(preview.promise);
  const { result, rerender, options } = setup({ couponCode: "SAVE" });
  let save!: ReturnType<typeof result.current.saveVariant>;
  act(() => { save = result.current.saveVariant("shirt", [], 2); });
  await waitFor(() => expect(api.previewCurrentPromotion).toHaveBeenCalledOnce());
  expect(options.mutationBusy.current).toBe(true);
  rerender({ delegationToken: "parent-token", delegationContext: context });
  await act(async () => { preview.resolve({ eligible: true }); expect(await save).toBeNull(); });
  expect(api.applyCurrentPromotion).not.toHaveBeenCalled();
  expect(options.mutationBusy.current).toBe(false);
});

it("keeps a later write when an earlier promotion preview finishes in the same identity", async () => {
  const preview = deferred<{ eligible: boolean }>();
  api.previewCurrentPromotion.mockReturnValue(preview.promise);
  const { result } = setup();
  let apply!: Promise<void>;
  act(() => { apply = result.current.applyPromotion("SAVE"); });
  const saved = { ...order, total_price: 900 };
  api.setCurrentRegistrationProduct.mockResolvedValue(saved);
  await act(async () => { await result.current.saveVariant("shirt", [], 9); });
  await act(async () => { preview.resolve({ eligible: true }); await apply; });
  expect(result.current.orders[0].total_price).toBe(900);
  expect(api.applyCurrentPromotion).not.toHaveBeenCalled();
});

it.each([
  { isLoggedIn: false },
  { classMemberUserId: "other-student", classMemberReady: false },
  { delegationToken: "revoked", delegationContext: { ...context, can_edit: false } },
])("rejects saving without current actor authorization: %j", async (actor) => {
  const { result } = setup(actor);
  await expect(result.current.saveVariant("shirt", [], 3)).rejects.toThrow("登入與授權");
  expect(api.setCurrentRegistrationProduct).not.toHaveBeenCalled();
  expect(api.setClassMemberProduct).not.toHaveBeenCalled();
  expect(api.setDelegationProduct).not.toHaveBeenCalled();
});
