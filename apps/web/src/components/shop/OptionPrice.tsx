import { referenceDelta } from "@/lib/shop-reference-price";

export default function OptionPrice({ option }: {
  option: { price_delta: number; original_price_delta?: number | null };
}) {
  const original = referenceDelta(option);
  const current = option.price_delta;
  if (original === 0 && current === 0) return null;
  const format = (value: number) => `${value >= 0 ? "+" : "−"}NT$${Math.abs(value).toLocaleString()}`;
  return <span className="shop-product-option-price" aria-label={original > current
    ? `原加價 ${format(original)}，優惠加價 ${format(current)}` : `加價 ${format(current)}`}>
    {original > current && <del>{format(original)}</del>}
    <span>{current === 0 ? "免加價" : format(current)}</span>
  </span>;
}
