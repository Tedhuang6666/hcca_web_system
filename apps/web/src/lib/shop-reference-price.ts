/** 原價只作比較，實售價與優惠計算仍使用 price / price_delta。 */
export function referencePrice(product: { price: number; original_price?: number | null }) {
  return Math.max(product.price, product.original_price ?? product.price);
}

export function referenceDelta(option: { price_delta: number; original_price_delta?: number | null }) {
  return Math.max(option.price_delta, option.original_price_delta ?? option.price_delta);
}

export function registrationReferenceSubtotal(
  items: ReadonlyArray<{
    product_id: string; quantity: number; unit_price: number;
    selected_options: ReadonlyArray<{ price_delta: number; original_price_delta?: number | null }>;
  }>,
  products: ReadonlyMap<string, { price: number; original_price?: number | null }>,
) {
  return items.reduce((sum, item) => {
    const product = products.get(item.product_id);
    const optionSaving = item.selected_options.reduce(
      (saving, option) => saving + referenceDelta(option) - option.price_delta, 0);
    const originalOptions = item.selected_options.reduce(
      (amount, option) => amount + referenceDelta(option), 0);
    const originalUnit = product?.original_price == null
      ? item.unit_price + optionSaving
      : Math.max(item.unit_price, referencePrice(product) + originalOptions);
    return sum + originalUnit * item.quantity;
  }, 0);
}
