export default function ShopPrice({ original, current, suffix }: {
  original: number;
  current: number;
  suffix?: string;
}) {
  const discounted = current < original;
  return <span className="shop-price" aria-label={discounted
    ? `原價 NT$${original.toLocaleString()}，優惠價 NT$${current.toLocaleString()}${suffix ?? ""}`
    : undefined}>
    {discounted && <del>NT${original.toLocaleString()}</del>}
    <span className={discounted ? "shop-price-current" : undefined}>NT${current.toLocaleString()}{suffix}</span>
  </span>;
}
