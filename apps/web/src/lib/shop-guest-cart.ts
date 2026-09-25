import type { CartItemOut, CartOut, ProductOut, SelectedOption } from "./types";

const STORAGE_KEY = "hcca:shop:guest-cart:v1";

type GuestCartItem = CartItemOut;

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

function readItems(): GuestCartItem[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const items = raw ? JSON.parse(raw) : [];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function writeItems(items: GuestCartItem[]): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event("hcca:guest-cart-updated"));
}

function optionSnapshot(product: ProductOut, optionIds: string[]): SelectedOption[] {
  return product.variant_groups.flatMap((group) => {
    const option = group.options.find((candidate) => optionIds.includes(candidate.id));
    return option
      ? [{
          group_id: group.id,
          group_name: group.name,
          option_id: option.id,
          value: option.value,
          price_delta: option.price_delta,
        }]
      : [];
  });
}

function itemKey(productId: string, options: SelectedOption[]): string {
  return `${productId}:${options.map((option) => option.option_id).sort().join(",")}`;
}

export function getGuestCart(): GuestCartItem[] {
  return readItems();
}

export function guestCartCount(): number {
  return readItems().reduce((total, item) => total + item.quantity, 0);
}

export function addGuestCartItem(
  product: ProductOut,
  quantity: number,
  optionIds: string[],
): void {
  const options = optionSnapshot(product, optionIds);
  const key = itemKey(product.id, options);
  const items = readItems();
  const existing = items.find((item) => itemKey(item.product_id, item.selected_options) === key);
  if (existing) {
    existing.quantity = Math.min(existing.quantity + quantity, 100);
    existing.subtotal = existing.quantity * existing.unit_price;
  } else {
    const unitPrice = product.price + options.reduce((sum, option) => sum + option.price_delta, 0);
    items.push({
      id: `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      product_id: product.id,
      product_name: product.name,
      product_image_url: product.image_url,
      quantity,
      unit_price: unitPrice,
      subtotal: unitPrice * quantity,
      selected_options: options,
      available: product.status === "active" && (product.is_unlimited || product.stock_quantity > 0),
      unavailable_reason: null,
    });
  }
  writeItems(items);
}

export function updateGuestCartItem(itemId: string, quantity: number): GuestCartItem[] {
  const items = readItems();
  const item = items.find((candidate) => candidate.id === itemId);
  if (item) {
    item.quantity = Math.max(1, Math.min(quantity, 100));
    item.subtotal = item.quantity * item.unit_price;
  }
  writeItems(items);
  return items;
}

export function removeGuestCartItem(itemId: string): GuestCartItem[] {
  const items = readItems().filter((item) => item.id !== itemId);
  writeItems(items);
  return items;
}

export function clearGuestCart(): void {
  writeItems([]);
}

export function guestCartAsCartOut(): CartOut {
  const items = readItems();
  return {
    id: "guest-cart",
    items,
    total_price: items.reduce((total, item) => total + (item.available ? item.subtotal : 0), 0),
  };
}
