import type { OrderQuantityRow } from "@/lib/types";

export default function ProductQuantitySummary({ rows }: { rows: OrderQuantityRow[] }) {
  const products = new Map<string, { name: string; total: number; paid: number; variants: OrderQuantityRow[] }>();
  for (const row of rows) {
    const product = products.get(row.product_id) ?? { name: row.product_name, total: 0, paid: 0, variants: [] };
    product.total += row.qty_total;
    product.paid += row.qty_paid;
    product.variants.push(row);
    products.set(row.product_id, product);
  }
  return (
    <div className="shop-quantity-summary">
      <p className="shop-quantity-total">{products.size} 項商品 · 共 {rows.reduce((sum, row) => sum + row.qty_total, 0)} 件</p>
      {[...products].map(([id, product]) => (
        <details key={id}>
          <summary>
            <strong>{product.name}</strong>
            <span>共 {product.total} 件 · 已繳 {product.paid} 件</span>
            <span className="shop-quantity-hint">查看規格</span>
          </summary>
          <ul>
            {product.variants.map((row) => (
              <li key={row.variant_key}>
                <span>{row.variant_key || "標準規格"}</span>
                <span>{row.qty_total} 件 · 已繳 {row.qty_paid} 件</span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
