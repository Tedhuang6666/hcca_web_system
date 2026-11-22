import { shopApi } from "@/lib/api";
import type { ProductOut } from "@/lib/types";

export async function listProductChoices(): Promise<ProductOut[]> {
  const products: ProductOut[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await shopApi.listProducts({ limit: "100", offset: String(offset) });
    products.push(...page);
    if (page.length < 100) return products;
  }
}
